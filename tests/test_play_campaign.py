"""Explore & Play video composition (#58): storyboard, caption claims, legibility and draft caption files.

The composition in demo/play-campaign.json drives demo/play-campaign.mjs. These checks need no browser or
ffmpeg: they hold the script to the issue's storyboard and to the claim rules of communications/claims-privacy-audit.md.
"""
import importlib.util
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
COMPOSITION = json.loads((ROOT / "demo" / "play-campaign.json").read_text(encoding="utf-8"))
DRAFTS = ROOT / "communications" / "video-drafts"
VARIANTS = COMPOSITION["variants"]
SEGMENTS = [(key, s) for key, v in VARIANTS.items() for s in v["segments"]]

_spec = importlib.util.spec_from_file_location("claims", ROOT / "tests" / "test_claims.py")
claims = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(claims)


def _captions(segment):
    return [segment["kicker"], segment["title"], segment["text"]]


def _starts(variant):
    t, out = 0, []
    for s in VARIANTS[variant]["segments"]:
        out.append(t)
        t += s["duration"]
    return out, t


def test_primary_cut_follows_the_issue_storyboard():
    segments = VARIANTS["play-campaign"]["segments"]
    starts, total = _starts("play-campaign")
    assert [s["id"] for s in segments] == ["hook", "profile", "card", "journey", "useful", "cta"]
    assert starts == [0, 5, 12, 20, 29, 35]
    assert 35 <= total <= 45
    titles = [s["title"] for s in segments]
    assert titles[0] == "What if your research record had a Play button?"
    assert titles[1:5] == ["One public record.", "Your scientific trading card.",
                           "Your research journey, visualized.", "Useful outputs, too."]
    assert titles[5] == "Science Record Player · Publish or Play"
    assert set(VARIANTS["play-campaign"]["formats"]) == {"square", "landscape"}


def test_walkthrough_variant_fits_the_long_format():
    _, total = _starts("play-walkthrough")
    assert 90 <= total <= 150
    assert VARIANTS["play-walkthrough"]["formats"] == ["landscape"]


@pytest.mark.parametrize("variant", VARIANTS)
def test_segments_are_named_and_deterministic(variant):
    segments = VARIANTS[variant]["segments"]
    assert len({s["id"] for s in segments}) == len(segments)
    assert segments[0]["kind"] == "card" and segments[-1]["kind"] == "card"
    for s in segments:
        assert s["kind"] in {"card", "studio"} and s["screen"]
        assert isinstance(s["duration"], int) and s["duration"] >= 5
        actions = s.get("actions", [])
        assert s["kind"] == "studio" or not actions
        for action in actions:
            assert len(action) == 1 and next(iter(action)) in {"tab", "wait", "scroll", "scrollTo", "click"}
        # Waits inside a segment must leave time for the caption to be read on the last screen.
        assert sum(a.get("wait", 0) for a in actions) <= s["duration"] - 2.5


def test_tabs_exist_and_the_unmerged_bridge_and_guides_are_not_captured():
    studio = (ROOT / "web/playground/studio.js").read_text(encoding="utf-8")
    block = studio[studio.index("const TABS = {"):studio.index("\n};", studio.index("const TABS = {"))]
    tabs = set(re.findall(r"^  '?([A-Z][^'(]*)'?\(\) \{", block, re.MULTILINE))
    assert {"Profile", "Trading card", "Heatmap", "Wrapped", "Record check", "Citations & data"} <= tabs
    used = {a["tab"] for _, s in SEGMENTS for a in s.get("actions", []) if "tab" in a}
    assert used <= tabs
    assert ".result-actions" in COMPOSITION["hide_selectors"]  # holds the "Add to my research network" bridge
    assert "#me" in COMPOSITION["hide_selectors"]
    actions = json.dumps([s.get("actions", []) for _, s in SEGMENTS]).lower()
    clicks = [a["click"] for _, s in SEGMENTS for a in s.get("actions", []) if "click" in a]
    assert clicks == ["#panel .tools button"]  # only Fortune's own seeded "Another one" button
    assert "let seed = 1;" in studio and "seed: seed++" in studio
    assert "network" not in actions and "guide" not in actions and "team" not in actions
    index = (ROOT / "web/playground/index.html").read_text(encoding="utf-8")
    assert COMPOSITION["preroll_scroll"] == ".try" and 'class="try"' in index
    assert "(stored, offline)</button>" in index  # the on-screen label of the stored profile


@pytest.mark.parametrize("key,segment", SEGMENTS, ids=[f"{k}-{s['id']}" for k, s in SEGMENTS])
def test_captions_follow_the_claim_rules(key, segment):
    text = " ".join(_captions(segment))
    for pattern in claims.FORBIDDEN:
        assert not re.search(pattern, text, re.IGNORECASE), pattern
    for pattern in claims.NEGATED_ONLY:
        for match in re.finditer(pattern, text, re.IGNORECASE):
            assert claims.NEGATION.search(claims._context(text, match.start(), 45)), pattern
    # Output counts are activity, never impact or merit; and no caption states a number of its own.
    for match in re.finditer(r"\b(impact|merit|quality|excellence|productivity|ranking)\b", text, re.IGNORECASE):
        sentence = text[:match.start()].rsplit(".", 1)[-1]
        assert re.search(r"\bnot\b", sentence, re.IGNORECASE), f"unnegated '{match.group()}' in {segment['id']}"
    assert not re.search(r"\d", text), "captions must not introduce figures; the screen shows the app's own output"
    assert not re.search(r"ORCID Playground|verified|endorsed", text, re.IGNORECASE)


