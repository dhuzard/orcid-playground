# Demo videos

Videos of the web app UI only (no terminal). `python scripts/build_site.py site && node demo/render.mjs site`
renders a ~100 s full demo (1280x720) and 1080x1080 LinkedIn clips into `demo/out/` (needs Playwright and ffmpeg).

The real built site is served locally. The Studio runs on the maintainer's stored profile (the "stored, offline" chip)
and the research network on its labelled **Demo** sample data, so no ORCID API access is needed. Pyodide is pinned by
SHA-256 in `scripts/build_site.py`; if the CDN is blocked, put the verified files in `.cache/pyodide-0.26.4/`.
Not shown: the Group view (it needs live ORCID records) and sign-in with ORCID. Record those from a networked machine.

On GitHub, **Render scientist-facing demo videos** runs only when dispatched by hand (Actions → Run workflow, or
`gh workflow run video-demo.yml --ref <branch>`); it does not run on pushes or pull requests. The videos are uploaded
as a 7-day workflow artifact.

| File | Length | Message |
|---|---|---|
| `studio-full-demo.mp4` | ~100 s | Studio tour, then the research network |
| `clip-0-teaser` | ~5 s | "Your ORCID record, re-expressed." |
| `clip-1-record-check` | ~12 s | Score and concrete fixes |
| `clip-2-funder-templates` | ~12 s | ERC / NIH / Horizon from one record |
| `clip-3-wrapped` | ~12 s | Year in review and Fortune |
| `clip-4-card-and-heatmap` | ~12 s | Trading card and honest heatmap |
| `clip-5-research-network` | ~20 s | Feed, people, working groups |
| `clip-6-citations-and-data` | ~8 s | BibTeX, RIS, CSL, JSON-LD, Markdown |

## Working-group demo

`node demo/groups.mjs site` renders a ~130 s long cut and six 1080x1080 clips (`groups-*.mp4`).

- Part 1 (roster, roles, project outputs, requests, team pack) is the network app's labelled **Demo** workspace.
- Part 2 (Group view: graph, shared outputs, record health, team biosketch, Wrapped, card deck, embed) needs ORCID
  records, so `demo/synthetic.mjs` serves four **fictional, "(Demo)"-labelled** researchers in place of
  `pub.orcid.org`. Their DOIs use Crossref's test prefix 10.5555. Nothing in that part is a real record, and the
  videos say so on screen. Re-record it against real public iDs, with your consent, for a version with real people.
- Not shown: encrypted team packages and sign-in with ORCID.

| File | Length | Message |
|---|---|---|
| `groups-full-demo.mp4` | ~130 s | Working group, then the shareable Group view |
| `groups-clip-1-roster-and-roles` | ~10 s | Roles and contributions, recorded locally |
| `groups-clip-2-project-outputs-and-requests` | ~23 s | Select project outputs, track requests |
| `groups-clip-3-team-pack` | ~11 s | One download: roster, bibliography, biosketches |
| `groups-clip-4-group-from-orcid-ids` | ~23 s | A group link from public iDs; DOI-linked graph |
| `groups-clip-5-record-health-and-team-biosketch` | ~20 s | What to fix together; funder-format team draft |
| `groups-clip-6-wrapped-cards-embed` | ~18 s | Group Wrapped, card deck, embed |

Group post copy (drafts):
- **Long cut.** Research is a team sport, but team admin is not. Curate a roster, pick the project's outputs, track requests, and see which DOIs members' public ORCID records share. Membership is yours to curate and is never presented as verified. Open source, stored in your browser.
- **Clip 4.** Paste a list of ORCID iDs, get a group link. Two members are linked only when both public records assert the same DOI. (Demo with fictional researchers.)
- **Clip 5.** What should the whole group fix in its ORCID records? Group record health ranks the most common issues, then drafts a team biosketch in ERC, NIH or Horizon format.
- **Clip 3.** One download for the team: roster, merged bibliography, member biosketches and a manifest of exactly what was selected.

## Contacts demo

`node demo/contacts.mjs site` renders a ~67 s cut and four 1080x1080 clips (`contacts-*.mp4`). The contacts are imported by
ORCID iD, so the same fictional "(Demo)" researchers (`demo/synthetic.mjs`) are served in place of the live API. Context,
tags, notes and follow-ups are typed live in the recording.

