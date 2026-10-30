"""Loopback-only HTTP adapter for the single-workspace research network pilot."""
from __future__ import annotations

import argparse
import json
import logging
import re
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from .core import OrcidError, build_biosketch, fetch_orcid_record, normalize_orcid
from .network_store import NetworkStore

LOG = logging.getLogger(__name__)
MAX_BODY = 65536
ASSETS = {"/": ("index.html", "text/html; charset=utf-8"),
          "/index.html": ("index.html", "text/html; charset=utf-8"),
          "/app.js": ("app.js", "text/javascript; charset=utf-8"),
          "/style.css": ("style.css", "text/css; charset=utf-8")}


def asset_directory() -> Path:
    bundled = Path(__file__).parent / "network_web"
    return bundled if bundled.is_dir() else Path(__file__).resolve().parents[2] / "web" / "network"


class PilotServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False

    def server_bind(self):
        # Windows otherwise permits another listener to share a local port,
        # which can silently send the browser to an unrelated application.
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

    def __init__(self, address, store, *, importer=None, assets=None):
        if address[0] != "127.0.0.1":
            raise ValueError("The pilot must bind to 127.0.0.1; shared hosting requires authentication.")
        self.store = store
        self.importer = importer or import_public_record
        self.assets = Path(assets) if assets else asset_directory()
        super().__init__(address, PilotHandler)


def import_public_record(value: str) -> dict:
    if not isinstance(value, str) or not re.fullmatch(
        r"(?:https://orcid\.org/)?\d{4}-\d{4}-\d{4}-\d{3}[\dXx]/?", value.strip()
    ):
        raise ValueError("Enter an ORCID iD or an https://orcid.org/ link.")
    orcid = normalize_orcid(value.strip())
    # One on-demand public summary request; no background polling or enrichment fan-out.
    record = fetch_orcid_record(orcid, retries=0, timeout=15, include_work_details=False)
    bio = build_biosketch(record)
    if bio["person"]["orcid"] != orcid:
        raise OrcidError("The returned ORCID record did not match the requested iD.")
    return bio



JSON_TYPE = "application/json; charset=utf-8"


def dispatch(store, importer, method: str, target: str, payload: dict | None = None):
    """Route one pilot API request to the workspace.

    Shared by the loopback server and the in-browser playground, which has no
    HTTP server. Returns ``(status, data, content_type, filename)``; unexpected
    errors propagate so each caller can log them in its own way.
    """
    split = urlsplit(target)
    path = split.path
    try:
        if method == "GET":
            if path == "/api/state":
                return 200, store.state(), JSON_TYPE, None
            if match := re.fullmatch(r"/api/groups/([a-zA-Z0-9_-]+)/export", path):
                query = parse_qs(split.query, keep_blank_values=True)
                if set(query) - {"scope", "from", "to", "members"} or any(len(values) != 1 for values in query.values()):
                    raise ValueError("Unsupported or repeated export options.")
                options = {key: values[0] for key, values in query.items()}
                data = store.export_group(
                    match.group(1), scope=options.get("scope", "members"),
                    date_from=options.get("from", ""), date_to=options.get("to", ""),
                    member_ids=options["members"].split(",") if "members" in options else None,
                )
                return 200, data, "application/zip", "team-pack.zip"
            return 404, {"error": "Not found."}, JSON_TYPE, None
        if not isinstance(payload, dict):
            raise ValueError("Expected a JSON object.")
        if path == "/api/demo":
            store.add_demo()
        elif path == "/api/import":
            value = payload.get("orcid")
            if not isinstance(value, str):
                raise ValueError("An ORCID iD is required.")
            store.import_biosketch(importer(value))
        elif path in ("/api/follow", "/api/save"):
            key = "following" if path == "/api/follow" else "saved"
            if not isinstance(payload.get("id"), str) or type(payload.get(key)) is not bool:
                raise ValueError(f"Expected an id and a boolean {key} value.")
            (store.follow if key == "following" else store.save)(payload["id"], payload[key])
        elif path in ("/api/groups", "/api/groups/update"):
            args = (payload.get("name"), payload.get("description", ""), payload.get("member_ids", []))
            if path == "/api/groups":
                store.create_group(*args)
            else:
                if not isinstance(payload.get("id"), str):
                    raise ValueError("A group id is required.")
                store.update_group(payload["id"], *args)
        elif path in ("/api/groups/members/add", "/api/groups/member", "/api/groups/output",
                      "/api/groups/requests", "/api/groups/requests/update"):
            group_id = payload.get("id")
            if not isinstance(group_id, str):
                raise ValueError("A group id is required.")
            if path == "/api/groups/members/add":
                store.add_group_members(group_id, payload.get("member_ids"))
            elif path == "/api/groups/member":
                store.set_group_member(group_id, payload.get("person_id"),
                                       payload.get("role", ""), payload.get("expertise", ""),
                                       payload.get("contribution", ""))
            elif path == "/api/groups/output":
                store.select_group_work(group_id, payload.get("work_id"), payload.get("selected"))
            elif path == "/api/groups/requests":
                store.create_group_request(group_id, payload.get("title"), payload.get("description", ""),
                                           payload.get("owner_id"), payload.get("due_date", ""))
            else:
                store.set_group_request_status(group_id, payload.get("request_id"), payload.get("status"))
        else:
            return 404, {"error": "Not found."}, JSON_TYPE, None
        return 200, store.state(), JSON_TYPE, None
    except OrcidError as error:
        return 502, {"error": str(error)}, JSON_TYPE, None
    except (ValueError, UnicodeDecodeError) as error:
        return 400, {"error": str(error)}, JSON_TYPE, None
    except TimeoutError:
        return 408, {"error": "The request timed out. Please try again."}, JSON_TYPE, None

