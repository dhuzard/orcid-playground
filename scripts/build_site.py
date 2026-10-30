"""Assemble the hosted playground into ``site/`` (see docs/gcp-hosting.md).

The site is static: the Studio and the research network run the package in the
visitor's browser. Only public generated outputs, the web pages and the
package's own source reach the site; in particular no workspace, roster export
or token can, and nothing is stored server side.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_SUFFIXES = {".json", ".jsonld", ".md", ".svg", ".txt"}
PLAYGROUND = ("index.html", "playground.css", "studio.js", "auth.js", "engine.js", "engine-client.js", "network-bridge.js")
# Fixed timestamp so the same source always produces the same archive.
ZIP_DATE = (2026, 1, 1, 0, 0, 0)

# The pilot page as served by the hosted site: same app, browser-held workspace.
NETWORK_PAGE = [
    ('href="/style.css"', 'href="/network/style.css"'),
    ('<script type="module" src="/app.js"></script>',
     '<script type="module" src="/network-bridge.js"></script>\n  <script type="module" src="/network/app.js"></script>'),
    ("LOCAL PILOT", "IN THIS BROWSER"),
    ("One local workspace.<br>No accounts or public profiles.",
     'Stored only in this browser.<br>No accounts or public profiles.<br>'
     '<button id="reset-workspace" class="button quiet small" type="button">Clear this workspace</button>'
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
    for folder in ("generated", "network", "py"):
        (out / folder).mkdir(parents=True)
    copied = []
    for source in sorted((root / "generated").iterdir()):
        if source.is_file() and source.suffix in PUBLIC_SUFFIXES:
            shutil.copy2(source, out / "generated" / source.name)
            copied.append(f"generated/{source.name}")
    for name in PLAYGROUND:
        shutil.copy2(root / "web" / "playground" / name, out / name)
    shutil.copy2(root / "web" / "orcid-biosketch.js", out / "orcid-biosketch.js")
    for name in ("app.js", "style.css"):
        shutil.copy2(root / "web" / "network" / name, out / "network" / name)
    (out / "network" / "index.html").write_text(network_page(root), encoding="utf-8")
    package_archive(out / "py" / "orcid_biosketch.zip", root)
    # The ORCID client id of a public OAuth client is not a secret; empty hides sign-in.
    client_id = os.environ.get("ORCID_CLIENT_ID", "") if client_id is None else client_id
    (out / "config.json").write_text(json.dumps({"orcid_client_id": client_id.strip()}) + "\n", encoding="utf-8")
    return copied + [*PLAYGROUND, "orcid-biosketch.js", "network/app.js", "network/style.css",
                     "network/index.html", "py/orcid_biosketch.zip", "config.json"]


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "site"
    for name in build(target):
        print(name)
