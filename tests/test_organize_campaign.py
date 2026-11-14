"""Connect & Organize video composition (#59): storyboard, continuity, UI labels, caption claims and draft files.

The composition in demo/organize-campaign.json drives demo/organize-campaign.mjs, which reuses the Contacts and
Groups steps of demo/contacts.mjs and demo/groups.mjs. These checks need no browser or ffmpeg: they hold the script
to the issue's storyboard, to the labels the network app really shows (web/network/app.js) and to the claim rules
of communications/claims-privacy-audit.md.
"""
import importlib.util
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
COMPOSITION = json.loads((ROOT / "demo" / "organize-campaign.json").read_text(encoding="utf-8"))
DRAFTS = ROOT / "communications" / "video-drafts"
VARIANTS = COMPOSITION["variants"]
SEGMENTS = [(key, s) for key, v in VARIANTS.items() for s in v["segments"]]
REQUIRED = COMPOSITION["required_captions"]
APP = (ROOT / "web" / "network" / "app.js").read_text(encoding="utf-8")
STEPS_SOURCE = "\n".join((ROOT / "demo" / name).read_text(encoding="utf-8")
                         for name in ("contacts.mjs", "groups.mjs", "organize-campaign.mjs"))
OWN_DRAFTS = sorted(DRAFTS.glob("organize-*"))

_spec = importlib.util.spec_from_file_location("claims", ROOT / "tests" / "test_claims.py")
claims = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(claims)

# The step names organize-campaign.mjs implements, and the order of the workflow the video must show.
STEPS = {"guide", "guideSteps", "guideDone", "importAndTag", "saveAsContact", "showCard", "note", "followUp",
         "openFollowUps", "createGroup", "roster", "selectOutputs", "teamPack"}
PATH = ["importAndTag", "note", "followUp", "createGroup", "selectOutputs", "teamPack"]

# Every UI label, button and confirmation the steps rely on, as the network app writes it (#56, PR #66).
UI_LABELS = [
    "Connect & Organize, step by step", "guide-steps",
    "'Conference or context'", "'ORCID list'", "'Preview list'", "'Import & tag'", "Finished. Review the per-record results",
    "'Conference or context (optional)'", "'Date met (optional)'", "'Private note (optional)'",
    "Read record & save as contact", "saved as a contact",
    "`Contact: ${person.name}`", "`Note about ${person.name}`", "'Add note'", "'Note saved.'",
    "`Follow-up with ${person.name}`", "'Due date'", "'Add follow-up'", "'Follow-up added.'", "Open follow-ups",
    "'+ New group'", "'Group name'", "'Create group'", "Group created.", "'Open group →'",
    "['outputs', 'Project outputs']", "['pack', 'Team pack']", "'Select for'", "'Output selected for this project.'",
    "'↓ Download team pack'", "Your contact tags, notes and follow-ups are never included.",
    "Team pack downloaded with your selected scope", "class: `bulk-entry ${e.status}`", "entry.status = 'done'",
    "renderGuide();",  # step 7 is marked done right after the download (#66 at 94c4d8a)
]
# The same labels as the demo steps use them.
STEP_LABELS = [
    "#guide", "guide-steps", "'Conference or context'", "'ORCID list'", "Preview list", "Import & tag", "Finished",
    "'Conference or context (optional)'", "'Date met (optional)'", "'Private note (optional)'",
    "'Read record & save as contact'", "saved as a contact", "Contact: ", "Note about ", "'Add note'", "'Note saved.'",
    "Follow-up with ", "'Due date'", "'Add follow-up'", "'Follow-up added.'", "Open follow-ups",
    "'+ New group'", "'Group name'", "'Create group'", "'Group created.'", "'Open group →'",
    "'Project outputs'", "'Team pack'", "Select for project", "'Output selected for this project.'", "'↓ Download team pack'",
    "Team pack downloaded", ".bulk-entry.done",
]


def _text(segment):
    return " ".join(x for x in (segment["kicker"], segment["title"], segment["text"]) if x)


def _starts(variant):
    t, out = 0, []
    for s in VARIANTS[variant]["segments"]:
        out.append(t)
        t += s["duration"]
    return out, t


def _steps(variant):
    return [a["step"] for s in VARIANTS[variant]["segments"] for a in s.get("actions", []) if "step" in a]


def test_primary_cut_follows_the_issue_storyboard():
    segments = VARIANTS["organize-campaign"]["segments"]
    starts, total = _starts("organize-campaign")
    assert [s["id"] for s in segments] == ["hook", "import", "note", "follow-up", "group", "export", "cta"]
    assert starts == [0, 6, 16, 28, 38, 50, 56]  # the 0–6–16–28–38–50–56–65 s table in #59
    assert 50 <= total <= 65
    assert [s["title"] for s in segments] == [
        "Remember that scientist you met?", "Save scientific contacts.", "Remember the conversation.",
        "Keep your promises.", "Turn contacts into working groups.", "Organize the science.", "Try Science Record Player."]
    assert set(VARIANTS["organize-campaign"]["formats"]) == {"square", "landscape"}
    assert "network/" in segments[-1]["text"]  # the research-network link


