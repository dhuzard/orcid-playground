from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

API = "https://pub.orcid.org/v3.0"
SANDBOX_API = "https://pub.sandbox.orcid.org/v3.0"
# Upper bound on any single retry sleep, including a server-supplied Retry-After.
MAX_RETRY_DELAY = 30.0

RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})


class OrcidError(RuntimeError):
    """A problem reaching, identifying or reading an ORCID record."""


def _check_digit(digits: str) -> str:
    """ISO 7064 MOD 11-2, the checksum behind an ORCID iD's final character."""
    total = 0
    for digit in digits:
        total = (total + int(digit)) * 2
    remainder = (12 - total % 11) % 11
    return "X" if remainder == 10 else str(remainder)


def normalize_orcid(value: str) -> str:
    """Validate an ORCID iD, accepting a bare iD or an orcid.org URL."""
    candidate = re.sub(r"[^0-9X]", "", (value or "").upper())
    if len(candidate) != 16:
        raise OrcidError(f"{value!r} is not an ORCID iD; expected 16 digits, like 0000-0002-1825-0097")
    if "X" in candidate[:15]:
        raise OrcidError(f"{value!r} is not an ORCID iD; only the final character may be X")
    if _check_digit(candidate[:15]) != candidate[15]:
        raise OrcidError(f"{value!r} fails the ORCID checksum; check for a typo")
    return "-".join(candidate[i:i + 4] for i in range(0, 16, 4))


def load_record(path: str | Path) -> dict[str, Any]:
    """Read a previously saved ORCID record, for offline and CI runs."""
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise OrcidError(f"No such record file: {path}") from error
    except json.JSONDecodeError as error:
        raise OrcidError(f"{path} is not valid JSON: {error}") from error


def _retry_after(error: urllib.error.HTTPError) -> float | None:
    value = error.headers.get("Retry-After") if error.headers else None
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except (TypeError, ValueError):
        try:
            moment = parsedate_to_datetime(value)
            if moment.tzinfo is None:
                moment = moment.replace(tzinfo=timezone.utc)
            return max(0.0, (moment - datetime.now(timezone.utc)).total_seconds())
        except (TypeError, ValueError, OverflowError):
            return None


def _request_json(
    url: str,
    headers: dict[str, str],
    *,
    retries: int,
    timeout: int,
) -> dict[str, Any]:
    request = urllib.request.Request(url, headers=headers)
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = json.load(response)
                if not isinstance(payload, dict):
                    raise OrcidError(f"ORCID returned a non-object JSON response for {url}")
                return payload
        except urllib.error.HTTPError as error:
            if error.code == 404:
                raise OrcidError(f"ORCID has no public record or resource at {url}") from error
            if error.code in (401, 403):
                raise OrcidError(
                    f"ORCID refused the request (HTTP {error.code}); the record may be private "
                    "or ORCID_ACCESS_TOKEN invalid"
                ) from error
            if error.code not in RETRY_STATUSES or attempt == retries:
                raise OrcidError(f"ORCID returned HTTP {error.code} for {url}") from error
            retry_after = _retry_after(error)
            delay = min(retry_after if retry_after is not None else 2.0 ** attempt, MAX_RETRY_DELAY)
        except (urllib.error.URLError, TimeoutError) as error:
            if attempt == retries:
                reason = getattr(error, "reason", error)
                raise OrcidError(f"Could not reach {url}: {reason}") from error
            delay = min(2.0 ** attempt, MAX_RETRY_DELAY)
        except json.JSONDecodeError as error:
            raise OrcidError(f"ORCID returned invalid JSON for {url}: {error}") from error
        time.sleep(delay)
    raise OrcidError(f"Gave up fetching {url} after {retries} retries")


def _display_index(summary: dict[str, Any]) -> int:
    try:
        return int(summary.get("display-index", -1))
    except (TypeError, ValueError):
        return -1


def _preferred_work_summary(group: dict[str, Any]) -> dict[str, Any] | None:
    summaries = [item for item in group.get("work-summary") or [] if isinstance(item, dict)]
    return max(summaries, key=_display_index) if summaries else None


def _preferred_funding_summary(group: dict[str, Any]) -> dict[str, Any] | None:
    summaries = [item for item in group.get("funding-summary") or [] if isinstance(item, dict)]
    return max(summaries, key=_display_index) if summaries else None


