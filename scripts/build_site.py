"""Assemble the static public showcase into ``site/`` (see docs/gcp-hosting.md).

Only public, generated outputs and the web component are copied. Nothing else
from the repository, in particular no roster export or network workspace, can
reach the site.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_SUFFIXES = {".json", ".jsonld", ".md", ".svg", ".txt"}


def build(out: Path, root: Path = ROOT) -> list[str]:
    if out.exists():
        shutil.rmtree(out)
    (out / "generated").mkdir(parents=True)
    copied = []
    for source in sorted((root / "generated").iterdir()):
        if source.is_file() and source.suffix in PUBLIC_SUFFIXES:
            shutil.copy2(source, out / "generated" / source.name)
            copied.append(f"generated/{source.name}")
    shutil.copy2(root / "web" / "orcid-biosketch.js", out / "orcid-biosketch.js")
    page = (root / "examples" / "plain-html.html").read_text(encoding="utf-8")
    page = page.replace("../web/orcid-biosketch.js", "orcid-biosketch.js").replace("../generated/", "generated/")
    (out / "index.html").write_text(page, encoding="utf-8")
    return copied + ["orcid-biosketch.js", "index.html"]


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "site"
    for name in build(target):
        print(name)