def test_walkthrough_variant_is_two_to_three_minutes():
    _, total = _starts("organize-walkthrough")
    assert 120 <= total <= 180
    assert VARIANTS["organize-walkthrough"]["formats"] == ["landscape"]
    assert "saveAsContact" in _steps("organize-walkthrough")  # the #56 Save as contact handoff panel
    assert "guideDone" in _steps("organize-walkthrough")


@pytest.mark.parametrize("variant", VARIANTS)
def test_the_whole_path_is_one_continuous_take(variant):
    kinds = [s["kind"] for s in VARIANTS[variant]["segments"]]
    network = [i for i, k in enumerate(kinds) if k == "network"]
    # One unbroken run of network segments = one browser take (organize-campaign.mjs records each run once).
    assert network == list(range(network[0], network[-1] + 1))
    steps = _steps(variant)
    positions = [steps.index(step) for step in PATH]
    assert positions == sorted(positions), steps
    assert steps[-1] in {"teamPack", "guideDone"}


@pytest.mark.parametrize("variant", VARIANTS)
def test_segments_are_named_and_deterministic(variant):
    segments = VARIANTS[variant]["segments"]
    assert len({s["id"] for s in segments}) == len(segments)
    assert segments[-1]["kind"] == "card" and segments[-1]["id"] == "cta"
    for s in segments:
        assert s["kind"] in {"card", "network"} and s["screen"]
        assert isinstance(s["duration"], int) and s["duration"] >= 5
        actions = s.get("actions", [])
        assert (s["kind"] == "network") == bool(actions)
        for action in actions:
            assert set(action) <= {"step", "wait", "count"} and len({"step", "wait"} & set(action)) == 1
            assert action.get("step", "guide") in STEPS
        # Waits must leave time for the action itself and for reading the result.
        assert sum(a.get("wait", 0) for a in actions) <= s["duration"] - 2.5


def test_every_step_is_implemented_and_every_ui_label_exists():
    script = (ROOT / "demo" / "organize-campaign.mjs").read_text(encoding="utf-8")
    for step in STEPS:
        assert re.search(rf"\n    {step}: ", script), step
    for label in UI_LABELS:
        assert label in APP, f"web/network/app.js no longer shows {label!r}; update the demo steps"
    for label in STEP_LABELS:
        assert label in STEPS_SOURCE, label
    assert "export const contactSteps" in STEPS_SOURCE and "export const groupSteps" in STEPS_SOURCE
    # Importing the steps must not render the older demos.
    for name in ("contacts.mjs", "groups.mjs"):
        assert "if (main) {" in (ROOT / "demo" / name).read_text(encoding="utf-8"), name
    assert "size = { width: W, height: H }" in (ROOT / "demo" / "lib.mjs").read_text(encoding="utf-8")


def test_only_fictional_demo_data_in_an_isolated_browser():
    demo = COMPOSITION["demo"]
    for key in ("context", "group"):
        assert demo[key].endswith("(Demo)")
    typed = " ".join(str(v) for k, v in demo.items() if isinstance(v, str))
    assert "@" not in typed and not re.search(r"https?://", typed)
    synthetic = (ROOT / "demo" / "synthetic.mjs").read_text(encoding="utf-8")
    assert "`${p.family} (Demo)`" in synthetic and "10.5555/" in synthetic
    script = (ROOT / "demo" / "organize-campaign.mjs").read_text(encoding="utf-8")
    assert "serveSyntheticOrcid(ctx)" in script and "blocked_external_requests" in script and "route.abort()" in script
    assert "inspectPack" in script  # the downloaded team pack is opened and checked for private contact text
    # The manifest identifies the renderer commit and, separately, the served build, and refuses a stale build.
    lib = (ROOT / "demo" / "lib.mjs").read_text(encoding="utf-8")
    assert "export function siteIdentity()" in lib and "matches_fresh_build_of_renderer_commit" in lib
    assert "siteIdentity()" in script and "=== false) {\n  throw new Error" in script
    assert "synthetic_records" in script
    # Neither the app's own sample workspace, nor Public Group View, nor sign-in or cloud features are driven.
    for absent in ("#demo'", "offerSample", "/group/", "#sync", "/team/"):
        assert absent not in script, absent
    assert "Public Group View" not in json.dumps(COMPOSITION["variants"])