def _add_work_details(
    record: dict[str, Any],
    orcid: str,
    headers: dict[str, str],
    *,
    base_url: str,
    retries: int,
    timeout: int,
) -> None:
    groups = ((record.get("activities-summary") or {}).get("works") or {}).get("group") or []
    selected = [summary for group in groups if isinstance(group, dict)
                if (summary := _preferred_work_summary(group)) is not None]
    by_put_code = {str(summary.get("put-code")): summary for summary in selected if summary.get("put-code") is not None}
    put_codes = list(by_put_code)
    for offset in range(0, len(put_codes), 100):
        batch = put_codes[offset:offset + 100]
        payload = _request_json(
            f"{base_url.rstrip('/')}/{orcid}/works/{','.join(batch)}",
            headers,
            retries=retries,
            timeout=timeout,
        )
        for wrapped in payload.get("bulk") or []:
            detail = wrapped.get("work") if isinstance(wrapped, dict) else None
            if not isinstance(detail, dict):
                continue
            summary = by_put_code.get(str(detail.get("put-code")))
            if summary is not None:
                for key in ("contributors", "short-description", "citation", "language-code"):
                    if key in detail:
                        summary[key] = detail[key]


def _add_funding_details(
    record: dict[str, Any],
    orcid: str,
    headers: dict[str, str],
    *,
    base_url: str,
    retries: int,
    timeout: int,
) -> None:
    groups = ((record.get("activities-summary") or {}).get("fundings") or {}).get("group") or []
    selected = [summary for group in groups if isinstance(group, dict)
                if (summary := _preferred_funding_summary(group)) is not None]
    for summary in selected:
        put_code = summary.get("put-code")
        if put_code is None:
            continue
        try:
            detail = _request_json(
                f"{base_url.rstrip('/')}/{orcid}/funding/{put_code}",
                headers,
                retries=retries,
                timeout=timeout,
            )
        except OrcidError:
            # One unavailable assertion must not discard other funding details.
            continue
        if isinstance(detail, dict):
            summary.update(detail)


def fetch_orcid_record(
    orcid: str,
    token: str | None = None,
    *,
    base_url: str = API,
    retries: int = 3,
    timeout: int = 30,
    include_work_details: bool = True,
) -> dict[str, Any]:
    """Fetch the public ORCID 3.0 record and its useful activity details."""
    orcid = normalize_orcid(orcid)
    headers = {"Accept": "application/json", "User-Agent": "orcid-biosketch/0.2"}
    token = token or os.getenv("ORCID_ACCESS_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    record = _request_json(
        f"{base_url.rstrip('/')}/{orcid}/record", headers, retries=retries, timeout=timeout
    )
    if include_work_details:
        try:
            _add_work_details(
                record, orcid, headers, base_url=base_url, retries=retries, timeout=timeout
            )
        except OrcidError:
            # The record summary remains useful offline and for non-citation outputs.
            pass
        _add_funding_details(
            record, orcid, headers, base_url=base_url, retries=retries, timeout=timeout
        )
    return record


def _value(node: Any, default: str = "") -> str:
    return node.get("value", default) if isinstance(node, dict) else default


def _date(node: dict[str, Any] | None) -> str | None:
    if not node:
        return None
    parts = [_value(node.get(k)) for k in ("year", "month", "day")]
    parts = [p for p in parts if p]
    return "-".join(parts) or None


