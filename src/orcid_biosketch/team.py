"""Group-level reports for coordinators, built only from members' public records.

Health re-expresses each member's record check; the team biosketch stitches the
members' funder templates together under a summary whose joint outputs are the
DOIs both records assert. Neither invents roles, membership or collaborations:
both say plainly that the group is curated by whoever assembled it.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from statistics import mean
from typing import Any

from . import lint as quality
from .collaboration import collaboration_graph
from .exporters import available_templates, render_template

SEVERITY_ORDER = {"error": 0, "warning": 1, "info": 2}
# Plain-language names for the record checks in lint.py, for coordinators.
CHECK_LABELS = {
    "works.identifiers": "Outputs without a DOI or other identifier",
    "works.missing": "No outputs listed",
    "works.publication_date": "Outputs without a publication date",
    "works.self_asserted": "Outputs added by hand rather than from a trusted source",
    "works.duplicates": "Duplicate outputs",
    "works.venue": "Outputs without a journal or venue",
    "works.title": "Outputs without a title",
    "person.biography": "Short or missing biography",
    "person.keywords": "Few or no keywords",
    "person.urls": "No website links",
    "affiliations.employment": "No employment listed",
    "affiliations.education": "No education listed",
    "affiliations.org_ids": "Organisations without a ROR or other identifier",
    "fundings": "No funding listed",
    "provenance.freshness": "Record not updated recently",
}
BASIS = ("Built from public ORCID records. Group membership was assembled by whoever shared it "
         "and is not confirmed by the people listed.")


def _identity(bio: dict[str, Any]) -> tuple[str, str]:
    person = bio.get("person") if isinstance(bio.get("person"), dict) else {}
    orcid = str(person.get("orcid") or "")
    return orcid, str(person.get("name") or "") or orcid


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def group_health(bios: list[dict[str, Any]]) -> dict[str, Any]:
    """Each member's record check, plus the issues ranked by how many members share them."""
    members, issues = [], {}
    for bio in bios:
        orcid, name = _identity(bio)
        report = quality.lint(bio)
        findings = sorted(report["findings"], key=lambda f: (SEVERITY_ORDER.get(f.get("severity"), 3), -float(f.get("points_lost") or 0)))
        members.append({"orcid": orcid, "name": name, "percentage": report["percentage"],
                        "grade": report["grade"], "findings": findings})
        for finding in findings:
            issue = issues.setdefault(finding["check"], {"check": finding["check"], "label": CHECK_LABELS.get(finding["check"], finding["check"]),
                                                         "severity": finding.get("severity"),
                                                         "fix": finding.get("fix", ""), "members": []})
            issue["members"].append({"orcid": orcid, "name": name, "message": finding.get("message", "")})
    score = round(mean(m["percentage"] for m in members)) if members else 0
    ranked = sorted(issues.values(), key=lambda i: (-len(i["members"]), SEVERITY_ORDER.get(i["severity"], 3), i["check"]))
    return {
        "score": score,
        "grade": next(grade for threshold, grade in quality.GRADE_THRESHOLDS if score >= threshold),
        "members": sorted(members, key=lambda m: (m["percentage"], m["name"])),
        "issues": ranked,
        "basis": "The average of each member's record check. Every fix is made by the member in their own ORCID record.",
    }


def render_health(health: dict[str, Any], group_name: str) -> str:
    """Markdown a coordinator can send to members: shared issues first, then per person."""
    lines = [f"# Record health: {group_name}", "",
             f"Group score {health['score']}% (grade {health['grade']}), {health['basis'].lower()}", "",
             f"_{BASIS} Checked {_now()}._", "", "## Most common issues", ""]
    if not health["issues"]:
        lines.append("No issues found.")
    for issue in health["issues"]:
        names = ", ".join(m["name"] for m in issue["members"])
        lines += [f"- **{issue['label']}** ({issue['severity']}): {len(issue['members'])} of {len(health['members'])} members ({names}).",
                  f"  Fix: {issue['fix']}"]
    lines += ["", "## By member", ""]
    for member in health["members"]:
        lines += [f"### {member['name']} ({member['orcid']}): {member['percentage']}%, grade {member['grade']}", ""]
        lines += [f"- {f['message']} Fix: {f.get('fix', '')}" for f in member["findings"]] or ["- No issues found."]
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _demote(markdown: str) -> str:
    """Nest a member's template under the team document's headings."""
    return re.sub(r"^(#{1,5}) ", lambda m: "#" * (len(m.group(1)) + 1) + " ", markdown, flags=re.MULTILINE)


def team_biosketch(bios: list[dict[str, Any]], template: str, group_name: str) -> str:
    """One funder document for the team: a summary, joint outputs, then each member's template."""
    if template not in available_templates():
        raise ValueError(f"Unknown template {template!r}; available: {', '.join(available_templates())}")
    graph = collaboration_graph(bios)
    names = {orcid: name for orcid, name in map(_identity, bios)}
    lines = [f"# Team biosketch: {group_name}", "",
             f"_Draft for the {template.upper()} format. {BASIS} Generated {_now()}; review and complete every section before use._", "",
             "## Team", "", "| Member | ORCID iD | Current position |", "|---|---|---|"]
    for bio in bios:
        orcid, name = _identity(bio)
        current = next((e for e in bio.get("employment") or [] if isinstance(e, dict) and not e.get("end_date")), {})
        position = ", ".join(x for x in (current.get("role"), current.get("organization")) if x) or "Not stated in the record"
        lines.append(f"| {name.replace('|', '/')} | https://orcid.org/{orcid} | {position.replace('|', '/')} |")
    lines += ["", "## Joint outputs", "",
              "Outputs whose DOI appears in more than one member's public record.", ""]
    shared = graph["shared_outputs"]
    lines += [f"- {o['title'] or 'Untitled'} ({o['year'] or 'n.d.'}), https://doi.org/{o['doi']}. "
              f"Asserted by {', '.join(names.get(m, m) for m in o['members'])}." for o in shared[:15]] or [
              "None found: no DOI is asserted by more than one member's record."]
    for bio in bios:
        lines += ["", "---", "", _demote(render_template(bio, template)).strip()]
    return "\n".join(lines).rstrip() + "\n"
