import base64
import io
import json
import urllib.request
import zipfile
from pathlib import Path

import pytest

from orcid_biosketch import playground
from orcid_biosketch.core import OrcidError, fetch_orcid_record

RECORD = json.loads((Path(__file__).parent / "fixture.json").read_text(encoding="utf-8"))
ORCID = RECORD["orcid-identifier"]["path"]


@pytest.fixture
def browser(monkeypatch):
    """Install a fake browser transport; urllib is restored after the test."""
    monkeypatch.setattr(urllib.request, "urlopen", urllib.request.urlopen)
    calls = []

    def install(responses):
        def get(url, headers):
            calls.append((url, json.loads(headers)))
            for suffix, reply in responses.items():
                if url.endswith(suffix):
                    return json.dumps(reply)
            return json.dumps([404, "", None])
        playground.install_transport(get)
        return calls
    return install


def test_transport_serves_records_and_keeps_http_errors(browser):
    calls = browser({"/record": [200, json.dumps(RECORD), None]})
    assert fetch_orcid_record(ORCID, retries=0)["orcid-identifier"]["path"] == ORCID
    assert calls[0][0].endswith(f"/{ORCID}/record") and calls[0][1]["Accept"] == "application/json"
    browser({})
    with pytest.raises(OrcidError, match="no public record"):
        fetch_orcid_record(ORCID, retries=0)
    browser({"/record": [403, "", None]})
    with pytest.raises(OrcidError, match="HTTP 403"):
        fetch_orcid_record(ORCID, retries=0)


def test_unreachable_browser_request_is_an_orcid_error(browser):
    browser({"/record": [0, "", None]})
    with pytest.raises(OrcidError, match="Could not reach"):
        fetch_orcid_record(ORCID, retries=0)


def test_profile_renders_every_output_from_the_record(browser):
    browser({"/record": [200, json.dumps(RECORD), None]})
    result = json.loads(playground.profile(f"https://orcid.org/{ORCID}"))
    assert result["biosketch"]["person"]["orcid"] == ORCID
    assert result["card_svg"].startswith("<svg") and result["heatmap_svg"].startswith("<svg")
    assert set(result["templates"]) == {"erc", "horizon", "nih"}
    assert result["lint"]["grade"] and "@" in result["bibtex"] and "TY  -" in result["ris"]


def test_profile_rejects_invalid_ids_before_any_request(browser):
    calls = browser({})
    with pytest.raises(OrcidError, match="checksum"):
        playground.profile("0000-0002-1825-0098")
    assert calls == []


def test_stored_biosketch_renders_without_network(browser):
    calls = browser({})
    bio = (Path(__file__).parents[1] / "generated" / "biosketch.json").read_text(encoding="utf-8")
    assert json.loads(playground.profile_from_biosketch(bio))["fortune"]
    assert playground.fortune(bio, 3) == playground.fortune(bio, 3)
    assert calls == []


def test_workspace_serves_pilot_api_and_team_pack(tmp_path):
    workspace = playground.Workspace(str(tmp_path / "network.sqlite3"))
    reply = json.loads(workspace.request("POST", "/api/demo", "{}"))
    state = json.loads(reply["body"])
    assert reply["status"] == 200 and state["groups"]
    group = state["groups"][0]["id"]
    pack = json.loads(workspace.request("GET", f"/api/groups/{group}/export?scope=members"))
    assert pack["content_type"] == "application/zip" and pack["filename"] == "team-pack.zip"
    assert zipfile.ZipFile(io.BytesIO(base64.b64decode(pack["body_b64"]))).namelist()
    # State survives a new engine on the same file, as after a page reload.
    again = json.loads(playground.Workspace(str(tmp_path / "network.sqlite3")).request("GET", "/api/state"))
    assert json.loads(again["body"])["groups"][0]["id"] == group


@pytest.mark.parametrize("method, target, body, status", [
    ("POST", "/api/demo", "not json", 400),
    ("POST", "/api/follow", '{"id": 1}', 400),
    ("POST", "/api/unknown", "{}", 404),
    ("GET", "/api/groups/x/export?scope=all&scope=members", None, 400),
])
def test_workspace_rejects_invalid_requests(tmp_path, method, target, body, status):
    reply = json.loads(playground.Workspace(str(tmp_path / "w.sqlite3")).request(method, target, body))
    assert reply["status"] == status and json.loads(reply["body"])["error"]
