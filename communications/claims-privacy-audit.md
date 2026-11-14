# Pre-promotion audit: scientific claims, privacy boundaries and brand readiness (#55)

**Audit date:** 14 November 2026 · **Audited ref:** `main` at `57f50aafdfd0b1167fbdfe697ae03001963fa3fc` (10 Nov 2026), re-checked after rebasing onto `main` at `a5b1d58` (PR #63 for #54, 14 Nov 2026), plus the changes in the #55 pull request (merged as PR #61, `d45e5fa`). Status rows for #53 (PR #62, `e058cb2`) were updated after merge; the audit findings themselves were not re-run.
**Scope:** hosted pages (`web/playground/*.html|js`, `web/network/*`), README, SEO/manifest metadata, Sphinx docs (`docs/source/`), design docs (`docs/`), video scripts and overlays (`demo/*.mjs`, `demo/README.md`), and posts (`communications/`).
**Method:** text search for claim words (*prove, proof, verified, collaboration, published together, private, no server, approved, official, compliant, new/discovered*), then reading each hit against what the code actually does (`src/science_record_player/collaboration.py`, `network_store.py`, `web/playground/group-link.js`, `teampack.js`, `team.js`, `cloud.js`, `web/network/app.js`).

**Release decision: NOT cleared for public promotion.** See [§5](#5-launch-decision). The release checklist that gates publication is [`release-checklist.md`](release-checklist.md).

> This audit records what can be checked from the repository. It does **not** claim that anything is verified in production. The audit environment could not reach `science-record-player.web.app` (outbound proxy refused the connection), so every production item below is marked **unverified** until a person checks it and signs the checklist.

## 1. Claim rules

| # | A product statement must not imply… | What the code actually establishes | Approved wording |
|---|---|---|---|
| C1 | A shared DOI is a verified collaboration | `collaboration_graph()` links two members when **both public records list the same DOI**. Nothing else is compared. | “Both public records list the same DOI” + show the DOI(s). “Not proof of collaboration, authorship roles or group membership.” |
| C2 | An ORCID iD or public record is a verified credential | Check-digit validation (`group-link.js validOrcid`, `core.py`) is syntax only; public records are self/third-party assertions. Optional sign-in shows that a visitor controls an ORCID account at that moment. | “Public assertions, not independently verified credentials.” |
| C3 | Local roles/groups are consented membership | Roster, roles, contributions and selections are local annotations; the listed people are never asked. Roster export refuses verified bases (`roster.py`, `docs/roster-assertions.md`). | “Locally curated, not confirmed by the people listed.” |
| C4 | A funder-format biosketch is an approved or compliant submission | Templates in `src/science_record_player/templates/` are filled only from asserted fields. | “Draft only; not an official funder form or a funder-approved submission.” |
| C5 | Feed discovery time is the publication date | The feed's `observed_at` is when *your refresh* first saw an output (`network_store.py`); publication date is a separate field. | “Newly observed / first seen by your refresh”, publication date shown separately. |
| C6 | Everything is private / there is no server | Studio and the network run in the browser, but the hosted site is served by Firebase Hosting, live reads go to `pub.orcid.org`, and cloud Teams (if activated) store data in Firestore. Backups and packages are files the user can leak. | Name *where* each piece of data lives (see the matrix in §3). |
| C7 | Cloud Teams / sync are available | Code, rules and emulator tests exist (`docs/team-workspaces.md`: “built, partly deployed”); the exchange function awaits Blaze billing and a live test. `team.js` shows “not enabled on this site yet” when `config.json` lacks cloud settings. | “In development; not confirmed active on the public site.” |
| C8 | ORCID approves or endorses the product | ORCID declined the old branding (9 Nov 2026) and has not reviewed the rebrand. | Exact disclaimer from `config/brand.json`; never mention approval. |

## 2. Findings and changes (before → after)

Status: **fixed** = changed in the #55 PR · **ok** = already accurate, kept · **depends** = owned by another issue · **open** = needs a human.

| # | Surface | Before | After | Rule | Status |
|---|---|---|---|---|---|
| F1 | `web/playground/group.html` meta description (SEO) | “…who has published together, shown with the DOIs that **prove** it.” | “…which members' public records list the same DOI, with every supporting DOI shown. A shared DOI is not verified collaboration.” | C1 | fixed |
| F2 | `group.html` hero lede | “Anyone who opens it can see who has published together, with the DOIs that **prove** each link.” | “…which members' public records list the same DOI, with the supporting DOI(s) for each link. A shared DOI is not proof of collaboration, authorship roles or group membership.” | C1 | fixed |
| F3 | `group.html` footer | “…both public records assert the same DOI; it does not prove collaboration…” | “…both public records list the same DOI; it does not prove collaboration, authorship roles or consent to this group…” | C1, C3 | fixed |
| F4 | `group.js` lede after loading a link | “…to see who has published together.” | “…to see which DOIs more than one record lists.” | C1 | fixed |
| F5 | `group.js` tab and SVG label | “Collaboration graph” | “Shared-DOI graph” | C1 | fixed |
| F6 | `group.js` edge detail | Names + list of DOIs, no rule stated | Adds: “Both public records list this DOI / these N DOIs. This is a shared DOI assertion, not verified collaboration.” | C1 | fixed |
| F7 | `group.js` “Links as a table” | Members + count only | Adds a **Supporting DOI(s)** column with every DOI linked to doi.org (screen-reader and no-SVG path now shows the evidence too) | C1 | fixed |
| F8 | `collaboration.py` graph `basis` (shown above the graph and in exports) | “Members are linked only when both public records assert the same DOI.” | Same rule + “A shared DOI is not verified collaboration, authorship roles or group membership.” | C1 | fixed |
| F9 | `web/network/app.js` feed view chip | “New on ORCID” | “Newly observed”, with helper text: “…your refresh first saw an output… It is not the publication date…” | C5 | fixed |
| F10 | `app.js` work card | “• Observed 2026-…” | “• First seen by your refresh 2026-…” (tooltip explains) next to “Publication date: …” | C5 | fixed |
| F11 | `app.js` since-last-visit banner | “N new since your last visit” | “N newly observed since your last visit” | C5 | fixed |
| F12 | `web/playground/digest.js` | Footnote already says “Observed… not its publication date” | — | C5 | ok |
| F13 | `web/playground/studio.js` Funder biosketch tab | “Pre-filled from asserted fields only. Review and complete before submitting.” | “Draft only… Not an official funder form or a funder-approved submission: review, complete and check the funder's current requirements…” | C4 | fixed |
| F14 | NIH / ERC / Horizon templates (CLI, Studio, team biosketch) | Only “Generated from the ORCID record …” | Adds a draft line: “not an official funder form, not a funder-approved submission and not independently verified…” | C4 | fixed |
| F15 | `web/playground/team.html` meta, eyebrow, lede, footer | “PRIVATE · MEMBERS ONLY”; “A private page for each team…”; footer states Firestore storage in the present tense | “IN DEVELOPMENT · NOT YET ENABLED ON THE PUBLIC SITE”; lede says “Planned…not confirmed active”; footer says “When Teams are activated…” and that sign-in does not verify affiliations | C2, C7 | fixed (page copy only) |
| F16 | Teams entry in the site navigation | `<a href="/team/">Teams</a>` on every page | Removed from the shared menu on every page and no longer linked from My Network; `/team/` stays reachable directly with an “Experimental: private cloud Teams are not available yet” notice and title (#54, PR #63, merged into `main` at `a5b1d58`) | C7 | **fixed on `main` by #54**; live deploy **unverified** |
| F17 | Homepage (`index.html`) footer | “optional Team cloud features, when activated, use a separate protected service.” | “…optional cloud Teams and account sync are not yet enabled on the public site and, if activated later, would store team data in a separate EU cloud database.” | C6, C7 | fixed |
| F18 | Homepage hero / two-track positioning | Single-task hero “Play with any public ORCID record.” | Two-track hero (Explore & Play / Connect & Organize) with plain-language notes: public records are assertions, local data stays in the browser by default, group roles are your own notes (#53, PR #62, merged into `main` at `e058cb2`); covered by `tests/test_claims.py` and `tests/test_homepage.py` | all | **fixed on `main` by #53**; live deploy **unverified** |
| F31 | Network page identity | Separate “Research, in good company / THE RESEARCH COMMONS / LOCAL PILOT” branding | SRP brand and shared menu; sidebar label “MY NETWORK · LOCAL PILOT”; title “My Network · Science Record Player” (#54, PR #63) | C8 | **fixed on `main` by #54**; live deploy **unverified** |
| F19 | `demo/contacts.mjs` caption + outro | “Everything stays private, in this browser. The people never see it.” · pill “never shared” · “Private to your browser.” | “Stored only in this browser unless you export a backup. Nobody is notified.” · “not sent anywhere” · “…backups you download contain these notes.” | C6 | fixed |
| F20 | `demo/groups.mjs` graph caption | “COLLABORATION GRAPH … co-asserted outputs, not proven collaboration.” | “SHARED-DOI GRAPH … both public records list the same DOI. Select it to see the DOIs. A shared DOI is not proof of collaboration.” | C1 | fixed |
| F21 | `demo/groups.mjs` shared outputs caption | “Every link cites its evidence.” | “Every link shows its shared DOI.” | C1 | fixed |
| F22 | `demo/groups.mjs` outro + `demo/README.md` long cut | “see who has published together” · pill “no server” | “see which DOIs members' public ORCID records share” · “browser-local” | C1, C6 | fixed |
| F23 | `demo/render.mjs` outro | “works offline after one visit · no server-side code.” | “works offline after one visit · Studio and the local network need no account.” | C6 | fixed |
| F24 | `docs/source/faq.md` | Question “Can we collaborate inside a private, **verified** team?” | “Is there a private cloud team workspace?” (answer already said not confirmed) | C2, C7 | fixed |
| F25 | `docs/source/groups.md` | “Collaboration graph” | “Shared-DOI graph (formerly ‘Collaboration graph’)” | C1 | fixed |
| F26 | `docs/source/trust.md` | Data-flow table lacked share links/snapshots; qualification dated 2 Nov | Rows for share links and embeddable snapshots; qualification refreshed and linked to this audit | C6, C7 | fixed |
| F27 | README “scientific boundaries”, `docs/source/index.md`, `studio.md`, `research-network.md`, `communications/launch-copy.md`, `video-storyboard.md`, `web/network/index.html` footer, `demo/full-tour.mjs` | Already scoped (“not independently verified”, “both public records list the same DOI”, “drafts”, “not yet confirmed active”) | Kept; launch copy and storyboard now point to the release checklist | all | ok |
| F28 | `docs/team-workspaces.md` “Proven identity grants access” | Design-doc wording about sign-in as the access key | Kept: it is an internal design principle and §Goal states sign-in proves account control only; not promotional copy | C2 | ok |
| F29 | `BACKLOG.md` KF-13 title “evidence-backed collaboration graph” | Historical backlog title | Kept as an append-only record; user-facing copy changed | C1 | ok |
| F30 | Sign-in (`auth.js`, `gcp-hosting.md`) | “ID token is verified” | Accurate: refers to the token signature, and docs say it does not verify credentials | C2 | ok |

### Exposure checks (exports and video capture)

| Path | Check | Result |
|---|---|---|
| Shareable Group view link | `group-link.js` encodes only `{name, members}` in the URL **fragment** (not sent to the host server); `group.html` disclosure box says so. | ok; `web/playground/group-link.test.mjs` (new) asserts the link holds only `n`/`m` in the fragment |
| Encrypted team package | `NetworkStore.export_group_package()` exports group name, description, members, roles/contributions (`member_details`), selections and requests plus members' public records — **no Contacts tags/notes/follow-ups**. Encryption: PBKDF2-SHA256 + AES-GCM-256 in the browser (`teampack.js`). | ok; `tests/test_contacts.py::test_contacts_are_private_to_the_workspace_not_shared_packs` |
| Workspace backup (`research-workspace-<date>.json`) | Contains **everything** in the local workspace, including Contacts notes, tags and follow-ups. Unencrypted. | Warned in UI, docs, trust page and `demo/extras.mjs` caption. Release checklist requires backup files not to appear on screen with real notes. |
| Video capture | `demo/*.mjs` render the built site on the labelled **Demo** workspace and stored maintainer profile; Group view uses synthetic “(Demo)” members (`demo/synthetic.mjs`). | ok by construction; **each rendered video must still be watched** before publication (checklist B). |
| Static group snapshots / `<srp-group>` | Public to anyone visiting the host page; contain only public-record derivatives. | Documented in `trust.md`; ok |

## 3. Privacy and availability matrix

“Repo” = what the code and tests show. “Production” = what is true on `https://science-record-player.web.app`; **unverified** means nobody has signed the release checklist for it yet.

| Feature | Where the data lives | Who can see it | Leaves the browser? | Available in repo | Production status |
|---|---|---|---|---|---|
| Studio (profile, record check, exports, cards) | Computed in the browser (Pyodide); downloads on your device | You | Live record read from `pub.orcid.org` on request; stored sample needs no request | yes | unverified at this audit (last recorded live check: INF-10, 31 Oct 2026, old hostname) |
| Research network: People, Feed, Saved, Groups | Browser IndexedDB (SQLite file), per browser profile | You, on that browser | Only ORCID public reads on import/refresh | yes | unverified at this audit |
| Contacts tags, notes, follow-ups | Same browser workspace | You | **No**, unless you download a backup | yes | unverified at this audit |
| Workspace backup | JSON file you download | Anyone you give the file to | Only if *you* send it | yes | unverified at this audit |
| Encrypted team package | Encrypted JSON file you download | Anyone with **both** the file and password | Only if you send it | yes | unverified at this audit |
| Shareable Group view link | URL fragment: group name + public iDs | Anyone with the link | The link itself, wherever you post it; recipients' browsers read public ORCID records | yes | unverified at this audit (last recorded: KF-13, 31 Oct 2026, old hostname) |
| Static group snapshot / web component | Files on the site where you publish them | Public | Yes, by design | yes | n/a (self-hosted by users) |
| Optional ORCID sign-in | Tab-scoped session state | You | ORCID authorization + ORCID public keys | yes | BACKLOG INF-11 records it live-verified on the old hostname; **unverified on the current hostname** in this audit |
| Cloud Teams and personal sync | Firestore `eur3` (EU), team access rules | Active team members (per `firestore.rules`) | Yes | code + rules + emulator tests | **Not available / unverified.** No menu entry since #54; `/team/` says “experimental, not available”. `docs/team-workspaces.md`: exchange function awaits Blaze and a live two-account test. Requires production verification **and** security review before any promotion (#22). |
| Python CLI / local SQLite pilot | Local files | You | Optional ORCID API calls | yes | n/a (local) |

There is **no “all private” promise** anywhere in the product: each surface states where its data lives. Regression tests (`tests/test_claims.py`) fail if the old wording returns.

## 4. Brand readiness against ORCID's written response (#44)

Source of truth: issue **#44** and `communications/branding-and-rename.md` (summary of ORCID's private written reply). This audit does not repeat #44's outreach.

| ORCID requirement (9 Nov 2026 reply, as summarised) | Repository state | Status |
|---|---|---|
| “ORCID” not the leading identifier in name or hostname | Name **Science Record Player (SRP)** from `config/brand.json`; hostname `science-record-player.web.app`; repository renamed | done in repo; name availability (EUIPO/INPI/USPTO, domains, PyPI, npm) **open** (owner) |
| Distinct visual identity | Pink/aubergine palette, new icon (INF-12) | done in repo |
| Prominent ownership line | Header on every hosted page (`tests/test_site.py`) | done in repo |
| Exact disclaimer, prominent | `config/brand.json` disclaimer on every page header, docs, README, video cards; `tests/test_site.py` + `tests/test_claims.py` | done in repo |
| ® attribution | Footers use “ORCID® is a registered trademark of ORCID, Inc.” | done in repo |
| Destination URLs | README, launch copy and docs link to `science-record-player.web.app`; old host disabled | done in repo; live link check **unverified** |
| ORCID review of the rebranded app | Next step 4 in `branding-and-rename.md` (“Reply to ORCID with the new link and screenshots”) has no recorded outcome; #44 is still **open** with unchecked boxes | **open — no approval exists** |

## 5. Launch decision

| Gate | State on 14 Nov 2026 | Blocks |
|---|---|---|
| #44 brand gate | **Open.** ORCID declined the old branding in writing; rebrand implemented; ORCID has **not** reviewed the rebranded app. No permission or endorsement may be stated or implied. | Broad marketing, the public video and any post that names ORCID beyond descriptive “works with public ORCID records” |
| #54 Teams nav entry and network branding | **Merged into `main`** (PR #63, `a5b1d58`): Teams removed from menus, `/team/` labelled experimental and not available, network page uses the SRP brand. Covered by `tests/test_navigation.py` and the CI `browser` job. **Not verified on the live deploy.** | Release A until the live site is checked (checklist A, Availability) |
| #53 homepage hero | **Merged into `main`** (PR #62, `e058cb2`). `tests/test_claims.py` and `tests/test_homepage.py` (incl. the CI `browser` job) pass on that commit. **Not verified on the live deploy.** | Release A until the live site is checked (checklist A, Claims) |
| #22 cloud Teams | Not production-verified; no security review recorded. | Any mention of cloud collaboration as available |
| #43 feedback | In-app feedback page exists (`/feedback/`); acceptance criteria (5 unaided testers, mobile E2E) open. | Claims that feedback is fully tested |
| Production verification of this release | Not done (audit environment blocked from the live host). | Both releases until checklist sections are signed |

**Decision:** *Private testing may continue. Public promotion (posts, video distribution, community announcement) is blocked* until every blocking row in [`release-checklist.md`](release-checklist.md) is signed with a deployment URL, commit SHA and date.

## 6. Automated regression assertions

`tests/test_claims.py` (runs in `pytest -q` and CI):

- forbidden phrases (“DOIs that prove”, “who has published together”, “New on ORCID”, unnegated “proof of collaboration”, “verified researcher/team/collaboration”, “fully private”, “no server-side code”, “never shared”) across hosted pages, scripts, README, Sphinx docs, demo overlays and posts;
- the Group view states the exact matching rule and shows supporting DOIs (edge detail and table column);
- `collaboration_graph()["basis"]` states the rule and the “not verified collaboration” limit;
- every funder template renders the draft disclaimer; Studio repeats it;
- the feed distinguishes “newly observed” from publication date;
- the Teams page says it is not enabled while `config.json` cloud settings are empty, and the trust page keeps the activation qualification;
- the built site carries the exact ORCID disclaimer on every hosted page;
- this audit and the release checklist exist, record #44 as open and contain no approval claim.

When Teams are activated in production, the Teams-copy assertions are expected to fail: update the copy, this audit and the checklist together after the verification and security review.
