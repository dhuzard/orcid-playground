# Science Record Player — comprehensive scientist-facing video

**Status:** ready-to-record / editing script. **No complete video is claimed as published.**
**Primary audience:** individual scientists, lab coordinators, data stewards and research librarians.
**Deliverables:** chaptered 5–6-minute walkthrough; 45–60-second invitation clip; 4–6 topical 15–30-second cuts. Captions and a transcript required. Show the actual product, not mock UI.

## Use the existing video pipeline

The Playwright + FFmpeg screen-capture pipeline from PR [#31](https://github.com/dhuzard/science-record-player/pull/31) is **merged** (`demo/render.mjs`, `demo/groups.mjs`, `demo/contacts.mjs`, `demo/full-tour.mjs`), with a manually dispatched GitHub workflow (`video-demo.yml`); see [`demo/README.md`](../demo/README.md). **Extend these scripts rather than starting a second screen-recording implementation.** No rendered video has been reviewed or published yet.

Its current coverage: Studio, local research network, working-group flows, public Group view, Contacts. It currently excludes some live-auth scenarios and encrypted team packages. The Group scene uses explicitly labelled *fictional Demo* researchers and synthetic DOIs; never suggest those are live publications.

Do not make an all-features claim until the omissions below are either recorded or labelled unavailable.

## Core narrative: what can scientists accomplish?

| Time | Actual screen to record | Voiceover / on-screen message |
| --- | --- | --- |
| 00:00–00:18 | Homepage headline “Explore your scientific record. Connect your research world.”, the two paths, then Explore: ORCID iD input, stored-profile sample | **“Your ORCID record is more than a link. What if it became something you could explore, check, reuse—and build on?”** No account required for public records. |
| 00:18–00:43 | Profile; search/filter/sort public works | “Start from one public record. Find affiliations, outputs and linked publications in a searchable profile.” |
| 00:43–01:05 | Record check then funder biosketch | “Spot missing information and get specific corrections. Draft NIH, ERC or Horizon biosketch material—but check it before submission.” |
| 01:05–01:28 | Citations & data (BibTeX, RIS, CSL JSON, biosketch JSON, JSON-LD, Markdown) | “Download bibliographies and machine-readable profiles, with their original provenance preserved.” |
| 01:28–01:53 | Trading card, Heatmap, Wrapped, Fortune | “Explore playful ways to see your scientific trajectory, without inventing papers or interpreting activity as scientific merit.” |
| 01:53–02:23 | Connect & Organize → My Network: Feed, People, Saved; manually refresh, filter by group/topic/type | “Follow researchers, organize selected outputs, and see which records changed. New to your feed does not necessarily mean newly published.” |
| 02:23–02:57 | Contacts: import from a list; context tag, note, follow-up and due date. Show bookmarklet if it works in the target browser. | “Keep the context of a conference conversation. These are your private local notes; nobody is automatically notified.” |
| 02:57–03:34 | Local Groups: curated roster, editable roles and expertise, select project outputs, assign request, download team pack | “Curate a working group and assemble a team pack. Membership and project contribution are your annotations, not independently confirmed facts.” |
| 03:34–04:15 | Public Group view: compose link; DOI graph + supporting DOI detail; record health; team biosketch | “See which public records list the same DOI, and inspect the supporting evidence. A shared DOI is **not proof of collaboration or group membership**.” |
| 04:15–04:45 | Group Wrapped, card deck, heatmap, bibliography, Embed snapshot | “Create a group-level overview and a static widget for a lab website.” |
| 04:45–05:05 | Download/restore browser workspace; encrypted team-package export/import, with sensitive-content warning | “Your default workspace is in your browser. Download a backup, or encrypt a package to share deliberately. Keep contact notes private.” |
| 05:05–05:22 | Optional ORCID sign-in and Me panel *only if verified on public deployment* | “Sign-in is optional for public exploration. Private cloud Team workspaces are not in this live demo until separately activated and tested.” |
| 05:22–05:45 | Live in-app feedback page and site URL | “Try it with your record or with sample data. Tell us what is missing, misleading or useful. The next features should come from researchers' real tasks.” |

The final cut can move faster than these timings; retain every scientific qualification even if the chapter is shortened.

## Production acceptance criteria

Publication is gated by [`release-checklist.md`](release-checklist.md) (Release B); the criteria below are the production detail.


1. Record the **actual merged, deployed version**. Add the Git commit/date in the video description.
2. Test every scripted interaction against the UI in the target environment; do not fake successful downloads, identity verification, emails or invitations.
3. Clearly label sample/stored data and synthetic Group view records. Remove all real contact notes, tokens, credentials and unpublished team details from capture.
4. If an auth-only or cloud Team flow is not deployed and demonstrated end-to-end, **do not show it as an available feature**. Use a “in development” note outside the main demo instead.
5. Include accurate on-screen warnings: public assertions not independently verified; same DOI not evidence of confirmed collaboration; local roles not confirmed; funder drafts require review.
6. Output 16:9 1080p or 720p master; captioned vertical/square clips; transcript (`.vtt` and text); readable font at phone size.
7. End with the public site (https://science-record-player.web.app/), GitHub repo, and [in-app feedback](https://science-record-player.web.app/feedback/); do not use unverified docs or video URLs.
8. Add a versioned `docs/` link to the final video description only once Sphinx docs are published.

## Practical capture notes

- Use the [maintainer's stored profile](https://science-record-player.web.app/) for deterministic Studio clips.
- Use the app's **labelled sample workspace** for Feed/People/Contacts/Groups.
- In Public Group View, the merged synthetic router (`demo/synthetic.mjs`) generates clearly marked *Demo* members; an alternative real-record version must use public records and appropriate permission for identifiable people.
- Voiceover should emphasize **research questions and reproducible outputs**, not a terminal demonstration.
- Inspect the actual hosted backend status before capturing the optional private Teams/sync sequences.
- Keep the tagline short: **“Try it. Question it. Help shape it.”**

## Distribution assets

- **Full tour:** chaptered YouTube/video embed, repository README and Sphinx introductory page after publication.
- **Short invitation:** LinkedIn, academic communities, research software groups; link directly to the live demo.
- **Topical clips:** data quality; reuse/export; contacts; groups; traceable collaboration; scientific limitations.

## Explicit omissions / follow-up recording tasks for the video scripts

- Workspace backup **download and restore**.
- Encrypted group package export/import.
- Optional sign-in and Me panel, if verified live.
- Contacts bookmarklet (not just bulk import).
- Research-network filters, Saved, and new group suggestions.
- Privacy boundary and a visible feedback call-to-action.
- Cloud Teams and personal sync are **out of scope until production activated, security-reviewed and tested**.
