"""Workspace backup/restore and team packages: strict, all-or-nothing, local only."""
import copy
import json

import pytest

from orcid_biosketch import playground
from orcid_biosketch.core import build_biosketch
from orcid_biosketch.network_store import NetworkStore

ORCID_A = "0000-0002-1825-0097"
ORCID_B = "0000-0001-5109-3700"


def bio(orcid, name, works):
    result = build_biosketch({"orcid-identifier": {"path": orcid}})
    result["person"]["name"] = name
    result["works"] = works
    return result


def work(code, doi, title):
    return {"title": title, "type": "journal-article", "publication_date": "2020-01",
            "identifiers": {"doi": doi} if doi else {}, "orcid_put_code": code, "url": "", "authors": []}


def populated(path):
    store = NetworkStore(path)
    store.add_demo()
    store.import_biosketch(bio(ORCID_A, "Ada Example", [work(1, "10.1/shared", "Shared paper"), work(2, None, "Solo note")]))
    store.import_biosketch(bio(ORCID_B, "Ben Example", [work(7, "10.1/shared", "Shared paper")]))
    store.follow(ORCID_B, False)
    store.save("doi:10.1/shared", True)
    group = store.create_group("Lab", "A working group", [ORCID_A, ORCID_B])
    store.set_group_member(group, ORCID_A, "PI", "Methods", "Leads the analysis")
    store.select_group_work(group, "doi:10.1/shared", True)
    store.create_group_request(group, "Draft the report", "By Friday", ORCID_B, "2026-11-30")
    return store, group


@pytest.fixture
def source(tmp_path):
    return populated(tmp_path / "source.sqlite3")


def test_round_trip_restores_the_same_workspace(source, tmp_path):
    store, _ = source
    document = json.loads(json.dumps(store.export_data()))
    assert document["format"] == "orcid-playground-workspace" and document["version"] == 1 and document["exported_at"]
    target = NetworkStore(tmp_path / "target.sqlite3")
    target.import_biosketch(bio("0000-0003-4820-7951", "Replaced", []))
    summary = target.import_data(document)
    assert summary["people"] == 2 and summary["sample_people"] == 3 and summary["groups"] == 2 and summary["saved"] == 1
    assert target.state() == store.state()
    assert target.export_data()["data"] == store.export_data()["data"]


def test_playground_checks_then_imports_a_backup(source, tmp_path):
    store, _ = source
    text = playground.Workspace(str(tmp_path / "source.sqlite3")).export_workspace()
    summary = json.loads(playground.check_workspace(text))
    assert "Lab" in summary["group_names"]
    workspace = playground.Workspace(str(tmp_path / "restored.sqlite3"))
    assert json.loads(workspace.import_workspace(text)) == summary
    assert workspace.store.state() == store.state()


def set_key(key, value):
    return lambda target: target.__setitem__(key, value)


def drop_key(key):
    return lambda target: target.pop(key)


BAD_FILES = [
    ("wrong format", [set_key("format", "something-else")], "not an ORCID Playground workspace"),
    ("future version", [set_key("version", 2)], "Unsupported workspace file version 2"),
    ("boolean version", [set_key("version", True)], "Unsupported workspace file version"),
    ("unexpected key", [set_key("extra", 1)], "unexpected fields"),
    ("missing data", [drop_key("data")], "missing data"),
    ("data version", ["data", set_key("version", 3)], "Unsupported workspace data version"),
    ("profiles list", ["data", set_key("profiles", [])], "profiles must be an object"),
    ("following text", ["data", "profiles", ORCID_A, set_key("following", "yes")], "true or false"),
    ("iD mismatch", ["data", "profiles", ORCID_A, "bio", "person", set_key("orcid", ORCID_B)], "does not match"),
    ("invalid iD", ["data", "profiles", ORCID_A, "bio", "person", set_key("orcid", "0000-0002-1825-0098")], "valid ORCID"),
    ("fake sample", ["data", "profiles", "demo-ada", "bio", set_key("demo", False)], "fictional demo"),
    ("stranger in group", ["data", "groups", "demo-open-science", set_key("member_ids", ["nobody"])], "imported researchers"),
    ("group id", ["data", "groups", "demo-open-science", set_key("id", "other")], "Group ids"),
    ("long role", ["data", "groups", "GROUP", "member_details", ORCID_A, set_key("role", "x" * 121)], "Role"),
    ("details for outsider", ["data", "groups", "GROUP", "member_details", set_key("demo-ada", {"role": "x"})], "not a member"),
    ("bad status", ["data", "groups", "GROUP", "requests", 0, set_key("status", "done")], "open or resolved"),
    ("bad due date", ["data", "groups", "GROUP", "requests", 0, set_key("due_date", "2026-02-30")], "real date"),
    ("saved numbers", ["data", set_key("saved", [1])], "list of strings"),
    ("event shape", ["data", set_key("events", {"k": {"observed_at": 5}})], "observed_at"),
]


