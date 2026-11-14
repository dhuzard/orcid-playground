# Connect & Organize video — review checklist (#59)

> **DRAFT — NOT APPROVED FOR PUBLICATION.** This list prepares evidence for **Release B** in
> [`../release-checklist.md`](../release-checklist.md); it does not replace it. Publication also waits on **#44**,
> on the claim audit of **#55**, and on PR #66 (#56) being merged and deployed.
> Agents may fill in the “evidence” column but must not tick boxes or sign on behalf of the owner.

| Check | Evidence (fill in) | OK |
|---|---|---|
| Rendered from the commit signed off in Release A, after PR #66 is merged: in `demo/out/organize-campaign-manifest.json`, `renderer.commit` is that commit, `renderer.working_tree_clean: true` and `captured_site.matches_fresh_build_of_renderer_commit: true` (the filmed site equals a fresh build of that commit; record `captured_site.build_digest`). `synthetic_records.sha256` identifies the fictional people | | [ ] |
| Measured durations match the plan: social cut 65 s (16:9 + square), walkthrough 150 s (manifest `measured_seconds`) | | [ ] |
| **Storyboard/screenshot gate:** before watching, compare the manifest thumbnails and one frame per segment (`ffmpeg -ss <segment start + 3> -i <file> -frames:v 1 <png>`) with the segment table in `organize-transcript-DRAFT.md`; every frame shows the screen its row describes | | [ ] |
| The full Contact → note → follow-up → Group → project output → team pack path is one **continuous** take in each cut (manifest `takes[].continuous_segments`), not stitched scenes | | [ ] |
| Every action visibly completes in the app (its own notice: “Finished…”, “Note saved.”, “Follow-up added.”, “Group created…”, “Output selected…”, “Team pack downloaded…”); no added toasts, fake invitations or fake messages | | [ ] |
| Manifest `team_pack`: the downloaded pack lists the group members and holds none of the typed note, follow-up or meeting tag | | [ ] |
| Manifest `blocked_external_requests` is empty, or every entry is understood and harmless | | [ ] |
| Watched end to end, both cuts, with sound off: the full path is clear from captions alone | | [ ] |
| Captions shown: “Your notes stay in this browser by default”, “No invitation or notification sent”, “Curated membership/project attribution is not independently verified” | | [ ] |
| No caption or frame promises cloud sync, e-mail dispatch, membership consent or automatic collaboration discovery | | [ ] |
| Every caption matches the UI at that commit (guide steps, Save as contact fields, tab names, button labels) | | [ ] |
| Only fictional “(Demo)” people, the “(Demo)” meeting and the “(Demo)” group appear; every caption carries the “Fictional (Demo) data · local build” tag | | [ ] |
| **Note:** the app labels the synthetic people “Public ORCID record 0000-0000-0000-…”, because they are served in place of the ORCID API; the owner accepts this with the on-screen “Fictional (Demo)” tag, or the segment is re-cut | | [ ] |
| No real contact notes, private team details, tokens, e-mail addresses or browser account chrome in any frame; the sidebar ownership line is the app's own | | [ ] |
| Public Group View, sign-in, cloud Teams and sync are not shown (if a later cut adds Public Group View, it shows only shared-DOI assertions with the supporting DOI) | | [ ] |
| Old branding absent (no “ORCID Playground”, no green ORCID-like mark); closing card shows the exact disclaimer and ® line | | [ ] |
| Compared with the **hosted** site (`https://science-record-player.web.app/network/`) on the date recorded: the same screens exist and behave as shown | | [ ] |
| **Mobile playback:** the square cut played on a phone (muted autoplay, portrait screen, full width): captions readable without zooming, nothing important cut off, the MP4 starts without a visible delay | | [ ] |
| `.srt`/`.vtt` in this folder are in sync with the render (`python -m pytest -q tests/test_organize_campaign.py`), and the `.srt` is attached to the upload | | [ ] |
| Audio: silent version reviewed. If a narration or music version is made, its file and licence are recorded in `organize-README-DRAFT.md` and it was reviewed too | | [ ] |
| Thumbnails (`demo/out/organize-*-thumbnail.png`) reviewed | | [ ] |
| #44 outcome allows promotion under the current name | | [ ] |

Reviewer: _not signed_ · Date: _not signed_