@pytest.mark.parametrize("variant", VARIANTS)
def test_required_captions_appear_in_every_variant(variant):
    text = " ".join(_text(s) for s in VARIANTS[variant]["segments"])
    for caption in REQUIRED:
        assert caption in text, caption
    assert set(REQUIRED) == {"Your notes stay in this browser by default", "No invitation or notification sent",
                             "Curated membership/project attribution is not independently verified"}


@pytest.mark.parametrize("key,segment", SEGMENTS, ids=[f"{k}-{s['id']}" for k, s in SEGMENTS])
def test_captions_follow_the_claim_rules(key, segment):
    text = _text(segment)
    for pattern in claims.FORBIDDEN:
        assert not re.search(pattern, text, re.IGNORECASE), pattern
    for pattern in claims.NEGATED_ONLY:
        for match in re.finditer(pattern, text, re.IGNORECASE):
            assert claims.NEGATION.search(claims._context(text, match.start(), 45)), pattern
    # No promise of sync, cloud, e-mail, invitations, notifications, consent, verification or discovery:
    # these words may appear only in a sentence that negates them.
    promise = r"\b(sync\w*|cloud|e-?mails?|invit\w*|notif\w*|consent\w*|verif\w*|discover\w*|automatic\w*|confirm\w*)\b"
    for match in re.finditer(promise, text, re.IGNORECASE):
        sentence = re.split(r"[.!?]\s", text[:match.start()])[-1]
        assert re.search(r"\b(not|no|never|nor|without)\b", sentence, re.IGNORECASE), f"unnegated '{match.group()}' in {segment['id']}"
    assert not re.search(r"\d", text), "captions must not introduce figures; the screen shows the app's own output"
    assert not re.search(r"ORCID Playground|endorsed|approved", text, re.IGNORECASE)


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
    for name in ("organize-README-DRAFT.md", "organize-transcript-DRAFT.md"):
        assert "No narration or music" in (DRAFTS / name).read_text(encoding="utf-8")


def test_workflow_input_is_optional_and_off_by_default():
    workflow = (ROOT / ".github" / "workflows" / "video-demo.yml").read_text(encoding="utf-8")
    block = workflow[workflow.index("organize_campaign:"):]
    assert re.search(r"organize_campaign:\n\s+description: .*not approved for publication.*\n\s+type: boolean\n\s+default: false", block)
    assert "if: ${{ inputs.organize_campaign }}" in workflow and "node demo/organize-campaign.mjs site" in workflow
    assert "push:" not in workflow and "pull_request" not in workflow


def test_drafts_are_marked_unpublished_and_blocked():
    assert COMPOSITION["status"] == "DRAFT — NOT APPROVED FOR PUBLICATION"
    names = {f.name for f in OWN_DRAFTS}
    assert names >= {"organize-README-DRAFT.md", "organize-transcript-DRAFT.md", "organize-post-caption-DRAFT.md",
                     "organize-review-checklist-DRAFT.md", "organize-campaign-DRAFT.vtt", "organize-campaign-DRAFT.srt",
                     "organize-walkthrough-DRAFT.vtt", "organize-walkthrough-DRAFT.srt"}
    for f in OWN_DRAFTS:
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
    checklist = (DRAFTS / "organize-review-checklist-DRAFT.md").read_text(encoding="utf-8")
    assert "_not signed_" in checklist and "[x]" not in checklist.lower()
    for gate in ("hosted", "**Storyboard/screenshot gate", "**Mobile playback", "continuous", "#55",
                 "captured_site.matches_fresh_build_of_renderer_commit: true", "renderer.commit", "synthetic_records.sha256"):
        assert gate in checklist, gate
    post = (DRAFTS / "organize-post-caption-DRAFT.md").read_text(encoding="utf-8")
    for caption in REQUIRED:
        assert caption in post
    disclaimer = json.loads((ROOT / "config/brand.json").read_text(encoding="utf-8"))["disclaimer"]
    assert disclaimer in post


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
    assert len(cues) == len(segments), "regenerate with: node demo/organize-campaign.mjs --text-only"
    for (start, end, lines), s, t in zip(cues, segments, starts):
        assert start == pytest.approx(t + 0.4) and end == pytest.approx(t + s["duration"] - 0.1)
        assert lines == [x for x in (s["title"], s["text"]) if x]


def test_transcript_lists_every_caption_and_the_typed_data():
    transcript = (DRAFTS / "organize-transcript-DRAFT.md").read_text(encoding="utf-8")
    for _, s in SEGMENTS:
        assert s["title"] in transcript and s["screen"] in transcript and s["text"] in transcript
    for key in ("context", "note", "follow_up", "group", "handoff_note"):
        assert COMPOSITION["demo"][key] in transcript
    assert "one continuous browser take" in transcript