| File | Length | Message |
|---|---|---|
| `contacts-full-demo.mp4` | ~67 s | Import and tag, notes, follow-ups, contexts |
| `contacts-clip-1-import-and-tag` | ~18 s | Tag everyone from one conference |
| `contacts-clip-2-notes-and-follow-ups` | ~19 s | Private notes and follow-ups with due dates |
| `contacts-clip-3-open-follow-ups` | ~9 s | One list of what you owe people |
| `contacts-clip-4-context-to-group` | ~10 s | Turn a conference context into a working group |

Post copy (draft): *You met twelve people at the conference. A month later, who wanted the protocol? Contacts lets you tag people by event, keep private notes, and track follow-ups. All in your browser, never in a team pack, and the people never see it.*

## LinkedIn copy (drafts)

**Full demo.** Your ORCID record already holds a decade of your work. What if you could reuse it, on your terms?
Publish or Play. Science Record Player turns the public record into a biosketch, NIH/ERC/Horizon templates, citations, a quality check and a few playful extras.
The researcher controls the narrative; ORCID supplies the assertions; every field keeps its provenance. Open source, works offline.
science-record-player.web.app  #ORCID #OpenScience #FAIR #ResearchData

**Clip 1.** How complete is your ORCID record? The Studio gives a score and tells you exactly what to fix.

**Clip 2.** Writing a grant biosketch again? Generate the NIH, ERC or Horizon skeleton from your ORCID record. The story stays yours.

**Clip 3.** "Wrapped" for researchers, with no made-up numbers: busiest month, longest gap, how your title vocabulary drifted.

**Clip 4.** A printable trading card and a publication heatmap, both built only from what your record asserts. Honest about fallow years.

**Clip 6.** Take it with you: BibTeX, RIS, CSL JSON, Schema.org JSON-LD and Markdown, with per-field provenance preserved.

**Clip 5.** A local pilot for following collaborators' public outputs and curating working groups. Sample data is labelled Demo; membership is never presented as verified.

Post tip: LinkedIn autoplays muted, so the captions carry the message. Upload the MP4 natively rather than linking it.

## Connect & Organize cuts (#59, draft)

`node demo/organize-campaign.mjs site` renders the Connect & Organize cuts from `demo/organize-campaign.json`. **Draft,
not approved for publication**: blocked by #44 and Release B in `communications/release-checklist.md`, and it records
the guided flow of PR #66 (#56), which must be merged and deployed before a reviewed render.

The whole path (Contacts import with a meeting tag → private note → follow-up → local Group → project output → team
pack) is **one continuous take** per cut, in a fresh browser profile, with the fictional "(Demo)" researchers of
`demo/synthetic.mjs` served in place of the ORCID API and every other external request blocked. Each segment starts
at its planned time; its actions use the reusable `contactSteps` / `groupSteps` exported by `contacts.mjs` and
`groups.mjs`, wait for the app's own confirmation, and the render fails if one overruns its segment. The downloaded
team pack is opened and checked: members present, typed note, follow-up and meeting tag absent.
The cuts are silent with burned-in captions; `--narration=<file>` / `--music=<file>` add an optional audio version, and
no audio file is included. `--variant=` and `--format=` render one output. `node demo/organize-campaign.mjs --text-only`
rewrites only the caption files and transcript (`communications/video-drafts/organize-*`). In the manual workflow,
tick the `organize_campaign` input.

| File | Length | Segments |
|---|---|---|
| `organize-campaign-landscape.mp4` | 65 s, 1280x720 | hook 6 · import 10 · note 12 · follow-up 10 · group 12 · export 6 · cta 9 |
| `organize-campaign-square.mp4` | 65 s, 1080x1080 | same, recorded natively square |
| `organize-walkthrough-landscape.mp4` | 150 s, 1280x720 | intro, guide, import, Save as contact, note, follow-ups, group, project outputs, team pack, all done, cta |
| `organize-campaign-manifest.json` | | renderer commit, served build digest (checked against a fresh build), render date, data source, measured durations, per-segment slack, blocked requests, team-pack check |
| `organize-*-thumbnail.png` | | frame 3 s into each cut |