@pytest.mark.parametrize("key,segment", SEGMENTS, ids=[f"{k}-{s['id']}" for k, s in SEGMENTS])
def test_captions_can_be_read_in_time(key, segment):
    chars = len(segment["title"]) + len(segment["text"])
    assert chars / (segment["duration"] - 0.5) <= 17, "over 17 characters per second"
    assert len(segment["title"]) <= 48


def test_caption_sizes_are_phone_legible_and_colours_follow_the_brand():
    for name, f in COMPOSITION["formats"].items():
        assert f["body_px"] / f["height"] >= 1 / 32, name
        assert f["title_px"] / f["height"] >= 0.055, name
        assert f["kicker_px"] / f["height"] >= 0.022, name
        assert f["title_px"] > f["body_px"] > f["kicker_px"]
    assert COMPOSITION["formats"]["square"]["width"] == COMPOSITION["formats"]["square"]["height"] == 1080
    brand = (ROOT / "brand/README.md").read_text(encoding="utf-8")
    for colour in COMPOSITION["brand"].values():
        assert colour in brand


def test_audio_is_off_by_default_and_not_claimed():
    assert COMPOSITION["audio"]["narration"] is None and COMPOSITION["audio"]["music"] is None
    for name in ("README.md", "transcript-DRAFT.md"):
        assert "No narration or music" in (DRAFTS / name).read_text(encoding="utf-8")


def test_drafts_are_marked_unpublished_and_blocked():
    assert COMPOSITION["status"] == "DRAFT — NOT APPROVED FOR PUBLICATION"
    files = sorted(DRAFTS.iterdir())
    assert {f.name for f in files} >= {"README.md", "transcript-DRAFT.md", "post-caption-DRAFT.md", "review-checklist-DRAFT.md",
                                       "play-campaign-DRAFT.vtt", "play-campaign-DRAFT.srt",
                                       "play-walkthrough-DRAFT.vtt", "play-walkthrough-DRAFT.srt"}
    for f in files:
        text = f.read_text(encoding="utf-8")
        if f.suffix == ".srt":  # SRT has no comment syntax: the status is in the file name
            assert "DRAFT" in f.name
            continue
        assert "DRAFT — NOT APPROVED FOR PUBLICATION" in text, f.name
        assert "#44" in text and "Release B" in text, f.name
        for pattern in claims.FORBIDDEN:
            assert not re.search(pattern, text, re.IGNORECASE), (f.name, pattern)
        for pattern in claims.NEGATED_ONLY:
            for match in re.finditer(pattern, text, re.IGNORECASE):
                assert claims.NEGATION.search(claims._context(text, match.start(), 45)), (f.name, pattern)
    checklist = (DRAFTS / "review-checklist-DRAFT.md").read_text(encoding="utf-8")
    assert "_not signed_" in checklist and "[x]" not in checklist.lower()
    assert "hosted" in checklist
    assert "**Blocking:** co-author names" in checklist


def _cues(path, sep):
    text = path.read_text(encoding="utf-8")
    pattern = rf"(\d\d):(\d\d):(\d\d){sep}(\d{{3}}) --> (\d\d):(\d\d):(\d\d){sep}(\d{{3}})\n((?:.+\n?)+)"
    out = []
    for m in re.finditer(pattern, text):
        g = [int(x) for x in m.groups()[:8]]
        start = g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 1000
        end = g[4] * 3600 + g[5] * 60 + g[6] + g[7] / 1000
        out.append((start, end, m.group(9).strip().split("\n")))
    return out


@pytest.mark.parametrize("variant", VARIANTS)
@pytest.mark.parametrize("ext,sep", [("vtt", r"\."), ("srt", ",")])
def test_caption_files_match_the_composition(variant, ext, sep):
    cues = _cues(DRAFTS / f"{variant}-DRAFT.{ext}", sep)
    segments = VARIANTS[variant]["segments"]
    starts, _ = _starts(variant)
    assert len(cues) == len(segments), "regenerate with: node demo/play-campaign.mjs --text-only"
    for (start, end, lines), s, t in zip(cues, segments, starts):
        assert start == pytest.approx(t + 0.4) and end == pytest.approx(t + s["duration"] - 0.1)
        assert lines == [x for x in (s["title"], s["text"]) if x]


def test_transcript_lists_every_caption():
    transcript = (DRAFTS / "transcript-DRAFT.md").read_text(encoding="utf-8")
    for _, s in SEGMENTS:
        assert s["title"] in transcript and s["screen"] in transcript


def test_provenance_claims_are_limited_to_the_biosketch_json():
    """BibTeX, RIS and CSL JSON do not carry per-field provenance; only the Biosketch JSON does."""
    texts = [" ".join(_captions(s)) for _, s in SEGMENTS]
    texts += [(DRAFTS / n).read_text(encoding="utf-8") for n in ("post-caption-DRAFT.md", "transcript-DRAFT.md")]
    for text in texts:
        for m in re.finditer(r"per-field provenance", text):
            sentence = re.split(r"(?<=[.;])\s", text[:m.start()])[-1]
            assert "Biosketch JSON" in sentence, sentence
