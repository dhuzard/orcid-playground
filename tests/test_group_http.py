"""HTTP contracts for locally curated working groups and scoped reports."""
import io
import json
import zipfile

import pytest

from test_network_http import request, running_server


def seeded(server):
    status, state = request(server, "POST", "/api/demo", {})
    assert status == 200
    return state, state["groups"][0]


def test_roster_contribution_selection_request_and_scoped_pack(tmp_path):
    with running_server(tmp_path) as server:
        state, group = seeded(server)
        person_id = group["member_ids"][0]
        work = next(w for w in state["works"] if person_id in w["people_ids"])
        status, state = request(server, "POST", "/api/groups/member", {
            "id": group["id"], "person_id": person_id, "role": "Coordinator",
            "expertise": "Study methods", "contribution": "Preparing the protocol",
        })
        assert status == 200
        assert state["groups"][0]["member_details"][person_id]["role"] == "Coordinator"
        status, state = request(server, "POST", "/api/groups/output", {
            "id": group["id"], "work_id": work["id"], "selected": True,
        })
        assert status == 200 and work["id"] in state["groups"][0]["selected_work_ids"]
        status, state = request(server, "POST", "/api/groups/requests", {
            "id": group["id"], "title": "Review the protocol", "description": "Check the methods",
            "owner_id": person_id, "due_date": "2026-11-15",
        })
        assert status == 200
        task = state["groups"][0]["requests"][0]
        assert task["status"] == "open"
        status, state = request(server, "POST", "/api/groups/requests/update", {
            "id": group["id"], "request_id": task["id"], "status": "resolved",
        })
        assert status == 200 and state["groups"][0]["requests"][0]["status"] == "resolved"
        status, pack = request(server, path=f'/api/groups/{group["id"]}/export?scope=project&members={person_id}&from=2026-01-01&to=2026-12-31')
        assert status == 200
        with zipfile.ZipFile(io.BytesIO(pack)) as archive:
            references = archive.read("bibliography.ris").decode()
            assert work["title"] in references and references.count("TY  -") == 1
            assert "Coordinator" in archive.read("roster.csv").decode()
            assert f"biosketches/{person_id}.json" in archive.namelist()
            assert len([n for n in archive.namelist() if n.startswith("biosketches/") and n.endswith(".json")]) == 1


def test_appending_members_preserves_other_group_fields(tmp_path):
    with running_server(tmp_path) as server:
        state, _ = seeded(server)
        status, state = request(server, "POST", "/api/groups", {
            "name": "Actual project", "description": "Keep this purpose", "member_ids": ["demo-ada"],
        })
        group = next(g for g in state["groups"] if g["name"] == "Actual project")
        for ids in (["demo-sam"], ["demo-lin", "demo-sam"]):
            status, state = request(server, "POST", "/api/groups/members/add", {"id": group["id"], "member_ids": ids})
            assert status == 200
        result = next(g for g in state["groups"] if g["id"] == group["id"])
        assert result["member_ids"] == ["demo-ada", "demo-sam", "demo-lin"]
        assert result["description"] == "Keep this purpose"


@pytest.mark.parametrize("endpoint, fields", [
    ("members/add", {"member_ids": ["missing"]}),
    ("members/add", {"member_ids": "demo-ada"}),
    ("member", {"person_id": "missing", "role": "Coordinator"}),
    ("member", {"person_id": "demo-ada", "role": {"unexpected": True}}),
    ("output", {"work_id": "missing", "selected": True}),
    ("output", {"work_id": "demo-work:shared", "selected": "false"}),
    ("requests", {"title": "Review", "owner_id": "missing"}),
    ("requests", {"title": "Review", "due_date": "2026-02-30"}),
    ("requests/update", {"request_id": "missing", "status": "resolved"}),
])
def test_invalid_group_writes_do_not_change_workspace(tmp_path, endpoint, fields):
    with running_server(tmp_path) as server:
        initial, group = seeded(server)
        status, payload = request(server, "POST", f"/api/groups/{endpoint}", {"id": group["id"], **fields})
        assert status == 400 and payload["error"]
        assert request(server)[1] == initial


@pytest.mark.parametrize("query", [
    "scope=unknown", "from=bad", "from=2026-02-01&to=2026-01-01", "members=missing",
    "members=", "scope=members&scope=project", "unexpected=true",
])
def test_invalid_export_options_are_rejected(tmp_path, query):
    with running_server(tmp_path) as server:
        _, group = seeded(server)
        status, payload = request(server, path=f'/api/groups/{group["id"]}/export?{query}')
        assert status == 400 and payload["error"]
