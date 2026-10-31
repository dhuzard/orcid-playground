"""Engine for the hosted playground, run under Pyodide in the visitor's browser.

The browser has no sockets, so :func:`install_transport` routes ``urllib`` through
a synchronous request supplied by the Web Worker. Everything else reuses the
package unchanged: outputs only re-express the public ORCID record, and the
network workspace lives in the visitor's own browser storage.
"""
from __future__ import annotations

import base64
import io
import json
import urllib.error
import urllib.request
from email.message import Message
from typing import Any, Callable

from . import exporters, fun
from .collaboration import collaboration_graph, group_bibliography
from .team import (card_deck, card_deck_zip, group_health, group_snapshot, group_wrapped, render_group_wrapped,
                   render_health, team_biosketch)
from . import lint as quality
from .core import OrcidError, build_biosketch, fetch_orcid_record, normalize_orcid, render_markdown, to_jsonld
from .network import dispatch, import_public_record
from .network_store import NetworkStore

# get(url, headers_json) -> JSON text of [status, body, retry_after]; status 0 means unreachable.
Transport = Callable[[str, str], str]


def install_transport(get: Transport) -> None:
    """Send every ``urllib`` request through ``get``, keeping HTTP error semantics."""

    def urlopen(request, timeout=None):
        url = request.full_url if isinstance(request, urllib.request.Request) else str(request)
        headers = dict(request.header_items()) if isinstance(request, urllib.request.Request) else {}
        status, body, retry_after = json.loads(get(url, json.dumps(headers)))
        if not status:
            raise urllib.error.URLError("the browser could not reach the server")
        if status >= 400:
            message = Message()
            if retry_after:
                message["Retry-After"] = retry_after
            raise urllib.error.HTTPError(url, status, "HTTP error", message, None)
        return io.BytesIO(body.encode("utf-8"))

    urllib.request.urlopen = urlopen


def outputs(bio: dict[str, Any]) -> dict[str, Any]:
    """Every single-record output the package can make, keyed for the page."""
    report = quality.lint(bio)
    year_in_review = fun.wrapped(bio)
    return {
        "biosketch": bio,
        "markdown": render_markdown(bio, max_works=25),
        "jsonld": to_jsonld(bio),
        "card_svg": fun.trading_card_svg(bio),
        "heatmap_svg": fun.heatmap_svg(bio),
        "wrapped": year_in_review,
        "wrapped_text": fun.render_wrapped(year_in_review),
        "fortune": fun.fortune(bio),
        "lint": report,
        "lint_text": quality.render_report(report),
        "bibtex": exporters.to_bibtex(bio),
        "ris": exporters.to_ris(bio),
        "csl": exporters.to_csl_json(bio),
        "templates": {name: exporters.render_template(bio, name) for name in exporters.available_templates()},
    }


def profile(value: str) -> str:
    """Fetch one public record on the visitor's explicit request and render it."""
    orcid = normalize_orcid(value)
    bio = build_biosketch(fetch_orcid_record(orcid, retries=1, timeout=30))
    if bio["person"]["orcid"] != orcid:
        raise OrcidError("The returned ORCID record did not match the requested iD.")
    return json.dumps(outputs(bio), ensure_ascii=False)


def profile_from_biosketch(text: str) -> str:
    """Render a stored biosketch, such as the site's own sample, without the network."""
    return json.dumps(outputs(json.loads(text)), ensure_ascii=False)


def member(value: str) -> str:
    """One group member's public record summary, read on the visitor's request."""
    return json.dumps(import_public_record(value), ensure_ascii=False)


def group(name: str, bios_text: str) -> str:
    """Group outputs built only from the members' asserted records."""
    bios = json.loads(bios_text)
    works = group_bibliography(bios)
    combined = {"person": {"name": name}, "works": works}
    health = group_health(bios)
    return json.dumps({
        "health": health,
        "health_markdown": render_health(health, name),
        "templates": exporters.available_templates(),
        "graph": collaboration_graph(bios),
        "bibliography": works,
        "heatmap_svg": fun.heatmap_svg(combined),
        "bibtex": exporters.to_bibtex(combined),
    }, ensure_ascii=False)


def team(name: str, bios_text: str, template: str) -> str:
    """The team biosketch in one funder format, as Markdown."""
    return team_biosketch(json.loads(bios_text), template, name)


def group_extras(name: str, bios_text: str) -> str:
    """Year in review, card deck and embeddable snapshot for the group view."""
    bios = json.loads(bios_text)
    year_in_review = group_wrapped(bios, name)
    deck = card_deck(bios)
    return json.dumps({
        "wrapped": year_in_review,
        "wrapped_text": render_group_wrapped(year_in_review),
        "deck": deck,
        "deck_zip_b64": card_deck_zip(deck),
        "snapshot": group_snapshot(bios, name),
    }, ensure_ascii=False)


def fortune(text: str, seed: int) -> str:
    return fun.fortune(json.loads(text), seed=seed)


def _reject_constant(value):
    raise ValueError(f"Non-finite JSON value {value} is not supported.")


def _document(text: str) -> Any:
    try:
        return json.loads(text, parse_constant=_reject_constant)
    except (json.JSONDecodeError, TypeError) as error:
        raise ValueError("The file is not valid JSON.") from error


def check_workspace(text: str) -> str:
    """Validate a workspace backup without touching any workspace; return its summary."""
    return json.dumps(NetworkStore.validate_export(_document(text))[1], ensure_ascii=False)


class Workspace:
    """The network pilot's API without an HTTP server; state stays in ``path``."""

    def __init__(self, path: str):
        self.store = NetworkStore(path)

    def request(self, method: str, target: str, body: str | None = None) -> str:
        payload = None
        if method == "POST":
            try:
                payload = json.loads(body or "", parse_constant=_reject_constant)
            except (json.JSONDecodeError, ValueError):
                return json.dumps({"status": 400, "content_type": "application/json",
                                   "body": json.dumps({"error": "Expected a JSON object."})})
        status, data, content_type, filename = dispatch(self.store, import_public_record, method, target, payload)
        reply = {"status": status, "content_type": content_type, "filename": filename}
        if isinstance(data, bytes):
            reply["body_b64"] = base64.b64encode(data).decode("ascii")
        else:
            reply["body"] = json.dumps(data, ensure_ascii=False)
        return json.dumps(reply)

    # Backups and team packages stay in the visitor's browser: the page saves
    # them as files on request; nothing here sends them anywhere.

    def export_workspace(self) -> str:
        return json.dumps(self.store.export_data(), ensure_ascii=False, indent=1)

    def import_workspace(self, text: str) -> str:
        return json.dumps(self.store.import_data(_document(text)), ensure_ascii=False)

    def export_group_package(self, group_id: str) -> str:
        return json.dumps(self.store.export_group_package(group_id), ensure_ascii=False)

    def preview_group_package(self, text: str) -> str:
        return json.dumps(self.store.preview_group_package(_document(text)), ensure_ascii=False)

    def import_group_package(self, text: str) -> str:
        return json.dumps({"group_id": self.store.import_group_package(_document(text))})
