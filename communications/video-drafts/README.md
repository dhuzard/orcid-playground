# Explore & Play video drafts (#58)

> **DRAFT — NOT APPROVED FOR PUBLICATION.** Blocked by **#44** (ORCID brand review of the rebranded app) and by
> **Release B** in [`../release-checklist.md`](../release-checklist.md), which the owner must sign after checking
> the hosted site. Do not upload, post or link any video or text from this folder until both are cleared.

| File | What it is | Source |
|---|---|---|
| `play-campaign-DRAFT.vtt` / `.srt` | Caption track for the 42 s social cut (square and 16:9) | generated |
| `play-walkthrough-DRAFT.vtt` / `.srt` | Caption track for the 115 s walkthrough (16:9) | generated |
| `transcript-DRAFT.md` | Timed on-screen text and screen description for both cuts | generated |
| `post-caption-DRAFT.md` | Draft LinkedIn / website text | hand-written |
| `review-checklist-DRAFT.md` | What a person must check before Release B can be signed | hand-written |

"Generated" files are written by `node demo/play-campaign.mjs --text-only` from
[`demo/play-campaign.json`](../../demo/play-campaign.json). Edit the JSON and regenerate; `tests/test_play_campaign.py`
fails if the caption files drift from it or break the claim rules in [`../claims-privacy-audit.md`](../claims-privacy-audit.md).

**Audio:** the videos are silent with burned-in captions. No narration or music exists in this repository. The
renderer can mix in a narration or music file only when one is passed explicitly (`--narration=`, `--music=`); any
music must be original or licensed, and its licence recorded here before use.

The MP4s, thumbnails and the render manifest (commit SHA, date, measured durations) are written to `demo/out/`, which
is not committed. Render them with `node demo/play-campaign.mjs site` or the manual **Render scientist-facing demo
videos** workflow (input `play_campaign`).
