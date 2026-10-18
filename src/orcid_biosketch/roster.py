"""Researcher-controlled roster assertion export (schema/roster-assertion.schema.json).

A roster export lists the people a researcher has put in a local working group,
as *asserted identifiers*. It is deliberately inert: an ORCID iD, a roster
entry or a recorded contribution never grants project access, never confirms
an invitation, never implies authorship and never confirms a CRediT role.
Private members never leave the workspace, and nothing here is ever written to
the public biosketch outputs.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable
from typing import Any

from .core import OrcidError, normalize_orcid

SCHEMA = "orcid-playground/roster-assertion"
SCHEMA_VERSION = "0.1.0"
LOCAL_ORIGIN = "local-offline-roster"
EXTERNAL_ORIGIN = "external-platform"

ACCESS_EFFECT = {
    "grants": "none",
    "invitations": "none",
    "accounts": "none",
    "authorship": "not-implied",
    "credit": "not-inferred",
}
# What a consumer must still obtain before a candidate can join a project.
JOIN_REQUIREMENTS = ["authenticated-local-account", "project-controller-approved-invitation"]

MEMBER_FIELDS = ("orcid", "display_name", "local_role")
# Privacy default: share only the iD, from which a recipient can read the public record.
DEFAULT_MEMBER_FIELDS = ("orcid",)
SUPPORTED_SOURCE_RIGHTS = frozenset({"public-orcid-record", "owner-provided"})
CONTRIBUTION_STATUSES = frozenset({"source-declared", "curator-confirmed"})
CREDIT_ROLES = frozenset({
    "conceptualization", "data-curation", "formal-analysis", "funding-acquisition",
    "investigation", "methodology", "project-administration", "resources", "software",
    "supervision", "validation", "visualization", "writing-original-draft",
    "writing-review-editing",
})
LISTED = "listed-member"


class RosterError(ValueError):
    """A roster cannot be exported or consumed as asked."""


def canonical_json(document: dict[str, Any]) -> bytes:
    return json.dumps(document, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def compute_digest(document: dict[str, Any]) -> str:
    """SHA-256 over the canonical document without its digest member."""
    body = {key: value for key, value in document.items() if key != "digest"}
    return hashlib.sha256(canonical_json(body)).hexdigest()


def _seal(document: dict[str, Any]) -> dict[str, Any]:
    document["digest"] = {"algorithm": "sha256", "value": compute_digest(document)}
    return document


def _assertion(basis: str, method: str, asserted_at: str, asserted_by: str | None = None,
               *, source_record_version: str | None = None, reference: str | None = None) -> dict[str, Any]:
    return {
        "basis": basis,
        "method": method,
        "asserted_at": asserted_at,
        "asserted_by": asserted_by,
        "evidence": {"source_record_version": source_record_version, "reference": reference},
    }


def _orcid_uri(orcid: str, sandbox: bool) -> str:
    return f"https://{'sandbox.' if sandbox else ''}orcid.org/{orcid}"


def _envelope(group: dict[str, Any], consent: dict[str, Any], generated_at: str,
              redaction: dict[str, Any]) -> dict[str, Any]:
    creator = group["created_by"]
    return {
        "schema": SCHEMA,
        "schema_version": SCHEMA_VERSION,
        "export_id": f"roster:{group['local_id']}:{''.join(c for c in generated_at if c.isdigit())}",
        "generated_at": generated_at,
        "origin": LOCAL_ORIGIN,
        "distribution": "private-recipient-only",
        "access_effect": dict(ACCESS_EFFECT),
        "consent": consent,
        "redaction": redaction,
        "group": {
            "local_id": group["local_id"],
            "name": group["name"],
            "created_by": creator,
            "assertion": _assertion("owner-curated", "local-group", group["created_at"], creator),
        },
        "members": [],
        "outputs": [],
        "contributions": [],
        "project_references": [],
    }


def _consent(group: dict[str, Any]) -> dict[str, Any]:
    consent = group.get("consent") or {}
    if consent.get("status") not in {"granted", "revoked"} or not consent.get("granted_at"):
        raise RosterError("Roster export needs the group creator's explicit opt-in; none is recorded")
    if consent.get("granted_by") != group["created_by"]:
        raise RosterError("Only the group creator can opt a roster in to export")
    revoked = consent["status"] == "revoked"
    if revoked and not consent.get("revoked_at"):
        raise RosterError("A revoked consent needs its revocation time")
    return {
        "status": consent["status"],
        "scope": "roster-export",
        "method": "local-explicit-opt-in",
        "granted_at": consent["granted_at"],
        "granted_by": consent["granted_by"],
        "revoked_at": consent["revoked_at"] if revoked else None,
    }


def build_revocation(group: dict[str, Any]) -> dict[str, Any]:
    """A content-free notice telling an earlier recipient to discard the roster."""
    consent = _consent(group)
    if consent["status"] != "revoked":
        raise RosterError("Consent has not been revoked")
    redaction = {"policy": "default-private", "member_fields": [], "private_members": "omitted",
                 "excluded_outputs": [], "project_references": "omitted"}
    return _seal(_envelope(group, consent, consent["revoked_at"], redaction))


def _select(items: list[dict[str, Any]], wanted: Iterable[str] | None, what: str) -> list[dict[str, Any]]:
    if wanted is None:
        return items
    wanted = list(wanted)
    known = {item["key"] for item in items}
    unknown = sorted(set(wanted) - known)
    if unknown:
        raise RosterError(f"Unknown {what}: {', '.join(unknown)}")
    return [item for item in items if item["key"] in set(wanted)]


def _member(entry: dict[str, Any], group: dict[str, Any], fields: set[str], sandbox: bool) -> dict[str, Any]:
    creator, created_at = group["created_by"], group["created_at"]
    if entry.get("orcid_status", "claimed") != "claimed":
        raise RosterError(
            f"Member {entry['key']}: a local roster cannot assert ORCID verification; "
            "only an ORCID OAuth sign-in on a shared service can"
        )
    if entry.get("membership_status", LISTED) != LISTED:
        raise RosterError(
            f"Member {entry['key']}: a local roster cannot assert accepted invitations or active membership"
        )
    source = entry.get("person_source") or {}
    basis = source.get("basis", "owner-curated")
    if basis not in {"public-orcid-record", "owner-curated"}:
        raise RosterError(f"Member {entry['key']}: a local roster cannot assert {basis!r} person data")
    asserted_at = source.get("asserted_at") or created_at
    person = _assertion(
        basis,
        "orcid-public-api-import" if basis == "public-orcid-record" else "curator-entry",
        asserted_at,
        None if basis == "public-orcid-record" else creator,
        source_record_version=source.get("source_record_version"),
    )
    orcid = None
    if "orcid" in fields and entry.get("orcid"):
        orcid = {
            "id": entry["orcid"],
            "uri": _orcid_uri(entry["orcid"], sandbox),
            "status": "claimed",
            "assertion": _assertion("owner-curated", "curator-entry", asserted_at, creator),
        }
    return {
        "member_key": entry["key"],
        "display_name": entry.get("display_name") if "display_name" in fields else None,
        "orcid": orcid,
        "local_role": entry.get("local_role") if "local_role" in fields else None,
        "membership": {
            "status": LISTED,
            "assertion": _assertion("owner-curated", "local-roster-entry",
                                    entry.get("added_at") or created_at, creator),
        },
        "person_assertion": person,
    }


def _contribution(entry: dict[str, Any], creator: str) -> dict[str, Any]:
    label = f"Contribution {entry.get('member')}/{entry.get('output')}"
    if entry.get("credit_role") not in CREDIT_ROLES:
        raise RosterError(f"{label}: {entry.get('credit_role')!r} is not a CRediT role")
    status = entry.get("status")
    if status not in CONTRIBUTION_STATUSES:
        raise RosterError(f"{label}: only source-declared or curator-confirmed roles can be exported, not {status!r}")
    if not entry.get("asserted_at"):
        raise RosterError(f"{label}: needs the time it was declared or confirmed")
    if status == "source-declared":
        if not entry.get("reference"):
            raise RosterError(f"{label}: a source-declared role needs a reference to its source")
        assertion = _assertion("owner-curated", "source-declaration-transcribed", entry["asserted_at"],
                               creator, reference=entry["reference"])
    else:
        assertion = _assertion("owner-curated", "curator-confirmation", entry["asserted_at"],
                               entry.get("asserted_by") or creator, reference=entry.get("reference"))
    return {
        "member_key": entry["member"],
        "output_key": entry["output"],
        "credit_role": entry["credit_role"],
        "status": status,
        "assertion": assertion,
    }


def build_export(
    group: dict[str, Any],
    *,
    members: Iterable[str] | None = None,
    outputs: Iterable[str] | None = None,
    fields: Iterable[str] = DEFAULT_MEMBER_FIELDS,
    include_project_references: bool = False,
    sandbox: bool = False,
) -> dict[str, Any]:
    """Export a local working group as an inert, digest-sealed roster assertion.

    Requires the group creator's recorded opt-in. ``members`` and ``outputs``
    select a subset by key; ``fields`` chooses which optional member fields to
    include (by default only the ORCID iD). Private members, unselected
    outputs and outputs whose reuse rights are unsupported are left out, and
    project references are omitted unless asked for.
    """
    consent = _consent(group)
    if consent["status"] != "granted":
        raise RosterError("Consent to export this roster was revoked; use build_revocation")
    fields = set(fields)
    if fields - set(MEMBER_FIELDS):
        raise RosterError(f"Unknown member fields: {', '.join(sorted(fields - set(MEMBER_FIELDS)))}")
    creator = group["created_by"]

    roster = [dict(entry) for entry in group.get("members", [])]
    seen: dict[str, str] = {}
    for entry in roster:
        if entry.get("orcid"):
            try:
                entry["orcid"] = normalize_orcid(entry["orcid"])
            except OrcidError as error:
                raise RosterError(f"Member {entry['key']}: {error}") from error
            if entry["orcid"] in seen:
                raise RosterError(f"Members {seen[entry['orcid']]} and {entry['key']} share ORCID iD {entry['orcid']}")
            seen[entry["orcid"]] = entry["key"]
    if len({entry["key"] for entry in roster}) != len(roster):
        raise RosterError("Member keys must be unique")
    chosen = [entry for entry in _select(roster, members, "members") if entry.get("visibility") != "private"]

    excluded: list[str] = []
    selected_outputs = []
    for entry in _select(list(group.get("outputs", [])), outputs, "outputs"):
        if outputs is None and not entry.get("selected"):
            excluded.append("not-selected")
        elif entry.get("source_rights") not in SUPPORTED_SOURCE_RIGHTS:
            excluded.append("unsupported-source-rights")
        else:
            selected_outputs.append(entry)

    redaction = {
        "policy": "default-private",
        "member_fields": [name for name in MEMBER_FIELDS if name in fields],
        "private_members": "omitted",
        "excluded_outputs": sorted(set(excluded)),
        "project_references": "included" if include_project_references else "omitted",
    }
    document = _envelope(group, consent, group["updated_at"], redaction)
    document["members"] = [_member(entry, group, fields, sandbox) for entry in chosen]
    document["outputs"] = [
        {
            "output_key": entry["key"],
            "title": entry.get("title"),
            "identifiers": {"doi": entry["doi"]} if entry.get("doi") else {},
            "source_rights": entry["source_rights"],
            "assertion": _assertion(
                "public-orcid-record" if entry["source_rights"] == "public-orcid-record" else "owner-curated",
                "curator-selected-output",
                entry.get("asserted_at") or group["created_at"],
                creator,
                source_record_version=entry.get("source_record_version"),
            ),
        }
        for entry in selected_outputs
    ]
    member_keys = {entry["key"] for entry in chosen}
    output_keys = {entry["key"] for entry in selected_outputs}
    document["contributions"] = [
        _contribution(entry, creator)
        for entry in group.get("contributions", [])
        if entry.get("member") in member_keys and entry.get("output") in output_keys
    ]
    if include_project_references:
        document["project_references"] = [
            {
                "provider": entry["provider"],
                "identifier": entry["identifier"],
                "status": "proposed",
                "declared_visibility": entry.get("declared_visibility", "private"),
                "sharing_approved": bool(entry.get("sharing_approved")),
                "url": entry.get("url") if entry.get("sharing_approved") else None,
                "assertion": _assertion("owner-curated", "curator-proposed-reference",
                                        entry.get("asserted_at") or group["created_at"], creator),
            }
            for entry in group.get("project_references", [])
        ]
    return _seal(document)


def _assertions(document: dict[str, Any]) -> Iterable[tuple[str, dict[str, Any]]]:
    yield "group", document.get("group", {}).get("assertion") or {}
    for index, member in enumerate(document.get("members", [])):
        yield f"members[{index}].person_assertion", member.get("person_assertion") or {}
        yield f"members[{index}].membership", (member.get("membership") or {}).get("assertion") or {}
        if member.get("orcid"):
            yield f"members[{index}].orcid", member["orcid"].get("assertion") or {}
    for name in ("outputs", "contributions", "project_references"):
        for index, item in enumerate(document.get(name, [])):
            yield f"{name}[{index}]", item.get("assertion") or {}


def validate_export(document: Any) -> list[str]:
    """Rules the JSON Schema cannot express. Returns problems; empty means valid.

    Validate against schema/roster-assertion.schema.json as well: this
    function assumes the document's structural shape is already sound.
    """
    if not isinstance(document, dict):
        return ["document is not a JSON object"]
    problems: list[str] = []
    if document.get("schema") != SCHEMA or document.get("schema_version") != SCHEMA_VERSION:
        problems.append(f"not a {SCHEMA} {SCHEMA_VERSION} document")
    if document.get("access_effect") != ACCESS_EFFECT:
        problems.append("access_effect must state that importing grants nothing")
    if (document.get("digest") or {}).get("value") != compute_digest(document):
        problems.append("digest does not match the document")

    consent = document.get("consent") or {}
    group = document.get("group") or {}
    if consent.get("granted_by") != group.get("created_by"):
        problems.append("consent must be granted by the group creator")
    content = [name for name in ("members", "outputs", "contributions", "project_references") if document.get(name)]
    if consent.get("status") == "revoked":
        if not consent.get("revoked_at"):
            problems.append("revoked consent has no revocation time")
        if content:
            problems.append(f"consent is revoked but the document still carries {', '.join(content)}")
    elif consent.get("revoked_at") is not None:
        problems.append("granted consent cannot carry a revocation time")

    origin = document.get("origin")
    redaction = document.get("redaction") or {}
    shared_fields = set(redaction.get("member_fields") or [])
    member_keys: set[str] = set()
    orcids: dict[str, str] = {}
    for index, member in enumerate(document.get("members", [])):
        where = f"members[{index}]"
        key = member.get("member_key")
        if key in member_keys:
            problems.append(f"{where}: duplicate member key {key!r}")
        member_keys.add(key)
        for name in MEMBER_FIELDS:
            if name not in shared_fields and member.get(name) is not None:
                problems.append(f"{where}: {name} is present but was not chosen for export")
        orcid = member.get("orcid")
        if orcid:
            try:
                normalized = normalize_orcid(orcid.get("id", ""))
            except OrcidError as error:
                problems.append(f"{where}: {error}")
            else:
                if orcid.get("uri") not in {_orcid_uri(normalized, False), _orcid_uri(normalized, True)}:
                    problems.append(f"{where}: ORCID URI does not match the iD")
                if normalized in orcids:
                    problems.append(f"{where}: duplicate researcher; ORCID iD {normalized} is also {orcids[normalized]}")
                orcids[normalized] = key
            if orcid.get("status") == "oauth-verified":
                proof = orcid.get("assertion") or {}
                if origin != EXTERNAL_ORIGIN:
                    problems.append(f"{where}: an offline roster cannot carry an OAuth-verified ORCID iD")
                elif proof.get("basis") != "external-verified" or not (proof.get("evidence") or {}).get("reference"):
                    problems.append(f"{where}: OAuth verification needs external-verified evidence")
        membership = member.get("membership") or {}
        if membership.get("status") != LISTED:
            proof = membership.get("assertion") or {}
            if origin != EXTERNAL_ORIGIN:
                problems.append(f"{where}: an offline roster can only list members, not {membership.get('status')!r}")
            elif proof.get("basis") != "external-verified" or not (proof.get("evidence") or {}).get("reference"):
                problems.append(f"{where}: {membership.get('status')!r} needs external-verified evidence")

    if origin != EXTERNAL_ORIGIN:
        for where, assertion in _assertions(document):
            if assertion.get("basis") == "external-verified":
                problems.append(f"{where}: an offline roster cannot carry external-verified assertions")

    output_keys: set[str] = set()
    for index, output in enumerate(document.get("outputs", [])):
        if output.get("output_key") in output_keys:
            problems.append(f"outputs[{index}]: duplicate output key {output.get('output_key')!r}")
        output_keys.add(output.get("output_key"))
        if output.get("source_rights") not in SUPPORTED_SOURCE_RIGHTS:
            problems.append(f"outputs[{index}]: unsupported source rights {output.get('source_rights')!r}")

    seen_credit: set[tuple] = set()
    for index, credit in enumerate(document.get("contributions", [])):
        where = f"contributions[{index}]"
        if credit.get("member_key") not in member_keys:
            problems.append(f"{where}: refers to a member who is not in the export")
        if credit.get("output_key") not in output_keys:
            problems.append(f"{where}: refers to an output that is not in the export")
        if credit.get("credit_role") not in CREDIT_ROLES:
            problems.append(f"{where}: {credit.get('credit_role')!r} is not a CRediT role")
        identity = (credit.get("member_key"), credit.get("output_key"), credit.get("credit_role"))
        if identity in seen_credit:
            problems.append(f"{where}: duplicate contribution")
        seen_credit.add(identity)
        assertion = credit.get("assertion") or {}
        status = credit.get("status")
        if status not in CONTRIBUTION_STATUSES:
            problems.append(f"{where}: {status!r} roles cannot be exported; CRediT is never inferred")
        elif status == "source-declared" and not (assertion.get("evidence") or {}).get("reference"):
            problems.append(f"{where}: a source-declared role needs a reference to its source")
        elif status == "curator-confirmed" and not assertion.get("asserted_by"):
            problems.append(f"{where}: a curator-confirmed role must name who confirmed it")

    references = document.get("project_references", [])
    if references and redaction.get("project_references") != "included":
        problems.append("project references are present but redaction says they were omitted")
    for index, reference in enumerate(references):
        if reference.get("url") and not reference.get("sharing_approved"):
            problems.append(f"project_references[{index}]: URL shared without sharing approval")
    return problems


def candidate_contacts(document: dict[str, Any]) -> dict[str, Any]:
    """Reference consumer: read an export the way ORAtlas or Diggypaper should.

    The result proposes candidate contacts and carries credit claims for a
    human to review. It never contains grants, invitations or accounts, and no
    claim is confirmed by import.
    """
    problems = validate_export(document)
    if problems:
        raise RosterError("Invalid roster export: " + "; ".join(problems))
    if document["consent"]["status"] == "revoked":
        raise RosterError("Consent was revoked; discard any copy of this roster")
    return {
        "export_id": document["export_id"],
        "digest": document["digest"]["value"],
        "access_effect": dict(ACCESS_EFFECT),
        "grants": [],
        "invitations": [],
        "accounts": [],
        "candidates": [
            {
                "member_key": member["member_key"],
                "orcid": member["orcid"]["id"] if member["orcid"] else None,
                "orcid_status": member["orcid"]["status"] if member["orcid"] else None,
                "display_name": member["display_name"],
                "membership_status": member["membership"]["status"],
                "requires": list(JOIN_REQUIREMENTS),
            }
            for member in document["members"]
        ],
        "credit_claims": [
            {
                "member_key": credit["member_key"],
                "output_key": credit["output_key"],
                "credit_role": credit["credit_role"],
                "status": credit["status"],
                "confirmed_by_import": False,
            }
            for credit in document["contributions"]
        ],
    }
