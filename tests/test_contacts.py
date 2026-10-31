"""Contacts: private tags, notes and follow-ups for people met in a context."""
import io
import json
import zipfile

import pytest

from orcid_biosketch.network_store import NetworkStore
from test_network_http import request, running_server
from test_workspace_backup import ORCID_A, ORCID_B, populated


def test_tag_a_meeting_then_follow_up_over_http(tmp_path):
    with running_server(tmp_path) as server:
        request(server, "POST", "/api/demo", {})
        post = lambda path, body: request(server, "POST", path, body)
        status, state = post("/api/contacts/tags", {"person_ids": ["demo-ada", "demo-sam"],
                                                   "add": ["FENS 2026", " fens  2026 ", "Neuro"], "met_on": "2026-07-08"})
        assert status == 200
        assert state["contacts"]["demo-ada"]["tags"] == ["FENS 2026", "Neuro"]
        assert state["contacts"]["demo-sam"]["met_on"] == "2026-07-08"
        status, state = post("/api/contacts/notes", {"person_id": "demo-ada", "text": "Interested in the dataset"})
        assert status == 200 and state["contacts"]["demo-ada"]["notes"][0]["text"] == "Interested in the dataset"
        status, state = post("/api/contacts/actions", {"person_id": "demo-ada", "title": "Send the paper", "due_date": "2026-08-01"})
        action = state["contacts"]["demo-ada"]["actions"][0]
        assert action["status"] == "open" and action["done_at"] is None
        status, state = post("/api/contacts/actions/update", {"person_id": "demo-ada", "action_id": action["id"], "status": "done"})
        done = state["contacts"]["demo-ada"]["actions"][0]
        assert done["status"] == "done" and done["done_at"]
        status, state = post("/api/contacts/tags", {"person_ids": ["demo-ada"], "remove": ["neuro"]})
        assert state["contacts"]["demo-ada"]["tags"] == ["FENS 2026"]
        note = state["contacts"]["demo-ada"]["notes"][0]
        status, state = post("/api/contacts/delete", {"person_id": "demo-ada", "kind": "note", "entry_id": note["id"]})
        assert status == 200 and state["contacts"]["demo-ada"]["notes"] == []


@pytest.mark.parametrize("path,body", [
    ("/api/contacts/tags", {"person_ids": ["0000-0000-0000-0000"], "add": ["x"]}),
    ("/api/contacts/tags", {"person_ids": [], "add": ["x"]}),
    ("/api/contacts/tags", {"person_ids": ["demo-ada"], "add": ["x" * 61]}),
    ("/api/contacts/tags", {"person_ids": ["demo-ada"], "add": [str(i) for i in range(21)]}),
    ("/api/contacts/tags", {"person_ids": ["demo-ada"], "add": ["x"], "met_on": "2026-13-40"}),
    ("/api/contacts/notes", {"person_id": "demo-ada", "text": "  "}),
    ("/api/contacts/notes", {"person_id": "nobody", "text": "hi"}),
    ("/api/contacts/actions", {"person_id": "demo-ada", "title": "ok", "due_date": "soon"}),
    ("/api/contacts/actions/update", {"person_id": "demo-ada", "action_id": "nope", "status": "done"}),
    ("/api/contacts/delete", {"person_id": "demo-ada", "kind": "tag", "entry_id": "x"}),
])
def test_invalid_contact_requests_are_rejected_without_changes(tmp_path, path, body):
    with running_server(tmp_path) as server:
        request(server, "POST", "/api/demo", {})
        before = request(server)[1]
        status, result = request(server, "POST", path, body)
        assert status == 400 and "error" in result
        assert request(server)[1] == before


def test_contacts_are_private_to_the_workspace_not_shared_packs(tmp_path):
    store, group = populated(tmp_path / "a.sqlite3")
    store.tag_contacts([ORCID_A], add=["Secret meeting"])
    store.add_contact_note(ORCID_A, "private opinion about Ada")
    store.add_contact_action(ORCID_A, "private follow-up")
    assert "private" not in json.dumps(store.export_group_package(group))
    with zipfile.ZipFile(io.BytesIO(store.export_group(group))) as archive:
        assert all("private" not in archive.read(n).decode(errors="ignore") and
                   "Secret meeting" not in archive.read(n).decode(errors="ignore") for n in archive.namelist())


def test_workspace_backup_round_trips_contacts_and_rejects_forged_ones(tmp_path):
    store, _ = populated(tmp_path / "a.sqlite3")
    store.tag_contacts([ORCID_A, ORCID_B], add=["FENS 2026"], met_on="2026-07-08")
    store.add_contact_note(ORCID_B, "Met at the poster session")
    store.add_contact_action(ORCID_B, "Email him", "2026-08-01")
    document = store.export_data()
    other = NetworkStore(tmp_path / "b.sqlite3")
    other.import_data(document)
    assert other.state()["contacts"] == store.state()["contacts"]

    forged = json.loads(json.dumps(document))
    forged["data"]["contacts"]["0000-0000-0000-0001"] = {"tags": ["x"]}
    with pytest.raises(ValueError):
        NetworkStore(tmp_path / "c.sqlite3").import_data(forged)
    forged = json.loads(json.dumps(document))
    forged["data"]["contacts"][ORCID_B]["actions"][0]["status"] = "maybe"
    with pytest.raises(ValueError):
        NetworkStore(tmp_path / "d.sqlite3").import_data(forged)


def test_old_workspaces_without_contacts_still_load(tmp_path):
    store = NetworkStore(tmp_path / "a.sqlite3")
    store.add_demo()
    document = store.export_data()
    document["data"].pop("contacts", None)
    other = NetworkStore(tmp_path / "b.sqlite3")
    other.import_data(document)
    assert other.state()["contacts"] == {}
