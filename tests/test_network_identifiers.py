"""Ensure related-object DOIs cannot merge distinct network outputs."""

import pytest

from orcid_biosketch.core import build_biosketch
from orcid_biosketch.network_store import NetworkStore


ORCID_A = "0000-0002-1825-0097"
ORCID_B = "0000-0001-5109-3700"


def identifier(value, relationship=None, kind="doi"):
    result = {"external-id-type": kind, "external-id-value": value}
    if relationship is not None:
        result["external-id-relationship"] = relationship
    return result


def biosketch(orcid, title, identifiers):
    return build_biosketch({
        "orcid-identifier": {"path": orcid},
        "activities-summary": {"works": {"group": [{"work-summary": [{
            "put-code": 1,
            "title": {"title": {"value": title}},
            "type": "book-chapter",
            "external-ids": {"external-id": identifiers},
        }]}]}},
    })


@pytest.mark.parametrize("relationship", ["part-of", "funded-by", "version-of"])
def test_related_doi_cannot_merge_distinct_researcher_outputs(tmp_path, relationship):
    store = NetworkStore(tmp_path / "network.sqlite3")
    shared_parent = identifier("10.1234/shared-parent", relationship)
    store.import_biosketch(biosketch(ORCID_A, "Chapter one", [shared_parent]))
    store.import_biosketch(biosketch(ORCID_B, "Chapter two", [shared_parent]))
    works = store.state()["works"]
    assert len(works) == 2
    assert all(work["doi"] == "" for work in works)
    assert {tuple(work["people_ids"]) for work in works} == {(ORCID_A,), (ORCID_B,)}


@pytest.mark.parametrize("relationship", ["part-of", "funded-by", "version-of"])
def test_later_related_doi_cannot_replace_self_doi(relationship):
    bio = biosketch(ORCID_A, "Chapter one", [
        identifier("10.1234/chapter-one", "self"),
        identifier("10.1234/related-object", relationship),
        identifier("9781234567897", "part-of", "isbn"),
    ])
    # Contextual identifiers remain available to existing citation exporters.
    assert bio["works"][0]["identifiers"] == {
        "doi": "10.1234/chapter-one", "isbn": "9781234567897",
    }


def test_legacy_missing_relationship_still_deduplicates_same_work(tmp_path):
    store = NetworkStore(tmp_path / "network.sqlite3")
    legacy = identifier("10.1234/shared")
    store.import_biosketch(biosketch(ORCID_A, "Shared work", [legacy]))
    store.import_biosketch(biosketch(ORCID_B, "Shared work", [legacy]))
    work, = store.state()["works"]
    assert work["people_ids"] == [ORCID_A, ORCID_B]


@pytest.mark.parametrize("reverse", [False, True])
def test_explicit_self_doi_takes_precedence_over_legacy_identifier(reverse):
    ids = [identifier("10.1234/self", "self"), identifier("10.1234/legacy")]
    bio = biosketch(ORCID_A, "One work", list(reversed(ids)) if reverse else ids)
    assert bio["works"][0]["identifiers"]["doi"] == "10.1234/self"
