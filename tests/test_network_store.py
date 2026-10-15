import copy
import io
import json
import tempfile
import zipfile
from concurrent.futures import ThreadPoolExecutor

import pytest

from orcid_biosketch.core import build_biosketch
from orcid_biosketch.network_store import NetworkStore


ORCID_A = "0000-0002-1825-0097"
ORCID_B = "0000-0001-5109-3700"


def bio(orcid=ORCID_A, works=None):
    result = build_biosketch({"orcid-identifier": {"path": orcid}})
    result["person"]["name"] = "Test Researcher"
    result["works"] = works or []
    return result


def work(code=1, doi="10.1234/example", title="Example work"):
    return {"title": title, "type": "journal-article", "publication_date": "2020-01",
            "identifiers": {"doi": doi} if doi else {}, "orcid_put_code": code,
            "url": "", "authors": []}


@pytest.fixture
def store(tmp_path):
    return NetworkStore(tmp_path / "network.sqlite3")


def test_first_import_is_baseline_and_new_work_is_observation(store):
    store.import_biosketch(bio(works=[work()]))
    assert store.state()["events"] == []
    updated = bio(works=[work(), work(2, "10.1234/second")])
    store.import_biosketch(updated)
    event, = store.state()["events"]
    assert event["kind"] == "work-added"
    assert event["observed_at"] != updated["works"][1]["publication_date"]
    updated["works"][1]["title"] = "Corrected title"
    store.import_biosketch(updated)
    assert store.state()["events"] == [event]


def test_doi_deduplicates_people_events_and_team_bibliography(store):
    store.import_biosketch(bio())
    store.import_biosketch(bio(ORCID_B))
    store.import_biosketch(bio(works=[work(1, "https://doi.org/10.1234/EXAMPLE")]))
    store.import_biosketch(bio(ORCID_B, [work(44)]))
    state = store.state()
    shared, = state["works"]
    event, = state["events"]
    assert shared["people_ids"] == [ORCID_A, ORCID_B]
    assert event["people_ids"] == shared["people_ids"]
    group = store.create_group("Team", "A local group", [ORCID_A, ORCID_B])
    with zipfile.ZipFile(io.BytesIO(store.export_group(group))) as archive:
        assert archive.read("bibliography.ris").decode().count("TY  - JOUR") == 1
        assert "AU  -" not in archive.read("bibliography.ris").decode()
        assert "unconfirmed" in archive.read("roster.csv").decode()
        assert f"biosketches/{ORCID_A}.md" in archive.namelist()


def test_removed_works_are_pruned_from_saved_events_and_exports(store):
    store.import_biosketch(bio())
    store.import_biosketch(bio(works=[work()]))
    key = store.state()["works"][0]["id"]
    store.save(key, True)
    group = store.create_group("Team", "", [ORCID_A])
    store.import_biosketch(bio())
    assert store.state()["works"] == []
    assert store.state()["events"] == []
    with zipfile.ZipFile(io.BytesIO(store.export_group(group))) as archive:
        assert "Example work" not in archive.read("bibliography.bib").decode()
        assert json.loads(archive.read(f"biosketches/{ORCID_A}.json"))["works"] == []


def test_shared_work_remains_when_only_one_researcher_removes_it(store):
    store.import_biosketch(bio(works=[work()]))
    store.import_biosketch(bio(ORCID_B, [work(44)]))
    store.import_biosketch(bio())
    assert store.state()["works"][0]["people_ids"] == [ORCID_B]


def test_refresh_preserves_explicit_unfollow(store):
    store.import_biosketch(bio())
    assert store.state()["people"][0]["following"]
    store.follow(ORCID_A, False)
    store.import_biosketch(bio(works=[work()]))
    assert not store.state()["people"][0]["following"]


def test_shared_baseline_does_not_inherit_other_researchers_observation(store):
    store.import_biosketch(bio())
    store.import_biosketch(bio(works=[work()]))
    store.import_biosketch(bio(ORCID_B, [work(44)]))
    state = store.state()
    assert state["works"][0]["people_ids"] == [ORCID_A, ORCID_B]
    assert state["events"][0]["people_ids"] == [ORCID_A]
    store.import_biosketch(bio())
    assert store.state()["works"][0]["people_ids"] == [ORCID_B]
    assert store.state()["events"] == []


