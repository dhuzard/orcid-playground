"""Guided first-run journeys and Studio → Contacts → Groups handoffs (issue #56).

Static checks on the built pages, plus the browser journeys in tests/e2e/onboarding.e2e.cjs.
The browser run serves the real built site; tests/e2e/onboarding_server.py answers the
engine's operations with CPython running this package (instead of Pyodide) and answers
ORCID reads from stored fixtures, so nothing leaves the machine.
"""

import importlib.util
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("build_site", ROOT / "scripts" / "build_site.py")
build_site = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build_site)


@pytest.fixture(scope="module")
def site(tmp_path_factory):
    out = tmp_path_factory.mktemp("onboarding") / "site"
    build_site.build(out, client_id="")
    return out


def _text(html: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html))


def test_studio_offers_three_distinct_confirmed_handoffs(site):
    html = (site / "index.html").read_text(encoding="utf-8")
    studio = (site / "studio.js").read_text(encoding="utf-8")
    for anchor in ('id="to-contact"', 'id="to-group"', 'id="to-network"'):
        assert anchor in html
    assert ">Save as contact<" in html and ">Add to group<" in html and ">Follow<" in html
    assert "asks before anything is read or saved" in _text(html)
    assert "/network/#contacts?save=${id}" in studio and "/network/#groups?add=${id}" in studio
    assert "/network/?import=${id}" in studio
    # Never implies confirmed membership: cloud Teams are explained as unavailable.
    assert "cloud Teams, which are not available on this site yet" in _text(html)


def test_explore_guide_and_next_steps_sit_outside_the_hero(site):
    html = (site / "index.html").read_text(encoding="utf-8")
    hero_end = html.index('<section id="me"')
    assert html.index('id="explore-guide"') > hero_end
    assert "Explore &amp; Play, step by step" in html and "What can I do next?" in html
    assert html.count("data-goto=") >= 4


def test_network_page_has_the_guide_container_and_toggle(site):
    page = (site / "network" / "index.html").read_text(encoding="utf-8")
    assert '<div id="guide"></div>' in page
    assert 'id="guide-toggle"' in page and 'aria-controls="guide"' in page
    assert 'id="export-workspace"' in page  # the backup route the guide points to


def test_bridge_asks_before_sample_and_follow_and_never_mixes_silently(site):
    bridge = (site / "network-bridge.js").read_text(encoding="utf-8")
    assert "Nothing of yours is replaced" in bridge and "Remove sample data" in bridge
    assert "does not save them as a contact" in bridge
    app = (ROOT / "web" / "network" / "app.js").read_text(encoding="utf-8")
    assert "follow: false" in app  # Save as contact / Add to group never follow by themselves
    assert "'/api/demo/remove'" in app


def _node():
    node = shutil.which("node")
    if not node:
        return None
    probe = subprocess.run([node, "-e", "require('playwright')"], capture_output=True, cwd=ROOT)
    return node if probe.returncode == 0 else None


def test_guided_journeys_in_a_browser(site, tmp_path):
    """Both journeys end to end at desktop, 375px and 320px; empty, invalid, cancelled, interrupted,
    duplicate, sample-data, return-navigation, refresh and privacy cases."""
    required = os.environ.get("SRP_REQUIRE_BROWSER") == "1"  # CI: a missing browser is a failure
    node = _node()
    if not node:
        assert not required, "Node.js with Playwright is required (SRP_REQUIRE_BROWSER=1)"
        pytest.skip("Node.js with Playwright is not available")
    server = subprocess.Popen([sys.executable, str(ROOT / "tests" / "e2e" / "onboarding_server.py"), str(site), str(tmp_path)],
                              stdout=subprocess.PIPE, text=True, cwd=ROOT)
    try:
        port = int(server.stdout.readline())
        result = subprocess.run([node, str(ROOT / "tests" / "e2e" / "onboarding.e2e.cjs"), f"http://127.0.0.1:{port}"],
                                capture_output=True, text=True, timeout=600, cwd=ROOT)
    finally:
        server.terminate()
        server.wait(timeout=10)
    if result.returncode == 77:
        assert not required, f"No usable Chromium: {result.stderr.strip()[:200]}"
        pytest.skip(f"No usable Chromium: {result.stderr.strip()[:200]}")
    assert result.returncode == 0, result.stdout + result.stderr


def _function(source: str, name: str) -> str:
    match = re.search(r"(?:export )?function " + name + r"\(.*?\n}\n", source, re.S)
    assert match, name
    return match.group(0).removeprefix("export ")


def test_bridge_sample_question_is_an_exact_copy_of_the_apps():
    # The bridge runs before app.js and cannot import it, so it carries copies; they must not drift.
    app = (ROOT / "web" / "network" / "app.js").read_text(encoding="utf-8")
    bridge = (ROOT / "web" / "playground" / "network-bridge.js").read_text(encoding="utf-8")
    for name in ("workspaceSummary", "sampleMessage"):
        assert _function(bridge, name) == _function(app, name), name
    for line in ("const isSampleGroup = group => /^demo-/.test(group.id);",
                 "const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;"):
        assert line in app and line in bridge, line
