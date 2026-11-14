# Connect & Organize video drafts (#59)

> **DRAFT — NOT APPROVED FOR PUBLICATION.** Blocked by **#44** (ORCID brand review of the rebranded app) and by
> **Release B** in [`../release-checklist.md`](../release-checklist.md), which the owner must sign after checking
> the hosted site. Do not upload, post or link any video or text from this folder until both are cleared.
> The guided Connect & Organize flow shown here comes from PR #66 (#56), which is **not merged** yet: re-render
> from the merged, deployed commit before any review is signed.

| File | What it is | Source |
|---|---|---|
| `organize-campaign-DRAFT.vtt` / `.srt` | Caption track for the 65 s social cut (16:9 and 1080x1080) | generated |
| `organize-walkthrough-DRAFT.vtt` / `.srt` | Caption track for the 150 s walkthrough (16:9) | generated |
| `organize-transcript-DRAFT.md` | Timed on-screen text, screen description and typed demo data for both cuts | generated |
| `organize-post-caption-DRAFT.md` | Draft LinkedIn / website text and call to action | hand-written |
| `organize-review-checklist-DRAFT.md` | What a person must check before Release B can be signed, incl. storyboard/screenshot gate and mobile playback | hand-written |

"Generated" files are written by `node demo/organize-campaign.mjs --text-only` from
[`demo/organize-campaign.json`](../../demo/organize-campaign.json). Edit the JSON and regenerate;
`tests/test_organize_campaign.py` fails if the caption files drift from it, if a caption breaks the claim rules in
[`../claims-privacy-audit.md`](../claims-privacy-audit.md), or if a label the demo clicks disappears from the app.

**What the video shows:** one continuous browser take, in a fresh and empty browser profile, of the full path
Contacts import with a meeting tag → private note → follow-up with a due date → local Group from two contacts →
selected project output → team pack download. The walkthrough adds the guide, the **Save as contact** confirmation
and the guide with every step done. The researchers are the four fictional “(Demo)” records of
`demo/synthetic.mjs`, served in place of `pub.orcid.org`; every other external request is blocked. The renderer
opens the downloaded team pack and fails if it holds the typed note, follow-up or meeting tag.

**Not shown:** Public Group View, sign-in, cloud Teams or sync, e-mail, invitations, the app's own labelled
sample workspace, workspace backup files.

**Audio:** the videos are silent with burned-in captions. No narration or music exists in this repository. The
renderer can mix in a narration or music file only when one is passed explicitly (`--narration=`, `--music=`); any
music must be original or licensed, and its licence recorded here before use.

The MP4s, thumbnails and the render manifest (renderer commit, served build digest and whether it equals a fresh
build of that commit, date, measured durations, per-segment slack, blocked requests, team-pack check) are written to `demo/out/`, which is not committed. Render them with
`node demo/organize-campaign.mjs site` or the manual **Render scientist-facing demo videos** workflow (input
`organize_campaign`, off by default).
