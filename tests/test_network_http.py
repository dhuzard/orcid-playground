"""Exercise the pilot's real HTTP boundary without reaching ORCID."""
import http.client
import json
import threading
from contextlib import contextmanager

import pytest

from orcid_biosketch.core import OrcidError
from orcid_biosketch.network import PilotServer, import_public_record
from orcid_biosketch.network_store import NetworkStore


@contextmanager
def running_server(tmp_path, importer=None):
    server = PilotServer(("127.0.0.1", 0), NetworkStore(tmp_path / "state.sqlite3"), importer=importer)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def request(server, method="GET", path="/api/state", body=None, headers=None):
    conn = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
    defaults = {}
    if body is not None:
        body = json.dumps(body)
        defaults = {"Content-Type": "application/json", "X-Pilot-Request": "1"}
    defaults.update(headers or {})
    conn.request(method, path, body, defaults)
    response = conn.getresponse()
    status, mime, payload = response.status, response.getheader("Content-Type"), response.read()
    conn.close()
    return status, json.loads(payload) if mime.startswith("application/json") else payload


def test_http_demo_follow_save_group_export_and_reload(tmp_path):
    with running_server(tmp_path) as server:
        status, initial = request(server)
        assert status == 200 and initial["people"] == []
        status, state = request(server, "POST", "/api/demo", {})
        assert status == 200 and state["people"] and state["works"]
        person = state["people"][0]
        work = state["works"][0]
        assert request(server, "POST", "/api/follow", {"id": person["id"], "following": False})[0] == 200
        assert request(server, "POST", "/api/save", {"id": work["id"], "saved": True})[0] == 200
        status, state = request(server, "POST", "/api/groups", {
            "name": "Pilot test", "description": "Our locally curated roster", "member_ids": [person["id"]],
        })
        assert status == 200
        group = next(g for g in state["groups"] if g["name"] == "Pilot test")
        status, archive = request(server, path=f'/api/groups/{group["id"]}/export')
        assert status == 200 and archive.startswith(b"PK")
    persisted = NetworkStore(tmp_path / "state.sqlite3").state()
    assert next(p for p in persisted["people"] if p["id"] == person["id"])["following"] is False
    assert next(w for w in persisted["works"] if w["id"] == work["id"])["saved"] is True


@pytest.mark.parametrize("headers", [
    {"Host": "evil.example"}, {"Origin": "https://evil.example"},
    {"Sec-Fetch-Site": "cross-site"},
])
def test_rejects_cross_site_reads_and_writes(tmp_path, headers):
    with running_server(tmp_path) as server:
        assert request(server, headers=headers)[0] == 403
        assert request(server, "POST", "/api/demo", {}, headers)[0] == 403
        assert request(server)[1]["people"] == []


def test_rejects_invalid_mutations_and_static_traversal(tmp_path):
    with running_server(tmp_path) as server:
        assert request(server, "POST", "/api/demo", {}, {"X-Pilot-Request": ""})[0] == 403
        for path, payload in [("/api/demo", []), ("/api/follow", {"id": "x", "following": "false"}),
                              ("/api/import", {"orcid": []}), ("/api/groups", {"name": "x", "member_ids": ["absent"]})]:
            assert request(server, "POST", path, payload)[0] == 400
        assert request(server, path="/../pyproject.toml")[0] == 404
        assert request(server, path="/.local/network.sqlite3")[0] == 404


def test_import_failure_leaves_workspace_intact(tmp_path):
    def unavailable(_):
        raise OrcidError("ORCID is temporarily unavailable")
    with running_server(tmp_path, unavailable) as server:
        before = request(server, "POST", "/api/demo", {})[1]
        status, error = request(server, "POST", "/api/import", {"orcid": "0000-0002-1825-0097"})
        assert status == 502 and "unavailable" in error["error"]
        assert request(server)[1] == before


def test_import_is_baseline_and_checks_requested_identity(monkeypatch, tmp_path):
    from orcid_biosketch import network
    record = {"orcid-identifier": {"path": "0000-0002-1825-0097"}, "person": {}}
    monkeypatch.setattr(network, "fetch_orcid_record", lambda *args, **kwargs: record)
    with running_server(tmp_path) as server:
        status, state = request(server, "POST", "/api/import", {"orcid": "https://orcid.org/0000-0002-1825-0097"})
        assert status == 200 and len(state["people"]) == 1 and state["events"] == []
    with pytest.raises(ValueError):
        import_public_record("https://evil.example/0000-0002-1825-0097")
    record["orcid-identifier"]["path"] = "0000-0001-5109-3700"
    with pytest.raises(OrcidError, match="did not match"):
        import_public_record("0000-0002-1825-0097")


def test_server_refuses_public_bind(tmp_path):
    with pytest.raises(ValueError, match="127.0.0.1"):
        PilotServer(("0.0.0.0", 0), NetworkStore(tmp_path / "state.sqlite3"))


def test_server_refuses_port_already_in_use(tmp_path):
    with running_server(tmp_path) as server:
        with pytest.raises(OSError):
            PilotServer(server.server_address, NetworkStore(tmp_path / "second.sqlite3"))
