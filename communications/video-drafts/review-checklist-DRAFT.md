# Explore & Play video — review checklist (#58)

> **DRAFT — NOT APPROVED FOR PUBLICATION.** This list prepares evidence for **Release B** in
> [`../release-checklist.md`](../release-checklist.md); it does not replace it. Publication also waits on **#44**.
> Agents may fill in the “evidence” column but must not tick boxes or sign on behalf of the owner.

| Check | Evidence (fill in) | OK |
|---|---|---|
| Rendered from the commit signed off in Release A: `renderer.commit` in `demo/out/play-campaign-manifest.json`, `renderer.working_tree_clean: true` and `captured_site.matches_fresh_build_of_renderer_commit: true` | | [ ] |
| Measured durations match the plan: social cut 42 s (square + 16:9), walkthrough 115 s (manifest `measured_seconds`) | | [ ] |
| Watched end to end, both cuts, with sound off: the message is clear from captions alone | | [ ] |
| Every caption matches the UI at that commit (tab names, export formats, draft wording on Funder biosketch) | | [ ] |
| Stored profile is labelled on screen: “stored, offline” chip in the profile segment and the “Stored demo profile · local build” tag on every Studio caption | | [ ] |
| Only the maintainer's stored public profile appears, and the maintainer consents to its use in this video | | [ ] |
| **Blocking:** co-author names visible in the Wrapped tab ("First time together") come from that public record; the owner accepts showing them, or the segment is re-cut to avoid them | | [ ] |
| No invented numbers: every figure on screen is the app's own output for that record | | [ ] |
| No caption equates output counts with quality, impact or merit | | [ ] |
| Not shown: the Studio → network bridge, first-run guides, sign-in, cloud Teams/sync, contacts or notes, browser chrome, e-mail addresses, tokens | | [ ] |
| Old branding absent (no “ORCID Playground”, no green ORCID-like mark); closing card shows the exact disclaimer and ® line | | [ ] |
| Compared with the **hosted** site (`https://science-record-player.web.app/`) on the date recorded: the same Explore & Play screens exist and behave as shown | | [ ] |
| `.srt`/`.vtt` in this folder are in sync with the render (`python -m pytest -q tests/test_play_campaign.py`) | | [ ] |
| Audio: silent version reviewed. If a narration or music version is made, its file and licence are recorded in `README.md` and it was reviewed too | | [ ] |
| Thumbnail (`demo/out/play-campaign-thumbnail.png`) reviewed | | [ ] |
| #44 outcome allows promotion under the current name | | [ ] |

Reviewer: _not signed_ · Date: _not signed_
