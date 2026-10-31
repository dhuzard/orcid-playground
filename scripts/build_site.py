"""Assemble the hosted playground into ``site/`` (see docs/gcp-hosting.md).

The site is static: the Studio and the research network run the package in the
visitor's browser. Only public generated outputs, the web pages and the
package's own source reach the site; in particular no workspace, roster export
or token can, and nothing is stored server side.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_SUFFIXES = {".json", ".jsonld", ".md", ".svg", ".txt"}
PLAYGROUND = ("index.html", "playground.css", "studio.js", "auth.js", "engine.js", "engine-client.js", "network-bridge.js",
              "group.js", "group-link.js", "cloud.js", "team.js", "digest.js", "teampack.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png")
# Fixed timestamp so the same source always produces the same archive.
ZIP_DATE = (2026, 1, 1, 0, 0, 0)

# The Python runtime is served from this site, never a CDN at run time. Each file
# is checked against a pinned SHA-256 when the site is built; Pyodide checks the
# packages it loads against pyodide-lock.json, which is pinned here too.
PYODIDE_VERSION = "0.26.4"
PYODIDE_SOURCE = f"https://cdn.jsdelivr.net/pyodide/v{PYODIDE_VERSION}/full/"
PYODIDE_FILES = {
    "pyodide.js": "c0069107621d5b942a659e737a12e774cc0451feaa2256f475d72e071d844ec7",
    "pyodide.asm.js": "919560652ed3dad3707cb3a394785da1e046fb13dc0defa162058ff230cb7eed",
    "pyodide.asm.wasm": "b7e66a19427a55010ac3367c1b6c64b893f9826f783412945fdf0c3337f3bc94",
    "python_stdlib.zip": "72894522b791858b9d613ac786b951d8b5094035dcf376313ea24a466810f336",
    "pyodide-lock.json": "cd50b49de944c579045e122fe8628b31f9ce446379f032f36c05e273d38766e0",
    "sqlite3-1.0.0.zip": "e05c4defc15eac256607c87c3533af267fc072f3a1749a4f6b8bfe074e1be7f6",
}
RUNTIME_CACHE = ROOT / ".cache" / f"pyodide-{PYODIDE_VERSION}"


def _download(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as response:
        return response.read()


def fetch_runtime(out: Path, *, cache: Path = RUNTIME_CACHE, download: Callable[[str], bytes] = _download) -> list[str]:
    """Copy the pinned Pyodide runtime into ``out``, refusing any file whose hash differs."""
    target = out / "pyodide" / PYODIDE_VERSION
    target.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    for name, expected in PYODIDE_FILES.items():
        cached = cache / name
        data = cached.read_bytes() if cached.is_file() else download(PYODIDE_SOURCE + name)
        if hashlib.sha256(data).hexdigest() != expected:
            cached.unlink(missing_ok=True)
            raise ValueError(f"Pyodide file {name} does not match its pinned SHA-256; refusing to publish it")
        cached.write_bytes(data)
        (target / name).write_bytes(data)
    return [f"pyodide/{PYODIDE_VERSION}/{name}" for name in PYODIDE_FILES]


# The pilot page as served by the hosted site: same app, browser-held workspace.
NETWORK_PAGE = [
    ('<html lang="en">', '<html lang="en" data-hosted="true">'),
    ('<link rel="icon" href="data:,">',
     '<link rel="icon" href="/icon.svg" type="image/svg+xml">\n  <link rel="manifest" href="/manifest.webmanifest">'),
    ('href="/style.css"', 'href="/network/style.css"'),
    ('<script type="module" src="/app.js"></script>',
     '<script type="module" src="/network-bridge.js"></script>\n  <script type="module" src="/network/app.js"></script>'),
    ("LOCAL PILOT", "IN THIS BROWSER"),
    ("One local workspace.<br>No accounts or public profiles.",
     'Stored only in this browser.<br>No accounts or public profiles.<br>'
     '<button id="refresh-followed" class="button quiet small" type="button">Refresh followed records</button><br>'
     '<button id="digest" class="button quiet small" type="button">What’s new since your last visit</button><br>'
     '<button id="export-workspace" class="button quiet small" type="button">Download my workspace</button><br>'
     '<button id="import-workspace" class="button quiet small" type="button">Restore from file</button>'
     '<input id="import-workspace-file" type="file" accept=".json,application/json" hidden><br>'
     '<button id="reset-workspace" class="button quiet small" type="button">Clear this workspace</button>'
     '<br><a href="/group/?packages=1">Encrypted team packages →</a>'
     '<br><a href="/">← Back to the Studio</a>'),
    ("01 / LOCAL", "01 / BROWSER"),
]


def package_archive(destination: Path, root: Path = ROOT) -> None:
    package = root / "src" / "orcid_biosketch"
    files = sorted(p for p in package.rglob("*") if p.is_file() and p.suffix in {".py", ".md"} and "__pycache__" not in p.parts)
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            info = zipfile.ZipInfo(f"orcid_biosketch/{path.relative_to(package).as_posix()}", ZIP_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, path.read_bytes())


def network_page(root: Path = ROOT) -> str:
    page = (root / "web" / "network" / "index.html").read_text(encoding="utf-8")
    for old, new in NETWORK_PAGE:
        if old not in page:
            raise ValueError(f"web/network/index.html changed; update NETWORK_PAGE for {old!r}")
        page = page.replace(old, new)
    return page


def build(out: Path, root: Path = ROOT, *, client_id: str | None = None) -> list[str]:
    if out.exists():
        shutil.rmtree(out)
    for folder in ("generated", "network", "py", "group", "team"):
        (out / folder).mkdir(parents=True)
    copied = []
    for source in sorted((root / "generated").iterdir()):
        if source.is_file() and source.suffix in PUBLIC_SUFFIXES:
            shutil.copy2(source, out / "generated" / source.name)
            copied.append(f"generated/{source.name}")
    for name in PLAYGROUND:
        shutil.copy2(root / "web" / "playground" / name, out / name)
    for widget in ("orcid-biosketch.js", "orcid-group.js"):
        shutil.copy2(root / "web" / widget, out / widget)
    for name in ("app.js", "style.css"):
        shutil.copy2(root / "web" / "network" / name, out / "network" / name)
    (out / "network" / "index.html").write_text(network_page(root), encoding="utf-8")
    shutil.copy2(root / "web" / "playground" / "group.html", out / "group" / "index.html")
    shutil.copy2(root / "web" / "playground" / "team.html", out / "team" / "index.html")
    package_archive(out / "py" / "orcid_biosketch.zip", root)
    # The service worker carries a digest of everything else, so any change to the site
    # installs a fresh cache on the next visit.
    digest = hashlib.sha256()
    for path in sorted(p for p in out.rglob("*") if p.is_file()):
        digest.update(path.relative_to(out).as_posix().encode() + b"\0" + path.read_bytes())
    worker = (root / "web" / "playground" / "sw.js").read_text(encoding="utf-8")
    (out / "sw.js").write_text(worker.replace("__BUILD__", digest.hexdigest()[:16]), encoding="utf-8")
    # The ORCID client id of a public OAuth client is not a secret; empty hides sign-in.
    client_id = os.environ.get("ORCID_CLIENT_ID", "") if client_id is None else client_id
    settings = {"orcid_client_id": client_id.strip()}
    # Team workspaces (docs/team-workspaces.md): public identifiers only; omitted unless all are set.
    cloud = {"apiKey": os.environ.get("FIREBASE_WEB_API_KEY", "").strip(),
             "projectId": os.environ.get("FIREBASE_PROJECT_ID", "").strip(),
             "exchangeUrl": os.environ.get("ORCID_EXCHANGE_URL", "").strip()}
    if all(cloud.values()):
        settings["cloud"] = cloud
    (out / "config.json").write_text(json.dumps(settings) + "\n", encoding="utf-8")
    return copied + [*PLAYGROUND, "orcid-biosketch.js", "orcid-group.js", "network/app.js", "network/style.css",
                     "network/index.html", "group/index.html", "team/index.html", "py/orcid_biosketch.zip", "sw.js", "config.json"]


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "site"
    for name in build(target) + fetch_runtime(target):
        print(name)
