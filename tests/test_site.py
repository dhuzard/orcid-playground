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
    assert 'id="export-workspace"' in page and 'id="import-workspace-file"' in page


def test_team_package_crypto_is_published_and_cached_offline(tmp_path):
    files = build_site.build(tmp_path / "site", client_id="")
    assert "teampack.js" in files
    assert "'/teampack.js'" in (tmp_path / "site" / "sw.js").read_text(encoding="utf-8")
    assert "from '/teampack.js'" in (tmp_path / "site" / "group.js").read_text(encoding="utf-8")
    ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    assert "web/playground/teampack.test.mjs" in ci


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


def test_runtime_is_copied_only_when_every_hash_matches(tmp_path, monkeypatch):
    import hashlib
    monkeypatch.setattr(build_site, "PYODIDE_FILES", {"pyodide.js": hashlib.sha256(b"ok").hexdigest()})
    files = build_site.fetch_runtime(tmp_path / "site", cache=tmp_path / "cache", download=lambda url: b"ok")
    assert files == [f"pyodide/{build_site.PYODIDE_VERSION}/pyodide.js"]
    assert (tmp_path / "site" / files[0]).read_bytes() == b"ok"
    # A tampered download is refused and never cached.
    with pytest.raises(ValueError, match="pinned SHA-256"):
        build_site.fetch_runtime(tmp_path / "other", cache=tmp_path / "fresh", download=lambda url: b"tampered")
    assert not (tmp_path / "fresh" / "pyodide.js").exists()


def test_engine_loads_the_pinned_runtime_from_this_site():
    engine = (ROOT / "web" / "playground" / "engine.js").read_text(encoding="utf-8")
    assert f"const PYODIDE = '/pyodide/{build_site.PYODIDE_VERSION}/';" in engine
    csp = json.loads((ROOT / "firebase.json").read_text(encoding="utf-8"))["hosting"]["headers"][0]["headers"][2]["value"]
    assert "jsdelivr" not in csp and "unsafe-eval'" not in csp.replace("wasm-unsafe-eval'", "")


def test_group_view_and_hosted_share_button_are_built(tmp_path):
    files = build_site.build(tmp_path / "site", client_id="")
    assert {"group/index.html", "group.js", "group-link.js"} <= set(files)
    assert '<html lang="en" data-hosted="true">' in (tmp_path / "site" / "network" / "index.html").read_text(encoding="utf-8")


def test_service_worker_is_stamped_with_the_site_digest_and_manifest_is_valid(tmp_path):
    root = tmp_path / "repo"
    for folder in ("generated", "web", "src"):
        shutil.copytree(ROOT / folder, root / folder, ignore=shutil.ignore_patterns("__pycache__", "node_modules"))
    worker = lambda name: (tmp_path / name / "sw.js").read_text(encoding="utf-8")
    build_site.build(tmp_path / "a", root, client_id="")
    build_site.build(tmp_path / "b", root, client_id="APP-X")
    assert "__BUILD__" not in worker("a")
    # Deterministic, and config.json (never cached by the worker) does not change the version.
    assert worker("a") == worker("b")
    (root / "web" / "playground" / "studio.js").write_text("// changed", encoding="utf-8")
    build_site.build(tmp_path / "c", root, client_id="")
    assert worker("c") != worker("a")
    manifest = json.loads((tmp_path / "a" / "manifest.webmanifest").read_text(encoding="utf-8"))
    assert all((tmp_path / "a" / icon["src"].lstrip("/")).is_file() for icon in manifest["icons"])
    for page in ("index.html", "group/index.html", "network/index.html"):
        assert 'rel="manifest"' in (tmp_path / "a" / page).read_text(encoding="utf-8"), page
