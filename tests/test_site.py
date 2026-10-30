import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("build_site", ROOT / "scripts" / "build_site.py")
build_site = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build_site)


def test_site_contains_only_public_outputs(tmp_path):
    files = build_site.build(tmp_path / "site")
    assert "generated/biosketch.json" in files and "index.html" in files
    page = (tmp_path / "site" / "index.html").read_text(encoding="utf-8")
    assert "../" not in page and 'src="generated/biosketch.json"' in page
    allowed = {p.name for p in (ROOT / "generated").iterdir()}
    assert {p.name for p in (tmp_path / "site" / "generated").iterdir()} <= allowed


def test_site_ignores_unlisted_file_types(tmp_path):
    root = tmp_path / "repo"
    (root / "generated").mkdir(parents=True)
    (root / "web").mkdir()
    (root / "examples").mkdir()
    (root / "web" / "orcid-biosketch.js").write_text("//", encoding="utf-8")
    (root / "examples" / "plain-html.html").write_text("x", encoding="utf-8")
    (root / "generated" / "biosketch.json").write_text("{}", encoding="utf-8")
    (root / "generated" / "roster.db").write_text("secret", encoding="utf-8")
    build_site.build(tmp_path / "out", root)
    assert not (tmp_path / "out" / "generated" / "roster.db").exists()
