"""README and user-doc links point to real places (#57).

Every link to the hosted site must resolve to a route in the built site, links into
the repository must point at files that exist, the README headline must match the
homepage, and no video link may appear before a video is published.
"""
import importlib.util
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://science-record-player.web.app"
REPO = "https://github.com/dhuzard/science-record-player"
README = (ROOT / "README.md").read_text(encoding="utf-8")
USER_DOCS = sorted((ROOT / "docs" / "source").glob("*.md"))
LINK = re.compile(r"\]\(([^)\s]+)\)|href=\"([^\"]+)\"")

spec = importlib.util.spec_from_file_location("build_site", ROOT / "scripts" / "build_site.py")
build_site = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build_site)


def links(text: str) -> list[str]:
    return [a or b for a, b in LINK.findall(text)]


def slug(heading: str) -> str:
    """GitHub's heading anchor: lowercase, drop punctuation, spaces to hyphens."""
    return re.sub(r"[^\w\- ]", "", heading.strip().lower()).replace(" ", "-")


@pytest.fixture(scope="module")
def site(tmp_path_factory):
    out = tmp_path_factory.mktemp("readme") / "site"
    build_site.build(out, client_id="")
    return out


def route_exists(site: Path, url: str) -> bool:
    path = url[len(SITE):].split("#")[0].split("?")[0] or "/"
    if path == "/docs/":
        return True  # Sphinx output, bundled by deploy-hosting.yml (checked in test_navigation)
    target = site / path.lstrip("/")
    return target.is_file() or (target / "index.html").is_file()


@pytest.mark.parametrize("doc", [ROOT / "README.md", *USER_DOCS], ids=lambda p: p.name)
def test_hosted_site_links_resolve_to_built_routes(site, doc):
    urls = [u for u in links(doc.read_text(encoding="utf-8")) if u.startswith(SITE)]
    missing = [u for u in urls if not route_exists(site, u)]
    assert not missing, f"{doc.name} links to routes missing from the built site: {missing}"


def test_readme_offers_both_pathways_with_working_ctas(site):
    first_screen = README[:README.index("## Quick Start")]
    for cta in (f"{SITE}/", f"{SITE}/network/#contacts", f"{SITE}/network/?sample=1#groups",
                f"{SITE}/docs/", f"{SITE}/group/", f"{SITE}/feedback/", REPO):
        assert f"({cta})" in first_screen, cta
    assert "Explore & Play" in first_screen and "Connect & Organize" in first_screen
    assert "**Publish or Play.**" in first_screen


def test_readme_headline_matches_the_homepage():
    home = (ROOT / "web" / "playground" / "index.html").read_text(encoding="utf-8")
    headline = re.search(r'<h1 id="hero-title">([^<]+)</h1>', home).group(1)
    assert f"## {headline}" in README


def test_readme_carries_the_exact_orcid_disclaimer():
    brand = build_site.load_brand()
    head = README[:README.index("## Quick Start")]
    assert brand["disclaimer"] in head and brand["trademark"] in head


def test_only_canonical_hosts_and_repository():
    for doc in [ROOT / "README.md", *USER_DOCS]:
        text = doc.read_text(encoding="utf-8")
        assert "orcid-playground-889" not in text, doc.name
        for url in links(text):
            if "github.com/dhuzard/" in url:
                assert url.startswith(REPO), (doc.name, url)
            assert not re.match(r"https://[\w-]+\.web\.app", url) or url.startswith(SITE), (doc.name, url)


def test_readme_relative_links_and_anchors_exist():
    anchors = {slug(h) for h in re.findall(r"^#+ (.+)$", README, re.MULTILINE)}
    for url in links(README):
        if url.startswith("#"):
            assert url[1:] in anchors, url
        elif not re.match(r"[a-z]+:", url):
            assert (ROOT / url.split("#")[0]).exists(), url


def test_no_video_link_before_a_video_is_published():
    for doc in [ROOT / "README.md", *USER_DOCS]:
        for url in links(doc.read_text(encoding="utf-8")):
            assert not re.search(r"youtube\.com|youtu\.be|vimeo\.com|\.mp4$", url), (doc.name, url)
