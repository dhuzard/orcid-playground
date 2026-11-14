# Demo release checklist (#55)

This checklist **blocks publication**. A demo release may be announced, posted or distributed only when every **blocking** line of its section is ticked, and the sign-off table is filled in by a person who checked it on the deployed site. Agents may prepare evidence but **must not tick production checks or sign off** on behalf of the owner.

Two demo releases are covered:

- **Release A — hosted web demo** at the public URL (Studio, Research network sample workspace, Group view, docs, feedback).
- **Release B — demo video and posts** (full tour, teaser and clips from `demo/*.mjs`, LinkedIn/community copy in `launch-copy.md`).

Scientific rules and the current findings are in [`claims-privacy-audit.md`](claims-privacy-audit.md). Brand gate: issue **#44** and [`branding-and-rename.md`](branding-and-rename.md).

## Current state (14 Nov 2026)

| Gate | State |
|---|---|
| #44 ORCID brand review of the rebranded app | **Open — not approved.** ORCID declined the old branding (9 Nov 2026); no written review of Science Record Player yet. |
| #54 Teams nav entry hidden/gated | Merged into `main` (PR #63, `a5b1d58`); **not verified on the live deploy** |
| #53 homepage two-track hero | Merged into `main` (PR #62, `e058cb2`); repository claim tests (`tests/test_claims.py`, `tests/test_homepage.py`) pass on that commit; **not verified on the live deploy** |
| #55 claims audit, this checklist and `tests/test_claims.py` | Merged into `main` (PR #61, `d45e5fa`) |
| Latest `main` CI and hosting deploy workflow | Both green on `e058cb2` (CI run 43578095046, deploy run 43578095042). A green deploy workflow is **not** a live-site check: nobody has yet compared the deployed pages with this checklist |
| #22 cloud Teams production verification + security review | Not done |
| Release A sign-off | **Not signed** |
| Release B sign-off | **Not signed** |

**Publication status: BLOCKED.**

## Release A — hosted web demo

### Identity of what is released (blocking)

- [ ] Deployment URL tested: `https://science-record-player.web.app/` (write the exact URL tested, including any preview channel).
- [ ] Commit SHA deployed (full 40 characters) matches a commit on `main` that passed CI.
- [ ] Deploy workflow run ID recorded.
- [ ] Date and time of the check recorded (UTC).

### Claims (blocking)

- [ ] `python -m pytest -q` passes on that commit, including `tests/test_claims.py` and `tests/test_site.py`.
- [ ] Group view on the live site: graph tab is “Shared-DOI graph”; selecting a line shows “Both public records list…” and the DOI(s); the table has a “Supporting DOI(s)” column.
- [ ] Feed shows “Newly observed” and “First seen by your refresh” next to the publication date.
- [ ] Funder biosketch tab and downloaded templates show the draft disclaimer.
- [ ] Homepage two-track hero (#53, merged in PR #62) and navigation (#54, merged in PR #63) contain no “proof”, “verified researcher/team”, “all private” or “ORCID-approved” wording.
- [ ] Homepage: both paths (Explore & Play, Connect & Organize) are visible on first screen at desktop and 320/375px; “Open My Network →” opens `/network/#contacts` with no import, and “Try it with sample data” asks before adding the labelled Demo workspace; `?orcid=` only pre-fills the form and sends no ORCID request until Explore is pressed.
- [ ] Every page shows the exact disclaimer and the ownership line; footers use ®.

### Availability (blocking)

- [ ] **Teams is not reachable from public navigation**, or it shows a clear “not available” state (#54). `/team/` says “not enabled on this site yet” unless cloud Teams passed the next line.
- [ ] Cloud Teams/sync are advertised **only if** a live test with two real ORCID accounts passed (create, invite, accept, leave, delete) **and** a security review is recorded on #22. Otherwise they are absent from all copy.
- [ ] ORCID sign-in on the current hostname: tested live, or hidden. Record which.

### Sample data and privacy (blocking)

- [ ] Sample workspace (`/network/?sample=1`) shows the “Sample workspace … labeled Demo” banner and every sample person is marked Demo/fictional.
- [ ] The stored Studio profile is labelled “stored, offline”.
- [ ] No real contact notes, tags, follow-ups, team details, tokens or credentials appear in any committed file, sample data or screenshot.
- [ ] A downloaded workspace backup and an encrypted team package were inspected: the package has no Contacts data; the backup warning is shown.

### Brand (blocking for promotion, not for private testing)

- [ ] #44 has a recorded outcome for the rebranded app (written ORCID reply stored privately, required actions listed on #44), **or** the release is kept to private testing.
- [ ] No text states or implies ORCID permission, approval, partnership or endorsement.

### Sign-off — Release A

| Field | Value |
|---|---|
| Deployment URL tested | _unverified_ |
| Commit SHA | _unverified_ |
| Deploy run | _unverified_ |
| Date (UTC) | _unverified_ |
| #44 outcome | Open — no ORCID review of the rebrand |
| Checked by (owner) | _not signed_ |

## Release B — demo video and posts

### Identity (blocking)

- [ ] Rendered from the commit signed off in Release A (same SHA), using `video-demo.yml` or `demo/*.mjs` against the built site. Record the workflow run ID.
- [ ] The video description and post include the deployment URL, the commit SHA (short form is fine) and the recording date.

### Content (blocking)

- [ ] Watched end to end by a person. Every caption matches the UI at that commit.
- [ ] Captions keep the qualifications: public assertions not independently verified; shared DOI ≠ collaboration; roles and membership are local annotations; funder exports are drafts; “newly observed” ≠ publication date.
- [ ] Sample/fictional data is labelled on screen (“Demo” people, “(Demo)” group names, stored profile chip).
- [ ] No real contact notes, private team details, tokens, e-mail addresses or browser account chrome in any frame.
- [ ] **No unsupported feature is shown**: cloud Teams, personal sync and sign-in appear only if Release A recorded them as live-tested; otherwise they are absent (not “coming soon” in the main cut).
- [ ] Ends with the public URL, the repository and the in-app feedback page; every link resolves.

### Posts (blocking)

- [ ] Copy taken from `launch-copy.md` and checked against its “Scientific claims to avoid” list.
- [ ] Exact disclaimer and ® attribution included.
- [ ] #44 outcome allows public promotion under the current name. **While #44 is open, do not post or distribute.**

### Sign-off — Release B

| Field | Value |
|---|---|
| Video workflow run / files | _unverified_ |
| Commit SHA | _unverified_ |
| Recording date | _unverified_ |
| Watched by | _not signed_ |
| #44 outcome | Open — distribution blocked |
| Approved for publication (owner) | _not signed_ |