@pytest.mark.parametrize("name, path, message", BAD_FILES, ids=[case[0] for case in BAD_FILES])
def test_bad_files_are_rejected_without_any_change(source, tmp_path, name, path, message):
    store, group = source
    document = json.loads(json.dumps(store.export_data()))
    path = [group if key == "GROUP" else key for key in path]
    target = document
    for key in path[:-1]:
        target = target[key]
    path[-1](target)
    target_store = NetworkStore(tmp_path / "target.sqlite3")
    target_store.add_demo()
    before = target_store.export_data()["data"]
    with pytest.raises(ValueError, match=message):
        target_store.import_data(document)
    assert target_store.export_data()["data"] == before


@pytest.mark.parametrize("text, message", [
    ("not json", "not valid JSON"),
    ('{"format": "orcid-playground-workspace", "version": 1, "exported_at": "x", "data": NaN}', "not valid JSON|Non-finite"),
    ("[]", "not an ORCID Playground workspace"),
])
def test_playground_rejects_unreadable_files(tmp_path, text, message):
    workspace = playground.Workspace(str(tmp_path / "w.sqlite3"))
    with pytest.raises(ValueError, match=message):
        workspace.import_workspace(text)
    with pytest.raises(ValueError, match=message):
        playground.check_workspace(text)


def test_a_failure_while_writing_leaves_the_workspace_untouched(source, tmp_path, monkeypatch):
    store, _ = source
    target = NetworkStore(tmp_path / "target.sqlite3")
    target.add_demo()
    before = target.export_data()["data"]
    valid, summary = NetworkStore.validate_export(store.export_data())
    # Something unserialisable reaches the write itself, after the old data was cleared in memory.
    broken = {**valid, "unserialisable": {1, 2}}
    monkeypatch.setattr(NetworkStore, "validate_export", classmethod(lambda cls, document: (broken, summary)))
    with pytest.raises(TypeError):
        target.import_data({})
    monkeypatch.undo()
    assert target.export_data()["data"] == before


# ---- Team packages ---------------------------------------------------------

def test_team_package_round_trip_adds_a_new_group_with_local_details(source, tmp_path):
    store, group = source
    package = json.loads(json.dumps(store.export_group_package(group)))
    assert package["format"] == "orcid-playground-team-group" and set(package["profiles"]) == {ORCID_A, ORCID_B}
    target = NetworkStore(tmp_path / "target.sqlite3")
    target.import_biosketch(bio(ORCID_B, "Ben, local copy", []))

    preview = target.preview_group_package(package)
    assert target.state()["groups"] == []  # Previewing writes nothing.
    assert preview["name"] == "Lab" and preview["selected_outputs"] == ["Shared paper"]
    members = {m["id"]: m for m in preview["members"]}
    assert members[ORCID_A]["role"] == "PI" and members[ORCID_A]["contribution"] == "Leads the analysis"
    assert members[ORCID_A]["in_network"] is False and members[ORCID_B]["in_network"] is True
    assert preview["requests"] == [{"title": "Draft the report", "status": "open", "due_date": "2026-11-30", "owner": "Ben Example"}]

    group_id = target.import_group_package(package)
    state = target.state()
    imported = next(g for g in state["groups"] if g["id"] == group_id)
    assert imported["member_details"][ORCID_A]["role"] == "PI"
    assert imported["requests"][0]["owner_id"] == ORCID_B
    # Ben's local copy is kept, so the shared paper is still selected through Ada's record.
    assert imported["selected_work_ids"] == ["doi:10.1/shared"]
    assert {p["id"]: p["name"] for p in state["people"]}[ORCID_B] == "Ben, local copy"
    # Importing twice adds a second group rather than overwriting the first.
    assert target.import_group_package(package) != group_id and len(target.state()["groups"]) == 2


def test_team_package_through_the_playground_workspace(source, tmp_path):
    store, group = source
    text = playground.Workspace(str(tmp_path / "source.sqlite3")).export_group_package(group)
    workspace = playground.Workspace(str(tmp_path / "target.sqlite3"))
    assert json.loads(workspace.preview_group_package(text))["members"]
    group_id = json.loads(workspace.import_group_package(text))["group_id"]
    assert [g["id"] for g in workspace.store.state()["groups"]] == [group_id]


@pytest.mark.parametrize("change, message", [
    (lambda p: p.__setitem__("format", "orcid-playground-workspace"), "team package"),
    (lambda p: p.__setitem__("version", 2), "Unsupported team package version 2"),
    (lambda p: p["profiles"].pop(ORCID_B), "imported researchers"),
    (lambda p: p["group"]["member_ids"].remove(ORCID_B), "match its members|Request owner"),
    (lambda p: p["profiles"][ORCID_A].__setitem__("following", True), "unexpected fields"),
    (lambda p: p["group"]["requests"][0].__setitem__("owner_id", "someone"), "Request owner"),
    (lambda p: p["group"].__setitem__("name", " "), "Group name"),
])
def test_bad_team_packages_are_rejected_without_any_change(source, tmp_path, change, message):
    store, group = source
    package = copy.deepcopy(store.export_group_package(group))
    change(package)
    target = NetworkStore(tmp_path / "target.sqlite3")
    before = target.export_data()["data"]
    with pytest.raises(ValueError, match=message):
        target.preview_group_package(package)
    with pytest.raises(ValueError, match=message):
        target.import_group_package(package)
    assert target.export_data()["data"] == before
