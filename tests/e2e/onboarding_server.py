"""Test server for the guided first-run journeys (#56), run by tests/test_onboarding.py.

It serves a built site and answers the in-browser engine's operations (what
web/playground/engine.js runs under Pyodide) with CPython running the same
``science_record_player`` package, so the browser tests need neither the 10 MB
Pyodide download nor ORCID. The pages, the bridge and the network app are the
real ones; tests/e2e/engine-shim.js replaces only /engine-client.js.

Public ORCID reads are answered from stored fixtures and never leave the machine:
the maintainer's stored profile (generated/biosketch.json), two fixture records
labelled as such, one iD that behaves as if ORCID were unreachable and one that
answers slowly. Each browser context gets its own workspace file through the
``srp-ws`` cookie, so a reload keeps the workspace, like IndexedDB does.

Usage: python tests/e2e/onboarding_server.py SITE_DIR WORK_DIR  (prints the port)
"""
from __future__ import annotations

import copy
import select
import socket
import threading
import json
import re
import sys
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from science_record_player import playground
from science_record_player.core import OrcidError, normalize_orcid

ROOT = Path(__file__).resolve().parents[2]
STORED = json.loads((ROOT / "generated" / "biosketch.json").read_text(encoding="utf-8"))
UNREACHABLE = "0000-0002-1111-1115"
SLOW = "0000-0002-2222-2224"


def _fixture(orcid: str, name: str) -> dict:
    bio = copy.deepcopy(STORED)
    bio["person"].update(orcid=orcid, orcid_url=f"https://orcid.org/{orcid}", name=name, credit_name=name)
    bio["works"] = [dict(work, title=f"[Fixture] {work.get('title') or 'Untitled'}") for work in bio["works"][:4]]
    bio["provenance"] = {**bio.get("provenance", {}), "primary_source": "test fixture (not read from ORCID)"}
    return bio


RECORDS = {
    STORED["person"]["orcid"]: STORED,
    "0000-0002-1825-0097": _fixture("0000-0002-1825-0097", "Josiah Carberry (test fixture)"),
    "0000-0001-5109-3700": _fixture("0000-0001-5109-3700", "Second Fixture Researcher"),
    SLOW: _fixture(SLOW, "Slow Fixture Researcher"),
}


def read_public_record(value: str) -> dict:
    """Stands in for network.import_public_record: same validation, fixtures instead of ORCID."""
    if not isinstance(value, str) or not re.fullmatch(r"(?:https://orcid\.org/)?\d{4}-\d{4}-\d{4}-\d{3}[\dXx]/?", value.strip()):
        raise ValueError("Enter an ORCID iD or an https://orcid.org/ link.")
    orcid = normalize_orcid(value.strip())
    if orcid == UNREACHABLE:
        raise OrcidError("Could not reach the ORCID API. Check your connection and try again.")
    if orcid == SLOW:
        # Like the in-page Pyodide engine, a read stops when the page that asked for it goes away.
        for _ in range(30):
            time.sleep(0.1)
            if _client_gone():
                raise OrcidError("The page that asked for this record was closed.")
    if orcid not in RECORDS:
        raise OrcidError(f"No public ORCID record was found for {orcid}.")
    return copy.deepcopy(RECORDS[orcid])


_request = threading.local()


def _client_gone() -> bool:
    connection = getattr(_request, "connection", None)
    if connection is None:
        return False
    try:
        readable, _, _ = select.select([connection], [], [], 0)
        return bool(readable) and connection.recv(1, socket.MSG_PEEK) == b""
    except OSError:
        return True


# Workspace.request routes /api/import through this module-level name.
playground.import_public_record = read_public_record


def profile(value: str) -> str:
    orcid = normalize_orcid(value)  # an invalid iD fails here, as under Pyodide
    return json.dumps(playground.outputs(read_public_record(orcid)), ensure_ascii=False)


class Handler(SimpleHTTPRequestHandler):
    work_dir: Path

    def log_message(self, *args):
        pass

    def workspace(self) -> playground.Workspace:
        match = re.search(r"(?:^|;\s*)srp-ws=([a-z0-9-]{1,64})", self.headers.get("Cookie", ""))
        return playground.Workspace(str(self.work_dir / f"{match.group(1) if match else 'default'}.sqlite3"))

    def do_POST(self):
        if self.path != "/__engine":
            self.send_error(404)
            return
        request = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
        _request.connection = self.connection
        op, args = request.get("op"), request.get("args") or {}
        try:
            result = self.operation(op, args)
            reply = {"ok": True, "result": result}
        except Exception as error:  # the engine reports the exception line only
            reply = {"ok": False, "error": str(error) or type(error).__name__}
        body = json.dumps(reply).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass  # the page was reloaded mid-request (the interrupted-import check)

    def operation(self, op: str, args: dict):
        if op == "profile":
            return profile(args["orcid"])
        if op == "sample":
            return playground.profile_from_biosketch(args["biosketch"])
        if op == "fortune":
            return playground.fortune(args["biosketch"], args["seed"])
        if op == "member":
            return json.dumps(read_public_record(args["orcid"]), ensure_ascii=False)
        if op == "group":
            return playground.group(args["name"], args["bios"])
        if op == "team":
            return playground.team(args["name"], args["bios"], args["template"])
        if op == "extras":
            return playground.group_extras(args["name"], args["bios"])
        if op == "checkWorkspace":
            return playground.check_workspace(args["text"])
        workspace = self.workspace()
        if op == "api":
            return workspace.request(args["method"], args["target"], args.get("body"))
        if op == "exportWorkspace":
            return workspace.export_workspace()
        if op == "importWorkspace":
            return workspace.import_workspace(args["text"])
        if op == "exportGroupPackage":
            return workspace.export_group_package(args["id"])
        if op == "previewGroupPackage":
            return workspace.preview_group_package(args["text"])
        if op == "importGroupPackage":
            return workspace.import_group_package(args["text"])
        if op == "reset":
            workspace.store.path.unlink(missing_ok=True)
            return "ok"
        raise ValueError(f"Unknown operation {op}")


def main(site: str, work_dir: str) -> None:
    Handler.work_dir = Path(work_dir)
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=site))
    print(server.server_address[1], flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