def _affiliations(groups: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
    items = []
    for group in groups or []:
        for wrapped in group.get("summaries") or []:
            summary = wrapped.get(f"{kind}-summary") or {}
            org = summary.get("organization") or {}
            disambiguated = org.get("disambiguated-organization") or {}
            items.append({
                "organization": org.get("name"),
                "organization_id": disambiguated.get("disambiguated-organization-identifier"),
                "organization_id_source": disambiguated.get("disambiguation-source"),
                "role": summary.get("role-title"),
                "department": summary.get("department-name"),
                "start_date": _date(summary.get("start-date")),
                "end_date": _date(summary.get("end-date")),
                "source": _source(summary),
                "orcid_put_code": summary.get("put-code"),
            })
    return items


def _source(node: dict[str, Any]) -> dict[str, Any]:
    source = node.get("source") or {}
    origin = source.get("source-orcid") or source.get("source-client-id") or {}
    return {"name": _value(source.get("source-name")), "id": origin.get("path")}


def _contributors(work: dict[str, Any]) -> list[dict[str, Any]]:
    raw = (work.get("contributors") or {}).get("contributor") or []
    items = []
    for contributor in raw:
        if not isinstance(contributor, dict):
            continue
        attributes = contributor.get("contributor-attributes") or {}
        name = _value(contributor.get("credit-name"))
        contributor_orcid = contributor.get("contributor-orcid") or {}
        if name:
            items.append({
                "name": name,
                "orcid": contributor_orcid.get("path") or None,
                "role": attributes.get("contributor-role"),
                "sequence": attributes.get("contributor-sequence"),
            })
    return items


def _assertion_sources(group: dict[str, Any]) -> list[dict[str, Any]]:
    sources = []
    seen = set()
    for summary in group.get("work-summary") or []:
        if not isinstance(summary, dict):
            continue
        source = _source(summary)
        key = (source.get("id"), source.get("name"))
        if key not in seen:
            seen.add(key)
            sources.append(source)
    return sources


def _works(groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    works = []
    for group in groups or []:
        work = _preferred_work_summary(group)
        if work is None:
            continue
        external_ids = work.get("external-ids", {}).get("external-id", [])
        identifiers = {
            item.get("external-id-type", "unknown"): item.get("external-id-value")
            for item in external_ids if item.get("external-id-value")
        }
        works.append({
            "title": _value((work.get("title") or {}).get("title")),
            "type": work.get("type"),
            "publication_date": _date(work.get("publication-date")),
            "journal": _value(work.get("journal-title")),
            "url": _value(work.get("url")),
            "identifiers": identifiers,
            "authors": _contributors(work),
            "source": _source(work),
            "assertion_sources": _assertion_sources(group),
            "orcid_put_code": work.get("put-code"),
        })
    return sorted(works, key=lambda x: x.get("publication_date") or "", reverse=True)


def _external_ids(node: dict[str, Any]) -> dict[str, Any]:
    items = (node.get("external-ids") or {}).get("external-id") or []
    return {
        item.get("external-id-type", "unknown"): item.get("external-id-value")
        for item in items if isinstance(item, dict) and item.get("external-id-value")
    }


def _section(activities: dict[str, Any], name: str, key: str) -> list[dict[str, Any]]:
    return (activities.get(name) or {}).get(key) or []


def _fundings(groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items = []
    for group in groups or []:
        summary = _preferred_funding_summary(group)
        if summary is None:
            continue
        amount = summary.get("amount") or {}
        identifiers = _external_ids(summary)
        items.append({
            "title": _value((summary.get("title") or {}).get("title")),
            "type": summary.get("type"),
            "organization": (summary.get("organization") or {}).get("name"),
            "start_date": _date(summary.get("start-date")),
            "end_date": _date(summary.get("end-date")),
            "amount": _value(amount) or None,
            "currency": amount.get("currency-code"),
            "grant_number": identifiers.get("grant_number"),
            "identifiers": identifiers,
            "url": _value(summary.get("url")) or None,
            "source": _source(summary),
            "orcid_put_code": summary.get("put-code"),
        })
    return sorted(items, key=lambda x: x.get("start_date") or "", reverse=True)


def _peer_reviews(groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    reviews: dict[str, dict[str, Any]] = {}
    for group in groups or []:
        # ORCID nests summaries one level deeper than the other activity groups.
        for subgroup in group.get("peer-review-group") or [group]:
            for summary in subgroup.get("peer-review-summary") or []:
                org = (summary.get("convening-organization") or {}).get("name") or "Unknown organization"
                entry = reviews.setdefault(org, {
                    "organization": org,
                    "review_count": 0,
                    "review_type": summary.get("review-type"),
                    "role": summary.get("reviewer-role"),
                    "review_group_id": summary.get("review-group-id"),
                    "last_completed": None,
                    "source": _source(summary),
                })
                entry["review_count"] += 1
                completed = _date(summary.get("completion-date"))
                if completed and completed > (entry["last_completed"] or ""):
                    entry["last_completed"] = completed
    return sorted(reviews.values(), key=lambda x: (x["review_count"], x["organization"]), reverse=True)


def _research_resources(groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items = []
    for group in groups or []:
        for summary in group.get("research-resource-summary") or []:
            proposal = summary.get("proposal") or summary
            hosts = (proposal.get("hosts") or {}).get("organization") or []
            items.append({
                "title": _value((proposal.get("title") or {}).get("title")),
                "hosts": [host.get("name") for host in hosts if host.get("name")],
                "start_date": _date(proposal.get("start-date")),
                "end_date": _date(proposal.get("end-date")),
                "source": _source(summary),
                "orcid_put_code": summary.get("put-code"),
            })
    return items


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    result = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def build_biosketch(record: dict[str, Any], override: dict[str, Any] | None = None) -> dict[str, Any]:
    """Normalize an ORCID record into the stable biosketch contract."""
    person = record.get("person", {})
    name = person.get("name") or {}
    activities = record.get("activities-summary", {})
    orcid = record.get("orcid-identifier", {}).get("path", "")
    urls = {
        item.get("url-name") or "website": _value(item.get("url"))
        for item in person.get("researcher-urls", {}).get("researcher-url", [])
    }
    modified_ms = (record.get("history", {}).get("last-modified-date") or {}).get("value")
    generated_at = (
        datetime.fromtimestamp(modified_ms / 1000, timezone.utc).isoformat()
        if modified_ms else None
    )
    peer_review_groups = _section(activities, "peer-reviews", "group") or _section(activities, "peer-review", "group")
    result = {
        "schema_version": "0.2.0",
        "person": {
            "name": " ".join(filter(None, [_value(name.get("given-names")), _value(name.get("family-name"))])),
            "given_names": _value(name.get("given-names")),
            "family_name": _value(name.get("family-name")),
            "credit_name": _value(name.get("credit-name")) or None,
            "orcid": orcid,
            "orcid_url": f"https://orcid.org/{orcid}",
            "biography": (person.get("biography") or {}).get("content", ""),
            "country": _value((person.get("addresses", {}).get("address") or [{}])[0].get("country")),
            "keywords": [x.get("content") for x in person.get("keywords", {}).get("keyword", [])],
            "urls": urls,
        },
        "employment": _affiliations(activities.get("employments", {}).get("affiliation-group", []), "employment"),
        "education": _affiliations(activities.get("educations", {}).get("affiliation-group", []), "education"),
        "works": _works(activities.get("works", {}).get("group", [])),
        "fundings": _fundings(_section(activities, "fundings", "group")),
        "peer_reviews": _peer_reviews(peer_review_groups),
        "distinctions": _affiliations(_section(activities, "distinctions", "affiliation-group"), "distinction"),
        "memberships": _affiliations(_section(activities, "memberships", "affiliation-group"), "membership"),
        "services": _affiliations(_section(activities, "services", "affiliation-group"), "service"),
        "qualifications": _affiliations(_section(activities, "qualifications", "affiliation-group"), "qualification"),
        "invited_positions": _affiliations(_section(activities, "invited-positions", "affiliation-group"), "invited-position"),
        "research_resources": _research_resources(_section(activities, "research-resources", "group")),
        "provenance": {
            "primary_source": f"https://orcid.org/{orcid}",
            "orcid_api_version": "3.0",
            "orcid_last_modified": modified_ms,
            "generated_at": generated_at,
            "override_applied": bool(override),
        },
    }
    return _deep_merge(result, override or {})


def _grant_jsonld(item: dict[str, Any]) -> dict[str, Any]:
    grant: dict[str, Any] = {
        "@type": "MonetaryGrant" if item.get("amount") else "Grant",
        "name": item.get("title"),
    }
    if item.get("organization"):
        grant["funder"] = {"@type": "Organization", "name": item["organization"]}
    if item.get("grant_number"):
        grant["identifier"] = item["grant_number"]
    if item.get("amount"):
        grant["amount"] = {
            "@type": "MonetaryAmount",
            "value": item["amount"],
            "currency": item.get("currency"),
        }
    if item.get("url"):
        grant["url"] = item["url"]
    return grant


def to_jsonld(bio: dict[str, Any]) -> dict[str, Any]:
    person = bio["person"]
    awards = [
        ", ".join(filter(None, [item.get("role"), item.get("organization")]))
        for item in bio.get("distinctions", [])
    ]
    extras: dict[str, Any] = {
        "funding": [_grant_jsonld(item) for item in bio.get("fundings", [])],
        "memberOf": [
            {"@type": "Organization", "name": item["organization"]}
            for item in bio.get("memberships", []) if item.get("organization")
        ],
        "award": [award for award in awards if award],
    }
    return {
        "@context": "https://schema.org",
        "@type": "Person",
        "@id": person["orcid_url"],
        "name": person["name"],
        "givenName": person["given_names"],
        "familyName": person["family_name"],
        "description": person["biography"],
        "sameAs": [person["orcid_url"], *[v for v in person["urls"].values() if v]],
        "knowsAbout": person["keywords"],
        "alumniOf": [x["organization"] for x in bio["education"] if x["organization"]],
        **{key: value for key, value in extras.items() if value},
    }


def _period(item: dict[str, Any], ongoing: bool = True) -> str:
    """Render a date range. Only ongoing-by-nature sections imply "present"."""
    start, end = item.get("start_date"), item.get("end_date")
    if not start and not end:
        return ""
    if start and not end:
        return f"{start}–present" if ongoing else start
    return "–".join(filter(None, [start, end]))


def _affiliation_lines(items: list[dict[str, Any]], ongoing: bool = True) -> list[str]:
    lines = []
    for item in items:
        organization = item.get("organization") or ""
        label = f"**{item['role']}**, {organization}" if item.get("role") else f"**{organization}**"
        period = _period(item, ongoing)
        lines.append(f"- {label} ({period})" if period else f"- {label}")
    return lines


def render_markdown(bio: dict[str, Any], max_works: int = 10) -> str:
    p = bio["person"]
    lines = [f"# {p['name']}", "", f"[ORCID: {p['orcid']}]({p['orcid_url']})", ""]
    if p["biography"]:
        lines.extend([p["biography"], ""])
    if bio["employment"]:
        lines.extend(["## Employment", ""])
        for item in bio["employment"]:
            period = _period(item)
            suffix = f" ({period})" if period else ""
            lines.append(f"- **{item['role'] or 'Position'}**, {item['organization']}{suffix}")
        lines.append("")
    if bio["works"]:
        lines.extend(["## Selected works", ""])
        for work in bio["works"][:max_works]:
            doi = work["identifiers"].get("doi")
            target = f"https://doi.org/{doi}" if doi else work["url"]
            title = f"[{work['title']}]({target})" if target else work["title"]
            lines.append(f"- {title} ({(work['publication_date'] or '')[:4]})")
        lines.append("")
    if bio.get("fundings"):
        lines.extend(["## Funding", ""])
        for item in bio["fundings"]:
            funder = f", {item['organization']}" if item.get("organization") else ""
            amount = f" — {item['amount']} {item['currency'] or ''}".rstrip() if item.get("amount") else ""
            grant = f" [{item['grant_number']}]" if item.get("grant_number") else ""
            lines.append(f"- **{item['title'] or 'Grant'}**{funder} ({_period(item)}){amount}{grant}")
        lines.append("")
    if bio.get("peer_reviews"):
        lines.extend(["## Peer review", ""])
        for item in bio["peer_reviews"]:
            latest = f", most recent {item['last_completed']}" if item.get("last_completed") else ""
            reviews = "review" if item["review_count"] == 1 else "reviews"
            lines.append(f"- {item['organization']} — {item['review_count']} {reviews} as {item['role'] or 'reviewer'}{latest}")
        lines.append("")
    for heading, key, ongoing in (
        ("Distinctions", "distinctions", False),
        ("Qualifications", "qualifications", False),
        ("Invited positions", "invited_positions", False),
        ("Memberships", "memberships", True),
        ("Service", "services", True),
    ):
        if bio.get(key):
            lines.extend([f"## {heading}", "", *_affiliation_lines(bio[key], ongoing), ""])
    if bio.get("research_resources"):
        lines.extend(["## Research resources", ""])
        for item in bio["research_resources"]:
            hosts = f", {', '.join(item['hosts'])}" if item.get("hosts") else ""
            period = _period(item, False)
            lines.append(f"- **{item['title'] or 'Resource'}**{hosts}" + (f" ({period})" if period else ""))
        lines.append("")
    lines.append(f"_Generated from ORCID; synchronized {bio['provenance']['generated_at']}._")
    return "\n".join(lines) + "\n"