def test_adding_doi_is_metadata_change_and_preserves_saved_state(store):
    store.import_biosketch(bio(works=[work(doi="")]))
    store.save(store.state()["works"][0]["id"], True)
    store.import_biosketch(bio(works=[work()]))
    state = store.state()
    assert state["events"] == []
    assert state["works"][0]["saved"]


def test_demo_is_explicit_idempotent_and_preserves_user_edits(store):
    store.add_demo()
    state = store.state()
    assert len(state["people"]) == 3
    assert len(state["works"]) == 3
    assert all(p["demo"] and p["orcid"] is None for p in state["people"])
    assert all(w["demo"] and w["title"].startswith("[Demo]") and not w["doi"] for w in state["works"])
    store.follow("demo-ada", False)
    group_id = state["groups"][0]["id"]
    store.update_group(group_id, "Changed", "", ["demo-ada"])
    store.add_demo()
    assert not store.state()["people"][0]["following"]
    assert store.state()["groups"][0]["name"] == "Changed"
    with zipfile.ZipFile(io.BytesIO(store.export_group(group_id))) as archive:
        assert "Fictional demonstration profile" in archive.read("biosketches/demo-ada.md").decode()
        assert "ORCID:" not in archive.read("biosketches/demo-ada.md").decode()


def test_persistence_and_independent_instances_do_not_lose_mutations(store):
    store.add_demo()
    path = store.path
    def create(index):
        NetworkStore(path).create_group(f"Group {index}", "", ["demo-ada"])
    with ThreadPoolExecutor(max_workers=6) as executor:
        list(executor.map(create, range(18)))
    assert len(NetworkStore(path).state()["groups"]) == 19
    copied = store.state()
    copied["people"].clear()
    assert len(store.state()["people"]) == 3


def test_invalid_mutations_roll_back(store):
    store.add_demo()
    initial = copy.deepcopy(store.state())
    operations = [lambda: store.follow("missing", True), lambda: store.follow("demo-ada", "yes"),
                  lambda: store.save("missing", True), lambda: store.create_group("", "", []),
                  lambda: store.create_group("Team", "", ["missing"]),
                  lambda: store.update_group("missing", "Team", "", []),
                  lambda: store.import_biosketch({"person": {"orcid": "invalid"}}),
                  lambda: store.export_group("missing")]
    for operation in operations:
        with pytest.raises(ValueError):
            operation()
        assert store.state() == initial


def test_csv_roster_neutralizes_formula_text(store):
    record = bio()
    record["person"]["name"] = "=1+1"
    store.import_biosketch(record)
    group = store.create_group("Team", "", [ORCID_A])
    with zipfile.ZipFile(io.BytesIO(store.export_group(group))) as archive:
        assert "'=1+1" in archive.read("roster.csv").decode()


def test_group_bibliography_uses_only_member_metadata(store):
    store.import_biosketch(bio(works=[work(title="Nonmember draft title")]))
    store.import_biosketch(bio(ORCID_B, [work(44, title="Member corrected title")]))
    group = store.create_group("Member-only group", "", [ORCID_B])
    with zipfile.ZipFile(io.BytesIO(store.export_group(group))) as archive:
        bibliography = archive.read("bibliography.bib").decode()
        assert "Member corrected title" in bibliography
        assert "Nonmember draft title" not in bibliography


def test_schemeless_doi_link_deduplicates(store):
    store.import_biosketch(bio(works=[work(doi="doi.org/10.1234/EXAMPLE")]))
    store.import_biosketch(bio(ORCID_B, [work(44)]))
    shared, = store.state()["works"]
    assert shared["people_ids"] == [ORCID_A, ORCID_B]


def test_store_leaves_no_database_handles_open():
    # Especially important on Windows, which refuses to unlink an open database.
    from pathlib import Path
    with tempfile.TemporaryDirectory() as directory:
        workspace = NetworkStore(Path(directory) / "network.sqlite3")
        workspace.add_demo()
        workspace.state()
        workspace.path.unlink()