class PilotHandler(BaseHTTPRequestHandler):
    server: PilotServer

    def log_message(self, fmt, *args):
        LOG.info(fmt, *args)

    def send_payload(self, status, data, content_type="application/json; charset=utf-8", *, filename=None):
        # Drain a bounded rejected POST body before closing. On Windows, closing
        # with unread bytes can reset the socket before the error reaches clients.
        if self.command == "POST" and not getattr(self, "body_consumed", False):
            try:
                remaining = int(self.headers.get("Content-Length", "0"))
                if 0 < remaining <= MAX_BODY and not self.headers.get("Transfer-Encoding"):
                    self.connection.settimeout(1)
                    self.rfile.read(remaining)
            except (ValueError, OSError):
                pass
            self.body_consumed = True
        if not isinstance(data, bytes):
            data = json.dumps(data, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(data)

    def permitted_request(self, *, mutation=False):
        port = self.server.server_address[1]
        hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        host = self.headers.get("Host", "")
        if host not in hosts:
            self.send_payload(403, {"error": "This pilot accepts local requests only."})
            return False
        origin = self.headers.get("Origin")
        if origin and origin != f"http://{host}":
            self.send_payload(403, {"error": "Cross-origin requests are not accepted."})
            return False
        if self.headers.get("Sec-Fetch-Site") == "cross-site":
            self.send_payload(403, {"error": "Cross-site requests are not accepted."})
            return False
        if mutation and self.headers.get("X-Pilot-Request") != "1":
            self.send_payload(403, {"error": "Missing pilot request header."})
            return False
        return True

    def do_GET(self):
        if not self.permitted_request():
            return
        path = urlsplit(self.path).path
        try:
            if path in ASSETS:
                name, mime = ASSETS[path]
                self.send_payload(200, (self.server.assets / name).read_bytes(), mime)
            else:
                status, data, mime, filename = dispatch(self.server.store, self.server.importer, "GET", self.path)
                self.send_payload(status, data, mime, filename=filename)
        except ValueError as error:
            self.send_payload(400, {"error": str(error)})
        except FileNotFoundError:
            self.send_payload(404, {"error": "Pilot asset missing. Run from the repository or reinstall the package."})
        except Exception:
            LOG.exception("Pilot read failed")
            self.send_payload(500, {"error": "Could not read the workspace. See the server log."})

    def do_POST(self):
        if not self.permitted_request(mutation=True):
            return
        try:
            if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
                raise ValueError("Send application/json.")
            if self.headers.get("Transfer-Encoding"):
                raise ValueError("Chunked requests are not supported.")
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY:
                raise ValueError("Request body must be between 1 and 65536 bytes.")
            self.connection.settimeout(10)
            self.body_consumed = True
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise ValueError("Incomplete request body.")
            def invalid_constant(value):
                raise ValueError("Non-finite JSON values are not supported.")
            payload = json.loads(raw, parse_constant=invalid_constant)
            status, data, mime, filename = dispatch(self.server.store, self.server.importer, "POST", self.path, payload)
            self.send_payload(status, data, mime, filename=filename)
        except OrcidError as error:
            self.send_payload(502, {"error": str(error)})
        except (ValueError, UnicodeDecodeError) as error:
            self.send_payload(400, {"error": str(error)})
        except TimeoutError:
            self.send_payload(408, {"error": "The request timed out. Please try again."})
        except Exception:
            LOG.exception("Pilot update failed")
            self.send_payload(500, {"error": "Could not update the workspace. See the server log."})


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8877)
    parser.add_argument("--data", type=Path, default=Path(".local/network.sqlite3"))
    args = parser.parse_args(argv)
    if not 1 <= args.port <= 65535:
        parser.error("port must be between 1 and 65535")
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    try:
        server = PilotServer(("127.0.0.1", args.port), NetworkStore(args.data))
    except (OSError, ValueError) as error:
        parser.exit(1, f"Could not start pilot: {error}\n")
    print(f"Research network pilot: http://127.0.0.1:{args.port}\nLocal single workspace: {args.data.resolve()}\nPress Ctrl+C to stop.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
