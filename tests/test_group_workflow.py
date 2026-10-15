import csv
import io
import json
import sqlite3
import zipfile
from concurrent.futures import ThreadPoolExecutor

import pytest

from orcid_biosketch.core import build_biosketch
from orcid_biosketch.network_store import NetworkStore


A = "0000-0002-1825-0097"
B = "0000-0001-5109-3700"


def bio(person_id=A, dates=("2020",)):
    record = build_biosketch({"orcid-identifier": {"path": person_id}})
    record["person"]["name"] = "Test Researcher"
    record["works"] = [{"title": f"Work {index}", "type": "journal-article",
                        "publication_date": day, "identifiers": {"doi": f"10.1234/{index}"},
                        "orcid_put_code": index, "url": ""} for index, day in enumerate(dates)]
    return record


@pytest.fixture
def store(tmp_path):
    result = NetworkStore(tmp_path / "network.sqlite3")
    result.import_biosketch(bio())
    result.import_biosketch(bio(B))
    return result


def group_state(store, group_id):
    return next(group for group in store.state()["groups"] if group["id"] == group_id)


def test_legacy_workspace_defaults_and_persistence(store):
    group_id = store.create_group("Legacy team", "", [A])
    with sqlite3.connect(store.path) as connection:
        data = json.loads(connection.execute("SELECT data FROM workspace WHERE id=1").fetchone()[0])
        for key in ("member_details", "selected_work_ids", "requests"):
            del data["groups"][group_id][key]
        connection.execute("UPDATE workspace SET data=? WHERE id=1", (json.dumps(data),))
    assert group_state(store, group_id)["member_details"] == {}
    store.set_group_member(group_id, A, "Coordinator", "Methods", "Study design")
    assert group_state(NetworkStore(store.path), group_id)["member_details"][A]["role"] == "Coordinator"


def test_concurrent_appends_preserve_roster_and_details(store):
    group_id = store.create_group("Team", "Description", [])
    def append(person_id):
        NetworkStore(store.path).add_group_members(group_id, [person_id])
    with ThreadPoolExecutor(max_workers=4) as executor:
        list(executor.map(append, [A, B] * 6))
    store.set_group_member(group_id, A, "Lead", "", "")
    store.add_group_members(group_id, [A])
    group = group_state(store, group_id)
    assert set(group["member_ids"]) == {A, B}
    assert len(group["member_ids"]) == 2
    assert group["member_details"][A]["role"] == "Lead"
    assert group["description"] == "Description"
    with pytest.raises(ValueError):
        store.add_group_members(group_id, [A, "unknown"])
    assert group_state(store, group_id) == group


def test_removed_members_prune_attribution_and_clear_request_owner(store):
    store.import_biosketch(bio(B, ()))
    group_id = store.create_group("Team", "", [A, B])
    store.set_group_member(group_id, A, "Lead", "Methods", "Design")
    store.select_group_work(group_id, "doi:10.1234/0", True)
    store.create_group_request(group_id, "Review protocol", "Please review", A, "2028-02-29")
    request = group_state(store, group_id)["requests"][0]
    store.set_group_request_status(group_id, request["id"], "resolved")
    store.update_group(group_id, "Team", "", [B])
    group = group_state(store, group_id)
    assert group["member_details"] == {}
    assert group["selected_work_ids"] == []
    assert group["requests"][0]["owner_id"] is None
    assert group["requests"][0]["status"] == "resolved"
    store.set_group_request_status(group_id, request["id"], "open")
    assert group_state(store, group_id)["requests"][0]["status"] == "open"


def test_doi_migration_preserves_project_selection_and_refresh_prunes(store):
    record = bio()
    record["works"][0]["identifiers"] = {}
    store.import_biosketch(record)
    group_id = store.create_group("Team", "", [A])
    store.select_group_work(group_id, f"orcid:{A}:0", True)
    store.import_biosketch(bio())
    assert group_state(store, group_id)["selected_work_ids"] == ["doi:10.1234/0"]
    store.import_biosketch(bio(A, ()))
    # A nonmember still has this DOI, which must not keep it selected for the group.
    assert group_state(store, group_id)["selected_work_ids"] == []


