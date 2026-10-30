"""Evidence-backed views of a group of public ORCID records.

Two members are linked only when both of their records assert the same DOI, and
every link carries those DOIs so anyone can check it. Nothing is inferred from
names, affiliations or co-occurrence; a member without DOI-identified outputs is
shown unlinked rather than guessed at.
"""
from __future__ import annotations

import re
from itertools import combinations
from typing import Any

_DOI_PREFIX = re.compile(r"^(?:(?:https?://)?(?:dx\.)?doi\.org/|doi:\s*)", re.IGNORECASE)


def doi_key(work: Any) -> str:
    """The work's DOI in lower case without resolver prefixes, or ``""``."""
    identifiers = work.get("identifiers") if isinstance(work, dict) else None
    if not isinstance(identifiers, dict):
        return ""
    value = next((str(v or "") for k, v in identifiers.items() if str(k).lower() == "doi"), "")
    return _DOI_PREFIX.sub("", value.strip()).strip().lower()


def _member(bio: dict[str, Any]) -> tuple[str, str]:
    person = bio.get("person") if isinstance(bio.get("person"), dict) else {}
    return str(person.get("orcid") or ""), str(person.get("name") or "") or str(person.get("orcid") or "")


def collaboration_graph(bios: list[dict[str, Any]]) -> dict[str, Any]:
    """Members as nodes; an edge for each pair whose records assert a shared DOI."""
    nodes, holders, titles = [], {}, {}
    for bio in bios:
        orcid, name = _member(bio)
        if not orcid or any(n["orcid"] == orcid for n in nodes):
            continue
        dois = set()
        works = [w for w in bio.get("works") or [] if isinstance(w, dict)]
        for work in works:
            doi = doi_key(work)
            if doi:
                dois.add(doi)
                holders.setdefault(doi, set()).add(orcid)
                titles.setdefault(doi, {"title": str(work.get("title") or ""),
                                        "year": str(work.get("publication_date") or "")[:4]})
        nodes.append({"orcid": orcid, "name": name, "work_count": len(works), "doi_count": len(dois)})

    shared = sorted(
        ({"doi": doi, **titles[doi], "members": sorted(members)}
         for doi, members in holders.items() if len(members) > 1),
        key=lambda item: (item["year"], item["doi"]), reverse=True)
    edges: dict[tuple[str, str], list[dict[str, str]]] = {}
    for item in shared:
        for pair in combinations(item["members"], 2):
            edges.setdefault(pair, []).append({"doi": item["doi"], "title": item["title"], "year": item["year"]})
    linked = {orcid for pair in edges for orcid in pair}
    return {
        "nodes": [{**node, "linked": node["orcid"] in linked} for node in nodes],
        "edges": [{"source": a, "target": b, "outputs": outputs} for (a, b), outputs in sorted(edges.items())],
        "shared_outputs": shared,
        "basis": "Members are linked only when both public records assert the same DOI.",
    }


def group_bibliography(bios: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Every member's works, merged by DOI, newest first, with who asserts each."""
    merged: dict[str, dict[str, Any]] = {}
    for bio in bios:
        orcid, _ = _member(bio)
        for work in bio.get("works") or []:
            if not isinstance(work, dict):
                continue
            doi = doi_key(work)
            key = f"doi:{doi}" if doi else f"orcid:{orcid}:{work.get('orcid_put_code') or work.get('title')}"
            entry = merged.setdefault(key, {**work, "asserted_by": []})
            if orcid and orcid not in entry["asserted_by"]:
                entry["asserted_by"].append(orcid)
    return sorted(merged.values(), key=lambda w: str(w.get("publication_date") or ""), reverse=True)
