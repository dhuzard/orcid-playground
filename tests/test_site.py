import importlib.util
import json
import shutil
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("build_site", ROOT / "scripts" / "build_site.py")
build_site = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build_site)


def test_site_contains_only_public_outputs(tmp_path):
    files = build_site.build(tmp_path / "site", client_id="")
    assert {"generated/biosketch.json", "index.html", "network/index.html", "py/orcid_biosketch.zip"} <= set(files)
    allowed = {p.name for p in (ROOT / "generated").iterdir()}
    assert {p.name for p in (tmp_path / "site" / "generated").iterdir()} <= allowed
    assert sorted(str(p.relative_to(tmp_path / "site").as_posix()) for p in (tmp_path / "site").rglob("*") if p.is_file()) == sorted(files)


def test_network_page_runs_the_pilot_on_the_browser_engine(tmp_path):
    build_site.build(tmp_path / "site", client_id="")
    page = (tmp_path / "site" / "network" / "index.html").read_text(encoding="utf-8")
    assert page.index('src="/network-bridge.js"') < page.index('src="/network/app.js"')
    assert "LOCAL PILOT" not in page and 'id="reset-workspace"' in page


def test_package_archive_is_reproducible_source_only(tmp_path):
    first, second = tmp_path / "a.zip", tmp_path / "b.zip"
    build_site.package_archive(first)
    build_site.package_archive(second)
    assert first.read_bytes() == second.read_bytes()
    names = zipfile.ZipFile(first).namelist()
    assert "orcid_biosketch/playground.py" in names and "orcid_biosketch/templates/nih.md" in names
    assert all(name.endswith((".py", ".md")) and "__pycache__" not in name for name in names)


def test_config_carries_only_the_public_client_id(tmp_path, monkeypatch):
    monkeypatch.setenv("ORCID_CLIENT_ID", " APP-TEST ")
    build_site.build(tmp_path / "site")
    assert json.loads((tmp_path / "site" / "config.json").read_text(encoding="utf-8")) == {"orcid_client_id": "APP-TEST"}


def test_site_ignores_unlisted_file_types(tmp_path):
    root = tmp_path / "repo"
    for folder in ("generated", "web", "src"):
        shutil.copytree(ROOT / folder, root / folder, ignore=shutil.ignore_patterns("__pycache__", "node_modules"))
    (root / "generated" / "roster.db").write_text("secret", encoding="utf-8")
    build_site.build(tmp_path / "out", root, client_id="")
    assert not (tmp_path / "out" / "generated" / "roster.db").exists()


def test_changed_pilot_page_fails_the_build_loudly(tmp_path):
    root = tmp_path / "repo"
    (root / "web" / "network").mkdir(parents=True)
    (root / "web" / "network" / "index.html").write_text("<html></html>", encoding="utf-8")
    with pytest.raises(ValueError, match="NETWORK_PAGE"):
        build_site.network_page(root)