def test_scoped_pack_filters_members_dates_and_every_biosketch(store):
    store.import_biosketch(bio(A, ("2020", "2020-02", "2020-03-01", "", "2019", "2020-02-30")))
    group_id = store.create_group("Team", "", [A, B])
    for index in range(6):
        store.select_group_work(group_id, f"doi:10.1234/{index}", True)
    store.set_group_member(group_id, A, "=1+1", "+formula", "@command")
    store.set_group_member(group_id, B, "Excluded member", "", "")
    store.create_group_request(group_id, "Included request", "", A)
    store.create_group_request(group_id, "Unassigned request", "")
    store.create_group_request(group_id, "Excluded request", "", B)
    packed = store.export_group(group_id, scope="project", date_from="2020-02-15",
                                date_to="2020-02-29", member_ids=[A])
    with zipfile.ZipFile(io.BytesIO(packed)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["work_ids"] == ["doi:10.1234/0", "doi:10.1234/1"]
        assert manifest["scope"] == "project"
        assert manifest["member_ids"] == [A]
        assert "unknown" in manifest["date_filter_policy"]
        assert "unconfirmed" in manifest["attribution"]
        exported_group = json.loads(archive.read("group.json"))
        assert exported_group["member_ids"] == [A]
        assert list(exported_group["member_details"]) == [A]
        assert exported_group["selected_work_ids"] == manifest["work_ids"]
        assert [request["title"] for request in exported_group["requests"]] == ["Included request", "Unassigned request"]
        record = json.loads(archive.read(f"biosketches/{A}.json"))
        assert [work["title"] for work in record["works"]] == ["Work 0", "Work 1"]
        assert f"biosketches/{B}.json" not in archive.namelist()
        assert "Work 2" not in archive.read(f"biosketches/{A}.md").decode()
        assert archive.read("bibliography.ris").decode().count("TY  - JOUR") == 2
        roster = list(csv.DictReader(io.StringIO(archive.read("roster.csv").decode("utf-8-sig"))))
        assert len(roster) == 1
        assert roster[0]["role"] == "'=1+1"
        assert roster[0]["expertise"] == "'+formula"
        assert roster[0]["contribution"] == "'@command"
    # Export filtering must never alter the stored researcher records.
    assert len(store.state()["works"]) == 6


def test_project_scope_requires_explicit_selection_and_legacy_exports_all(store):
    group_id = store.create_group("Team", "", [A, B])
    for scope, count in (("project", 0), ("members", 1)):
        with zipfile.ZipFile(io.BytesIO(store.export_group(group_id, scope=scope))) as archive:
            assert json.loads(archive.read("manifest.json"))["work_count"] == count
            assert len(json.loads(archive.read(f"biosketches/{A}.json"))["works"]) == count
    with zipfile.ZipFile(io.BytesIO(store.export_group(group_id))) as archive:
        assert json.loads(archive.read("manifest.json"))["scope"] == "members"


def test_invalid_values_fail_without_mutating_workspace(store):
    group_id = store.create_group("Team", "", [A])
    initial = store.state()
    operations = [
        lambda: store.set_group_member(group_id, B, "Lead", "", ""),
        lambda: store.set_group_member(group_id, A, "x" * 121, "", ""),
        lambda: store.set_group_member(group_id, A, {}, "", ""),
        lambda: store.set_group_member(group_id, A, "", "x" * 501, ""),
        lambda: store.set_group_member(group_id, A, "", "", "x" * 1001),
        lambda: store.select_group_work(group_id, "doi:10.1234/0", 1),
        lambda: store.select_group_work(group_id, "missing", True),
        lambda: store.create_group_request(group_id, " ", ""),
        lambda: store.create_group_request(group_id, "x" * 161, ""),
        lambda: store.create_group_request(group_id, "Title", "x" * 2001),
        lambda: store.create_group_request(group_id, "Title", "", B),
        lambda: store.create_group_request(group_id, "Title", "", []),
        lambda: store.create_group_request(group_id, "Title", "", due_date="2026-02-29"),
        lambda: store.create_group_request(group_id, "Title", "", due_date=None),
        lambda: store.set_group_request_status(group_id, "unknown", "open"),
        lambda: store.set_group_request_status(group_id, "unknown", True),
        lambda: store.export_group(group_id, scope=None),
        lambda: store.export_group(group_id, date_from="2020-01"),
        lambda: store.export_group(group_id, date_to="2020-02-30"),
        lambda: store.export_group(group_id, date_from="2021-01-01", date_to="2020-01-01"),
        lambda: store.export_group(group_id, member_ids=[]),
        lambda: store.export_group(group_id, member_ids=[B]),
        lambda: store.export_group(group_id, member_ids=A),
    ]
    for operation in operations:
        with pytest.raises(ValueError):
            operation()
        assert store.state() == initial
