# Backlog

Tracked feature backlog for `orcid-playground`. Every item has a stable ID, an
explicit status, and a revision history. Status changes are appended to the
[Change log](#change-log) at the bottom of this file rather than overwritten, so
the evolution of the backlog stays auditable in the same way generated outputs
are: **the git history is the record, this file is the index.**

## Conventions

| Field | Meaning |
|---|---|
| **ID** | Stable identifier. `KF-*` killer features, `FUN-*` playful reuses, `INF-*` infrastructure. IDs are never reused. |
| **Status** | `planned` → `in-progress` → `in-review` → `done`. Also `deferred` and `dropped`. |
| **Priority** | `P0` blocks adoption, `P1` high leverage, `P2` valuable, `P3` opportunistic. |
| **Owner** | Who is implementing. `—` when unclaimed. |
| **Files** | Primary files the item owns, to keep parallel work conflict-free. |

### Design rule (applies to every item)

> ORCID supplies structured assertions; the researcher controls narrative and
> selection.

No item may invent, infer, or rewrite a scientific credential. Enrichment from
non-ORCID sources must be labelled per field with its origin. Playful outputs
(`FUN-*`) are re-presentations of asserted facts only — they never fabricate.

---

## Summary

| ID | Title | Priority | Status | Owner |
|---|---|---|---|---|
| KF-01 | Complete the ORCID activities surface | P0 | done | agent/core-surface |
| KF-02 | Full work records via the bulk works endpoint | P0 | done | session |
| KF-03 | Citation and funder-format exporters | P0 | done | agent/exporters |
| KF-04 | Per-field enrichment with source labelling | P1 | planned | — |
| KF-05 | `lint` — ORCID record quality report | P1 | done | agent/lint |
| KF-06 | Assertion trust layer | P2 | planned | — |
| KF-07 | Lab / multi-researcher mode | P2 | planned | — |
| KF-08 | Change feed and publication Atom feed | P2 | planned | — |
| KF-09 | Agent-facing surface (MCP + well-known) | P2 | planned | — |
| KF-10 | Local research network pilot | P1 | in-review | session + subagents |
| KF-11 | Local working-group workflow | P1 | in-review | session + subagents |
| INF-01 | Fetch robustness, offline input, iD validation | P0 | done | session |
| INF-02 | CLI subcommand architecture | P0 | done | session |
| INF-03 | Verify shapes against a live ORCID record | P1 | in-progress | session |
| INF-04 | Regenerate published outputs for schema 0.2.0 | P1 | done | session |
| INF-05 | Enforce the biosketch contract | P0 | done | session |
| INF-06 | Harden the web component trust boundary | P1 | done | session |
| INF-07 | Cross-platform CLI and test correctness | P2 | done | session |
| FUN-01 | Academic Wrapped | P2 | done | agent/fun |
| FUN-02 | ORCID trading card | P3 | done | agent/fun |
| FUN-03 | Publication contribution heatmap | P3 | done | agent/fun |
| FUN-04 | Career sonification (MIDI) | P3 | planned | — |
| FUN-05 | Conference badge / vCard / email signature | P2 | planned | — |
| FUN-06 | `fortune` — a paper of your own in your shell | P3 | done | agent/fun |
| FUN-07 | Collaborator distance | P3 | deferred | — |
| FUN-08 | Deterministic career poster | P3 | deferred | — |
| FUN-09 | Academic family tree | P3 | deferred | — |
| KF-12 | Roster assertion export contract (#9) | P1 | in-review | session |
| INF-08 | Static public showcase hosted on GCP | P2 | done | session |
| INF-10 | Hosted in-browser playground (Studio + research network) | P1 | done | session |
| INF-11 | ORCID sign-in on the hosted playground, verified live | P2 | planned | — |
| KF-13 | Shareable group links and evidence-backed collaboration graph (#15) | P1 | done | session |
| KF-14 | Group record health and team biosketch for funders (#15 phase 2) | P1 | done | session |
| KF-15 | Group Wrapped, card deck, <orcid-group> widget, offline app and digest (#15 phase 3) | P2 | done | session |
| INF-09 | Hosted multi-researcher service on Cloud Run | P2 | planned | — |
| KF-16 | Personal saving and encrypted team packages | P1 | in-review | session |

---

## KF-01 — Complete the ORCID activities surface

- **Priority** P0 · **Status** done · **Owner** agent/core-surface · **Rev** r4
- **Files** `src/orcid_biosketch/core.py`, `schema/biosketch.schema.json`, `tests/`

`build_biosketch` currently reads only `person`, `employments`, `educations` and
`works` from `activities-summary`. The remaining sections are dropped entirely.
Funding and service are what make a document a *biosketch* rather than a
publication list — no funder template can be filled without them.

**Acceptance criteria**
- [x] Parse `fundings`, `peer-reviews`, `distinctions`, `memberships`,
      `services`, `qualifications`, `invited-positions`, `research-resources`.
- [x] `_affiliations()` generalised across the five affiliation-shaped sections.
- [x] Funding retains amount, funder, grant number and external IDs.
- [x] Peer review aggregated per reviewer group with review counts.
- [x] Schema updated; every new section documented and validated.
- [x] Markdown and JSON-LD renderers surface the new sections.
- [x] Markdown coverage for `qualifications`, `invited_positions` and
      `research_resources` (`test_markdown_renders_qualifications_invited_positions_and_resources`).
- [x] Sections absent from a record degrade to empty lists, never `KeyError`.

**Notes** — Peer review is the only machine-readable record of academic
invisible labour that exists anywhere. Surface it prominently.

Landed in `1c04d87`. Peer review nests two levels deep
(`peer-reviews.group[].peer-review-group[].peer-review-summary[]`), unlike
works or affiliations; `research-resource-summary` wraps its content in a
`proposal` object. Both are handled with a fallback to the flatter shape.
**Caveat:** `pub.orcid.org` is unreachable from the build environment, so
the fixture was written from the documented v3.0 schemas and not verified
against a live record — see INF-03.

---

## KF-02 — Full work records via the bulk works endpoint

- **Priority** P0 · **Status** done · **Owner** session · **Rev** r3
- **Files** `src/orcid_biosketch/core.py`
- **Blocked by** INF-01 (retry/backoff needed before multi-request fetching)

`_works()` reads work-summary groups only, so outputs contain **no authors**. A
biosketch whose publications have no author list cannot be pasted into a CV.
`GET /v3.0/{id}/works/{putcodes}` accepts up to 100 comma-separated put-codes
per request and returns contributors, abstract and language.

**Acceptance criteria**
- [x] Batch put-codes 100 at a time; whole record in a small number of requests.
- [x] Contributors normalised to ordered author lists with roles and ORCID iDs.
- [x] Opt-out flag for callers who want the cheap summary-only fetch.
- [x] Degrades to summary data when the detail fetch fails.
- [x] Fetch funding amounts per preferred put-code. Live verification confirmed
      `funding-summary` omits `amount` while `/funding/{put-code}` supplies it.
- [x] Retain every assertion source in a work group so `lint` never mistakes a
      preferred self-assertion for the only assertion.

---

## KF-03 — Citation and funder-format exporters

- **Priority** P0 · **Status** done · **Owner** agent/exporters · **Rev** r4
- **Files** `src/orcid_biosketch/exporters.py` (new), `tests/test_exporters.py`

`render_markdown` is the only renderer. The adoption argument is not "a nicer
web page" — it is removing four hours of formatting the night before a grant
deadline.

**Acceptance criteria**
- [x] CSL-JSON export, valid against the CSL-JSON item schema.
- [x] BibTeX export with stable, collision-free citation keys and correct escaping.
- [x] RIS export.
- [x] Funder templates (NIH, ERC, Horizon) as data files, not hardcoded, so a
      new format arrives as a contributed template rather than a code change.
- [x] Every exporter is a pure function of the biosketch contract.

**Notes** — CSL type is the single source of truth; BibTeX and RIS map off it.
The template mini-language builds loop scopes from every list-of-dict section in
the contract, so KF-01's new sections render with no code change and a new funder
format really is just a new `.md` file. Authors light up automatically if KF-02
adds them. Wheel build confirmed the templates ship as package data, so no
`pyproject.toml` change was needed.

---

## KF-04 — Per-field enrichment with source labelling

- **Priority** P1 · **Status** planned · **Owner** — · **Rev** r1
- **Files** `src/orcid_biosketch/enrich.py` (new)

Enrichment from OpenAlex/Crossref/DataCite, labelled **per field** rather than
per record, so that ORCID-asserted and externally-derived values remain
distinguishable in the output. This is what keeps the design rule intact once
external data enters the pipeline.

**Acceptance criteria**
- [ ] Each enriched value carries its originating source.
- [ ] An ORCID assertion is never overwritten by an external source.
- [ ] Citation counts, open-access status and venue metadata.
- [ ] Retraction check against Crossref / Retraction Watch, surfaced loudly.
- [ ] Fully optional; the tool works offline without it.

---

## KF-05 — `lint`: ORCID record quality report

- **Priority** P1 · **Status** done · **Owner** agent/lint · **Rev** r4
- **Files** `src/orcid_biosketch/lint.py` (new), `tests/test_lint.py`

Score a record and say exactly what to fix. The only item here with standalone
reach: useful to people who will never generate a biosketch, which is precisely
what draws them into the rest of the tool.

**Acceptance criteria**
- [x] Checks: missing DOIs, missing publication dates, missing venue, empty
      biography, no keywords, no funding, orgs lacking ROR/disambiguation,
      self-asserted-only works, duplicate work groups, stale record.
- [x] Weighted score with a documented, reproducible rubric.
- [x] Human-readable report and machine-readable JSON.
- [x] shields.io-compatible badge endpoint JSON for READMEs.
- [x] Non-zero exit under a configurable threshold, for CI use
      (`lint --fail-under N`, landed with INF-02).
- [x] A record with no works cannot earn a passing grade or badge.
- [x] `works.self_asserted` considers every source retained from the ORCID work
      group, not only the preferred summary.

---

**Notes** — Scoring is out of 100 weights, but a check the contract cannot
express is marked not-applicable and subtracted from `max_score` as well as
`score`, so a percentage is never diluted by something unmeasurable. The ROR
check is n/a today because `_affiliations()` emits no organisation identifier;
it lights up on its own once one appears. Duplicate detection is a union-find
over both normalised titles and DOIs, so a manual entry and its Crossref twin
collapse into one group even when only one copy carries the DOI.

Against the committed `generated/biosketch.json`: **86% (B)**, 4 duplicate
groups, 10 self-asserted works, no funding recorded.

---

## KF-06 — Assertion trust layer

- **Priority** P2 · **Status** planned · **Owner** — · **Rev** r1
- **Files** `src/orcid_biosketch/core.py`, `web/orcid-biosketch.js`

`_source()` already captures who asserted each work and nothing downstream uses
it. Render the distinction between self-asserted and publisher/institution-
asserted claims. Near-zero cost, and consistent with the provenance thesis.

**Acceptance criteria**
- [ ] Each work classified `self-asserted` / `third-party-asserted`.
- [ ] Trust marker rendered in the web component and the PDF export.
- [ ] Classification logic documented and covered by tests.

---

## KF-07 — Lab / multi-researcher mode

- **Priority** P2 · **Status** planned · **Owner** — · **Rev** r1

One config, N ORCIDs → a team page with deduplicated shared publications and a
collaboration graph. Institutes and labs are the adoption unit; individuals are
a one-person market.

The local roster and shared-output experiment is tracked separately in KF-10
and [epic #6](https://github.com/dhuzard/orcid-playground/issues/6). It does not
complete the configuration, published team page, or approved synchronization
requirements of this item.

**Acceptance criteria**
- [ ] Config accepts a list of ORCID iDs with per-member overrides.
- [ ] Shared publications deduplicated by DOI across members.
- [ ] Team-level JSON contract and web component mode.
- [ ] Sync workflow handles N records within API rate limits.

---

## KF-08 — Change feed and publication Atom feed

- **Priority** P2 · **Status** planned · **Owner** — · **Rev** r1

The README's pitch is that git commits create an auditable history, but nothing
reads that history back. Render it, and the repository becomes subscribable.

KF-10 pilots an in-app change feed from manual refreshes. Atom publication and
git-derived changelogs remain planned here.

**Acceptance criteria**
- [ ] `CHANGELOG.md` generated from the diff between syncs.
- [ ] Atom feed of new publications.
- [ ] Sync workflow publishes both.

---

## KF-09 — Agent-facing surface

- **Priority** P2 · **Status** planned · **Owner** — · **Rev** r1

An MCP server exposing the biosketch as tools, plus
`/.well-known/researcher.jsonld` and `llms.txt`. The step from
machine-*readable* to machine-*actionable*.

**Acceptance criteria**
- [ ] MCP server with `get_works`, `get_funding`, `find_expertise`.
- [ ] Well-known JSON-LD document emitted alongside generated outputs.
- [ ] `llms.txt` summarising the record for agent consumption.

---

## KF-10 — Local research network pilot

- **Priority** P1 · **Status** in-review · **Owner** session + subagents · **Rev** r2
- **Epic** [#6](https://github.com/dhuzard/orcid-playground/issues/6)
- **Files** `src/orcid_biosketch/network.py`, `src/orcid_biosketch/network_store.py`,
  network UI assets, network tests, `docs/network-api.md`, `docs/network-pilot.md`

Test the smallest useful research network in one local workspace: follow public
ORCID records, read changes, save outputs, and prepare a working-group team pack.
Manual imports establish a baseline; subsequent manual refreshes surface newly
observed works without presenting old publications as newly published.

**Acceptance criteria**

- [x] Loopback-only server launches with a persistent local data path.
- [x] Feed, People, Groups, and Saved support the five-minute pilot script.
- [x] Explicitly loaded sample data are labelled and work offline.
- [x] Public ORCID import, manual refresh, follow/unfollow, and saving persist.
- [x] Initial imports produce no misleading historical feed flood; repeat
      refreshes do not duplicate unchanged events.
- [x] Shared DOI works are deduplicated with all researcher associations retained.
- [x] Group creation and roster editing produce a downloadable team pack.
- [x] UI and exports identify rosters as unconfirmed and member outputs as
      distinct from project-attributed outputs.
- [x] Boundary, persistence, baseline/change, deduplication, and export checks pass.
- [ ] One real working-group coordinator completes the pilot and records feedback.

Project-output curation and local coordination are tracked in KF-11.
OAuth, shared accounts, invitations, public hosting, announcements, digests,
and automatic monitoring remain follow-up scope. Resolve
ORCID API access terms before introducing unattended monitoring. Pilot runbook:
[docs/network-pilot.md](docs/network-pilot.md).

---

## KF-11 — Local working-group workflow

- **Priority** P1 · **Status** in-review · **Owner** session + subagents · **Rev** r2
- **Milestone** [#8](https://github.com/dhuzard/orcid-playground/issues/8), under epic #6
- **Files** network model/server/UI, network tests, `docs/group-workflow-api.md`, pilot runbook

Help one coordinator prepare a real working-group deliverable from a supplied
ORCID roster in the existing local workspace. Keep local curation distinct from
researcher-confirmed membership, credentials, and project attribution.

**Acceptance criteria**

- [x] Paste and preview a bulk ORCID roster; import explicitly with per-record
      results, cancellation between records, and retries preserving successes.
- [x] Append people to existing groups without overwriting roster metadata.
- [x] Persist local roles, expertise, and contributions for current members.
- [x] Separate suggested member outputs from locally selected project outputs.
- [x] Track requests with optional owners/deadlines and resolve/reopen actions.
- [x] Export selected members and publication-date ranges, with project/member
      output scope applied consistently to bibliography and biosketches.
- [x] Explain partial-date filtering, excluded undated outputs, and unconfirmed
      attribution in the exported manifest.
- [x] Preserve old workspaces and verify request, roster, selection, and export
      boundaries with persistence and browser checks.
- [ ] One coordinator prepares a real team report and records time and corrections.

No hosted accounts, OAuth, invitations, notifications, or public membership
claims in this milestone. Shared access and confirmed membership follow the
local test. Personal test rosters and workspace data stay outside tracked files.

---

## INF-01 — Fetch robustness, offline input, iD validation

- **Priority** P0 · **Status** done · **Owner** session · **Rev** r3
- **Files** `src/orcid_biosketch/core.py`, `src/orcid_biosketch/cli.py`

`fetch_orcid_record` has no retries, no caching and no rate-limit handling. The
CLI cannot read a saved record from disk — the test suite can, via
`tests/fixture.json`, but users cannot. A mistyped iD becomes a confusing HTTP
error rather than a clear message.

**Acceptance criteria**
- [x] MOD 11-2 checksum validation of ORCID iDs with a clear error.
- [x] `--record FILE` for offline and CI runs.
- [x] Retry with exponential backoff; explicit rate-limit handling.
- [x] ORCID sandbox base URL supported for contributor testing.
- [x] Network failures produce actionable messages, not tracebacks.

**Notes** — `normalize_orcid()` runs before any network call, so a typo fails
instantly with a readable message instead of a 404. 404/401/403 are permanent
and never retried; 429 and 5xx back off exponentially and honour `Retry-After`.
`OrcidError` replaces raw `HTTPError`/`URLError` tracebacks at the boundary.

---

## INF-02 — CLI subcommand architecture

- **Priority** P0 · **Status** done · **Owner** session · **Rev** r3
- **Files** `src/orcid_biosketch/cli.py`

The CLI is a single flat command. Every feature above needs a verb.

**Acceptance criteria**
- [x] Subcommands: `generate`, `lint`, `export`, `wrapped`, `fortune`, `badge`.
- [x] `orcid-biosketch <ORCID>` keeps working unchanged (back-compat).
- [x] Shared options factored into a common parent parser.

---

## FUN-01 — Academic Wrapped

- **Priority** P2 · **Status** done · **Owner** agent/fun · **Rev** r4
- **Files** `src/orcid_biosketch/fun.py` (new)

Spotify-style year in review: top venue, most prolific month, longest gap,
keyword drift, co-authors met for the first time. Highest shareability per line
of code in the entire backlog. Ship in December.

**Acceptance criteria**
- [x] Terminal, JSON and shareable-card outputs.
- [x] Every statistic derived from asserted data; nothing invented.
- [x] Graceful with sparse records — a two-paper year still produces something
      kind rather than something bleak.

---

**Notes** — The card discloses its own method (gaps in months, year-only dates
counted as January, undated outputs named and excluded) so no figure is mistaken
for a claim the record does not support. Sparse years render factually, without
commentary on productivity.

---

## FUN-02 — ORCID trading card

- **Priority** P3 · **Status** done · **Owner** agent/fun · **Rev** r5

A printable stat card: years active as HP, output count as attack, a "special
ability" drawn from the record's own keywords. QR to the ORCID record.

**Acceptance criteria**
- [x] Self-contained SVG, print-ready, no external assets.
- [x] Stats traceable to record fields.
- [x] Optionally embed the record holder's official ORCID QR-code PNG without
      modifying its pixels; the published card uses Damien's supplied asset.

---

## FUN-03 — Publication contribution heatmap

- **Priority** P3 · **Status** done · **Owner** agent/fun · **Rev** r4

The GitHub green-squares grid for publication dates. Instantly legible, and
quietly humane: it shows the fallow years that polished CVs hide.

**Acceptance criteria**
- [x] Self-contained SVG, readable in light and dark contexts.
- [x] Sensible with decade-spanning records.
- [x] Include every year between the first and last dated output, including
      zero-output years.

---

## FUN-04 — Career sonification

- **Priority** P3 · **Status** planned · **Owner** — · **Rev** r1

Publication dates to notes, venues to instruments, output counts to velocity;
emit a MIDI file. "Here is what my postdoc sounds like."

**Acceptance criteria**
- [ ] Standard MIDI written from the standard library, no dependencies.
- [ ] Deterministic: the same record always yields the same file.

---

## FUN-05 — Conference badge, vCard and email signature

- **Priority** P2 · **Status** planned · **Owner** — · **Rev** r1

Boring-useful disguised as fun, and the item people would use weekly: A6 badge
with QR and top outputs, a vCard, and an HTML email signature.

**Acceptance criteria**
- [ ] Print-ready badge at A6; QR generated without a runtime dependency.
- [ ] Valid vCard 4.0 including the ORCID iD.

---

## FUN-06 — `fortune`

- **Priority** P3 · **Status** done · **Owner** agent/fun · **Rev** r4

Print a random one of your own paper titles in your shell. Twenty lines, pure
joy.

**Acceptance criteria**
- [x] Reads a generated biosketch; no network access at call time.
- [x] Fast enough for a shell startup file.

---

## FUN-07 — Collaborator distance · deferred

Erdős-number-style distance between two ORCID iDs via OpenAlex coauthorship.
**Deferred**: depends on KF-04's enrichment client.

## FUN-08 — Deterministic career poster · deferred

Generative art seeded from the ORCID digits and work titles; the same iD always
yields the same artwork. **Deferred**: no dependency, purely a question of
sequencing after the P0/P1 work.

## FUN-09 — Academic family tree · deferred

Chain `educations` across ORCID iDs to reconstruct advisor lineages.
**Deferred**: needs KF-07's multi-record fetching.

---

## INF-03 — Verify normalized shapes against a live ORCID record

- **Priority** P1 · **Status** planned · **Owner** — · **Rev** r1
- **Files** `tests/fixture.json`, `tests/test_core.py`

`pub.orcid.org:443` is refused by the egress proxy in the environment where
KF-01 was implemented (`CONNECT tunnel failed, 403` — a network policy denial,
not a TLS or credential problem). The KF-01 fixture is therefore derived from
ORCID's documented v3.0 schemas rather than from a real response. The parsers
are defensive and degrade to empty lists, so a shape mismatch would silently
produce empty sections rather than an error — which is exactly the failure mode
worth closing.

The 2026-09-01 review environment could reach the public API and verified the
record, work-summary, bulk-work contributor, funding-summary, and full funding
shapes. Peer-review, service, and research-resource live-shape verification
remains.

**Acceptance criteria**
- [ ] Fetch a real public record containing funding, peer review, service and
      research-resource entries from a host with ORCID egress allowed.
- [ ] Diff the live shapes against `tests/fixture.json`; correct any divergence.
- [x] Confirm whether `funding-summary` carries `amount` (feeds KF-02): it does
      not; the full funding endpoint returned `57000.0 EUR` for the live record.
- [ ] Consider a slow-marked integration test, skipped when ORCID is unreachable.

---

## INF-04 — Regenerate published outputs for schema 0.2.0

- **Priority** P1 · **Status** done · **Owner** session · **Rev** r2
- **Files** `generated/`

KF-01 raised the contract to `schema_version` 0.2.0, but `generated/biosketch.json`
in the repository still declares 0.1.0 and lacks the new sections. Anyone
validating the *published* artifact against the *published* schema therefore
fails until the outputs are regenerated. This could not be fixed in the branch:
regeneration needs a live ORCID fetch, and `pub.orcid.org` is unreachable from
the build environment (INF-03).

**Acceptance criteria**
- [x] Regenerate `generated/` from the live public record on schema 0.2.0.
- [x] Confirm the rebuilt `biosketch.json` validates against the 0.2.0 schema.
- [x] Confirm the web component accepts the regenerated artifact in its test.

---

## INF-05 — Enforce the biosketch contract

- **Priority** P0 · **Status** done · **Owner** session · **Rev** r2
- **Files** `schema/biosketch.schema.json`, `tests/test_core.py`

The published schema currently validates malformed list entries and untyped
provenance values that crash or mislead downstream consumers. The schema is a
runtime integration boundary, not only documentation, and must reject documents
that the Python renderers and web component cannot consume.

**Acceptance criteria**
- [x] Define reusable schemas for dates, sources, affiliations, works and
      provenance rather than unconstrained arrays.
- [x] Reject null/scalar entries in every structured section.
- [x] Validate URI-bearing fields and required work fields.
- [x] Keep researcher-controlled extension fields possible where documented.

---

## INF-06 — Harden the web component trust boundary

- **Priority** P1 · **Status** done · **Owner** session · **Rev** r2
- **Files** `web/orcid-biosketch.js`, `tests/`

The component can load remote researcher-controlled JSON but currently assigns
record URLs directly to anchors. It also assumes that shallowly validated work
entries are objects. Treat loaded JSON as untrusted input even when it claims to
follow the biosketch schema.

**Acceptance criteria**
- [x] Only `http:` and `https:` URLs become clickable links.
- [x] Invalid work entries cannot crash rendering or PDF export.
- [x] Attribute changes cannot let a stale fetch overwrite a newer `src`.
- [x] Add browser-facing regression tests or a deterministic testable helper.

---

## INF-07 — Cross-platform CLI and test correctness

- **Priority** P2 · **Status** done · **Owner** session · **Rev** r2
- **Files** `src/orcid_biosketch/cli.py`, `src/orcid_biosketch/core.py`,
  `tests/`, `.github/workflows/ci.yml`

The review found several platform and command-path inconsistencies: fixtures use
the process default encoding, custom template paths are accepted by the library
but rejected by the CLI, and missing affiliation dates are rendered as
`present`. These are small defects with visible user-facing consequences.

**Acceptance criteria**
- [x] All repository text fixtures are read explicitly as UTF-8.
- [x] CI covers Windows as well as Linux.
- [x] The CLI accepts custom template file paths supported by the exporter.
- [x] Missing start and end dates render no period; no output invents `present`.
- [x] `Retry-After: 0` and HTTP-date values are honoured correctly.

---

## INF-08 — Static public showcase hosted on GCP

- **Priority** P2 · **Status** done · **Owner** session · **Rev** r3
- **Files** `docs/gcp-hosting.md`, `scripts/build_site.py`, `firebase.json`, `.github/workflows/deploy-hosting.yml`

Deployed to Firebase Hosting project `orcid-playground-889` (preview channel) by
workflow run 41071880181 on 2026-10-30. Superseded in scope by INF-10. See
[docs/gcp-hosting.md](docs/gcp-hosting.md).

**Acceptance criteria**
- [x] Site contains only `generated/` and `web/` outputs (`tests/test_site.py`).
- [x] Deploy workflow uses Workload Identity Federation, no stored keys.
- [x] The network pilot (PR #7) is not exposed publicly.
- [x] GCP project, WIF and repository variables created; preview channel URL shared (run 41071880181).

---

## INF-10 — Hosted in-browser playground

- **Priority** P1 · **Status** done · **Owner** session · **Rev** r2
- **Files** `web/playground/`, `src/orcid_biosketch/playground.py`, `src/orcid_biosketch/network.py`,
  `scripts/build_site.py`, `firebase.json`, `tests/test_playground.py`, `tests/test_site.py`

Anyone can explore any public ORCID record and the multi-ORCID research network
without a server: the package runs under Pyodide in a Web Worker, the network
workspace is kept in the visitor's IndexedDB, and the pilot's routes are shared
with the loopback server through `network.dispatch`. Optional ORCID sign-in uses
the OpenID Connect implicit flow and verifies the ID token in the browser.

**Acceptance criteria**
- [x] Studio renders every single-record output from a typed iD or the stored sample (`tests/test_playground.py`; headless Chrome against Firebase headers).
- [x] The unchanged pilot app runs on the browser engine; workspace persists across reloads; team pack ZIP downloads (headless Chrome).
- [x] No server-side state; network data never leaves the browser; strict CSP without `unsafe-eval`.
- [x] Loopback server behaviour unchanged (`tests/test_network_http.py`, `tests/test_group_http.py`).
- [x] Audit fixes: live channel only from `main`; cross-tab Web Lock prevents workspace overwrites; links ask before importing; engine recovers from a failed start (headless Chrome: two tabs, blocked runtime).
- [ ] ~~ORCID sign-in verified live~~ moved to INF-11; the sign-in code ships but stays hidden until a client is registered.
- [x] Pyodide served from the site with pinned SHA-256 hashes; CSP has no third-party origin (`tests/test_site.py`, #14).
- [x] Promoted to the live channel after review. Live at https://orcid-playground-889.web.app (live deploy run 41182335060, 2026-10-31, from `main` at c1150e4 after #16, #17 and #18). Headless Chrome on the live site: Studio (stored sample A 94%, live record, checksum error), network (sample, Studio handoff, persistence, team pack ZIP), two tabs without overwrites, service worker installed with site and runtime caches.

---

## KF-13 — Shareable group links and collaboration graph

- **Priority** P1 · **Status** done · **Owner** session · **Rev** r2
- **Files** `src/orcid_biosketch/collaboration.py`, `web/playground/group.html`, `web/playground/group.js`,
  `web/playground/group-link.js`, `tests/test_collaboration.py`

Phase 1 of issue #15. A group link holds only a name and public ORCID iDs in the
URL fragment. Records are read on request, and two members are linked only when
both records assert the same DOI, with those DOIs listed on the link.

**Acceptance criteria**
- [x] Edges only from DOIs asserted by both records; none from titles or names (`tests/test_collaboration.py`).
- [x] The link discloses exactly what it contains; roles, contributions and requests are never included; sample people are excluded.
- [x] Records are read only on request, per member, with retry; nothing is stored unless the visitor copies the group into their network (confirmed).
- [x] Untrusted names render as text in the graph and lists (headless Chrome with an injection payload).
- [x] Live at https://orcid-playground-889.web.app (live deploy run 41182335060, 2026-10-31, from `main` at c1150e4 after #16, #17 and #18). Verified on the live site: compose, preview, read two records, graph and shared outputs, copy into the network, and Share & visualise reproducing the same link (#15 closed).

---

## KF-14 — Group record health and team biosketch

- **Priority** P1 · **Status** done · **Owner** session · **Rev** r2
- **Files** `src/orcid_biosketch/team.py`, `web/playground/group.js`, `tests/test_team.py`

Phase 2 of issue #15, in the group view. Record health re-expresses each member's
record check, ranks issues by how many members share them and gives the fix each
member makes in their own ORCID record. The team biosketch nests every member's
ERC/Horizon/NIH template under a team summary whose joint outputs are DOIs found
in several members' records.

**Acceptance criteria**
- [x] Group score is the mean of members' record checks; issues are ranked by members affected, each with its fix (`tests/test_team.py`).
- [x] Every record check has a plain-language label (`test_every_record_check_has_a_plain_language_label`).
- [x] Team biosketch keeps each member's provenance line, lists only DOI-backed joint outputs and states that membership is unconfirmed.
- [x] Both render and download in headless Chrome against live records.
- [x] Live at https://orcid-playground-889.web.app (live deploy run 41182335060, 2026-10-31, from `main` at c1150e4 after #16, #17 and #18). Verified on the live site: record health B 84% with 9 issues for the two test records, team biosketch in ERC and NIH, downloads.

---

## KF-15 — Group Wrapped, card deck, embeddable widget, offline app, digest

- **Priority** P2 · **Status** done · **Owner** session · **Rev** r2
- **Files** `src/orcid_biosketch/team.py`, `web/orcid-group.js`, `web/playground/sw.js`, `web/playground/digest.js`,
  `web/playground/manifest.webmanifest`, `web/playground/group.js`, `web/playground/network-bridge.js`

Phase 3 of issue #15.

**Acceptance criteria**
- [x] Group Wrapped merges outputs by DOI, counts each member for the same year and lists only DOI-backed joint outputs (`tests/test_team.py`).
- [x] Card deck: one card per member from that member's record only; printable and downloadable as a ZIP.
- [x] `<orcid-group>` renders a static `orcid-group-snapshot/1` file as text only, with http(s) links only (`web/orcid-group.test.mjs`); verified embedded from another origin.
- [x] Installable and offline after one visit: Studio and network run with the server stopped (headless Chrome); the ORCID API is never cached.
- [x] Explicit "Refresh followed records" and a "what's new since your last visit" Markdown digest (`web/playground/digest.test.mjs`).
- [x] Live at https://orcid-playground-889.web.app (live deploy run 41182335060, 2026-10-31, from `main` at c1150e4 after #16, #17 and #18). Verified on the live site: Wrapped, card deck (2 cards and ZIP), embed preview, `<orcid-group>` loaded from another origin (40 works, 2 members, search), refresh followed and digest, service worker caches. Offline use was proven against a local build with the server stopped; it was not repeated on the live domain.

---

## INF-11 — ORCID sign-in verified live

- **Priority** P2 · **Status** planned · **Owner** — · **Rev** r1
- **Files** `web/playground/auth.js`, `docs/gcp-hosting.md`

Split from INF-10. The OpenID Connect sign-in code is live but hidden because
`config.json` carries no client id (issue #14).

Readiness (not live verification): the authorize request now uses
`response_type=id_token token`, the only implicit response type both documented
by ORCID and listed in its discovery document; `web/playground/auth.test.mjs`
covers token verification offline; `docs/gcp-hosting.md` has the registration
steps and the live test checklist.

**Acceptance criteria**
- [ ] ORCID Public API client registered with redirect URI `https://orcid-playground-889.web.app/`.
- [ ] `ORCID_CLIENT_ID` repository variable set and the site redeployed to live.
- [ ] Sign-in, ID-token verification and sign-out tested on the live site.

---

## INF-09 — Hosted multi-researcher service on Cloud Run

- **Priority** P2 · **Status** planned · **Owner** — · **Rev** r1
- **Files** `docs/gcp-hosting.md`

Blocked on PR #7 and issue #6's shared-service milestone. The pilot refuses non-loopback binding by design.

**Acceptance criteria**
- [ ] ORCID OAuth sign-in and per-user workspace isolation.
- [ ] Managed EU storage replaces SQLite.
- [ ] Tests prove unauthenticated requests are refused.
- [ ] Rosters never reach public outputs.

---

## KF-12 — Roster assertion export contract

- **Priority** P1 · **Status** in-review · **Owner** session · **Rev** r1
- **Files** `schema/roster-assertion.schema.json`, `src/orcid_biosketch/roster.py`,
  `tests/test_roster.py`, `tests/fixtures/roster/`, `docs/roster-assertions.md`

Issue #9, coordinated with dhuzard/oratlas#207. A researcher-controlled, opt-in
export of a local working group as asserted identifiers for ORAtlas and
Diggypaper. It is inert: an ORCID iD, roster entry or recorded contribution
never grants access, confirms an invitation, implies authorship or confirms a
CRediT role. Wiring it into private production workflows waits for
dhuzard/oratlas#202.

**Acceptance criteria**
- [x] Versioned JSON Schema with fixed `access_effect`, consent, redaction and digest.
- [x] Public-record, curator and external-verified assertions, claimed vs OAuth-verified
      iDs and listed vs verified membership stay distinct; an offline roster cannot
      claim the verified forms.
- [x] CRediT roles only `source-declared` (with reference) or `curator-confirmed`; never inferred.
- [x] Private members, unselected or unsupported-rights outputs and unapproved project
      URLs are excluded; only the iD is shared by default.
- [x] Revocation yields a content-free notice; deterministic SHA-256 digest.
- [x] Synthetic demo export and its expected consumer reading, with tests for forged and
      checksum-invalid iDs, private members, revoked consent, duplicates, unverified
      entries, unsupported rights and selective export.
- [ ] Adapter from the network pilot workspace (PR #7) to the builder input.
- [ ] Integration into private workflows, after dhuzard/oratlas#202 is approved.

---

## KF-16 — Personal saving and encrypted team packages

- **Priority** P1 · **Status** in-review · **Owner** session · **Rev** r1
- **Files** `src/orcid_biosketch/network_store.py`, `src/orcid_biosketch/playground.py`,
  `web/playground/teampack.js`, `web/playground/network-bridge.js`, `web/playground/studio.js`,
  `web/playground/group.js`, `web/playground/engine.js`, `tests/test_workspace_backup.py`,
  `web/playground/teampack.test.mjs`

Track 1 of saving without a server. Everything stays in the visitor's browser
until they save a file; nothing is uploaded and no new origin is contacted.

**Acceptance criteria**
- [x] "Download my workspace" saves a versioned `orcid-playground-workspace` v1 file; "Restore from file"
      validates strictly (unknown versions, unexpected fields, forged or mismatched iDs, outsiders in groups,
      bad dates or roles are refused), confirms that it replaces this browser's workspace, then writes it in
      one transaction (`tests/test_workspace_backup.py`: round trip, rejections, no partial write on failure).
- [x] Studio "Me" panel when signed in: my record check grade with one-click open, "Follow me in my network",
      and the network groups that list my iD, read only from this browser.
- [x] Encrypted team package: a group with its members' records and local roles, expertise, contributions,
      selections and requests, encrypted in the browser (PBKDF2-SHA256, 310000 iterations, 16-byte salt;
      AES-GCM-256, 12-byte IV; header authenticated). Import asks for the password, previews exactly what
      will be added, then adds it as a new group; local copies of known people are kept
      (`web/playground/teampack.test.mjs`: round trip, wrong password, tampering).
- [x] Disclosure wherever data leaves the browser: what the file contains, who can read it, membership unconfirmed.
- [x] Headless Chrome under the Firebase headers: backup, bad file refused, clear and restore; package export,
      wrong password, preview rendering untrusted text as text, import; Me panel follow, groups and grade.
- [ ] Merged and verified on the live site.

---

## Change log

Append-only. Newest entries at the bottom. One line per status or scope change.

| Date | ID | Change | From → To |
|---|---|---|---|
| 2026-08-31 | — | Backlog created from feature review of `main` @ `9dff19b` | — |
| 2026-08-31 | KF-01…KF-09 | Killer features entered from repository analysis | — → planned |
| 2026-08-31 | INF-01, INF-02 | Infrastructure prerequisites identified while scoping KF-02/03/05 | — → planned |
| 2026-08-31 | FUN-01…FUN-06 | Playful reuses entered | — → planned |
| 2026-08-31 | FUN-07, FUN-08, FUN-09 | Sequenced behind enrichment and multi-record work | — → deferred |
| 2026-08-31 | KF-01 | Assigned to subagent; owns core.py, schema, core tests | planned → in-progress |
| 2026-08-31 | KF-03 | Assigned to subagent; owns exporters.py + templates/ | planned → in-progress |
| 2026-08-31 | KF-05 | Assigned to subagent; owns lint.py | planned → in-progress |
| 2026-08-31 | FUN-01, FUN-02, FUN-03, FUN-06 | Assigned to one subagent; owns fun.py | planned → in-progress |
| 2026-08-31 | INF-01, INF-02 | Retained by session; sequenced after KF-01 to keep core.py single-owner | planned → in-progress |
| 2026-08-31 | KF-01 | schema_version raised to 0.2.0 as part of the contract extension | scope |
| 2026-08-31 | KF-01 | Activities surface implemented; 10 core tests green, schema validates | in-progress → in-review |
| 2026-08-31 | KF-01 | Markdown rendering of qualifications/invited positions/research resources split out as remaining work | scope |
| 2026-08-31 | KF-01 | Agent reported complete; reviewed and landed in 1c04d87 | in-review → done |
| 2026-08-31 | INF-03 | Opened: ORCID egress blocked, so KF-01 fixture is unverified against a live record | — → planned |
| 2026-08-31 | KF-02 | Absorbed funding-amount fetching, which needs per-put-code batching | scope |
| 2026-08-31 | KF-05 | Implementation green locally, awaiting agent report | — |
| 2026-08-31 | KF-05 | Implemented: 14-check weighted rubric, report and shields badge; 21 tests green | in-progress → in-review |
| 2026-08-31 | KF-05 | ROR check deferred to not-applicable until affiliations carry organisation identifiers | scope |
| 2026-08-31 | INF-01 | Checksum validation, offline --record loading, retry/backoff, sandbox URL; 8 tests added | in-progress → done |
| 2026-08-31 | KF-03 | CSL-JSON, BibTeX and RIS exporters plus nih/erc/horizon templates; 12 tests green | in-progress → in-review |
| 2026-08-31 | FUN-01, FUN-02, FUN-03, FUN-06 | Wrapped, trading card, heatmap and fortune implemented; 27 tests green | in-progress → in-review |
| 2026-08-31 | FUN-01 | Verified on the committed record: keyword drift and gap analysis derived only from asserted dates and titles | — |
| 2026-08-31 | INF-02 | CLI restructured into eight subcommands; back-compat shim and 14 CLI tests | in-progress → done |
| 2026-08-31 | KF-03, KF-05 | Reviewed, smoke-tested against the real record and landed | in-review → done |
| 2026-08-31 | FUN-01, FUN-02, FUN-03, FUN-06 | Reviewed and landed | in-review → done |
| 2026-08-31 | KF-05 | CI gate criterion satisfied by `lint --fail-under` | — |
| 2026-08-31 | INF-04 | Opened: published generated/ outputs still declare schema_version 0.1.0 | — → planned |
| 2026-08-31 | KF-01, KF-03, KF-05, FUN-01/02/03/06 | Code review at high effort; six findings plus an export mode-selection bug fixed on the branch | done → done (reviewed) |
| 2026-08-31 | KF-05 | affiliations.org_ids was unassessable because core dropped the disambiguated org id; core now carries it and the rubric reaches its documented 100 points | fix |
| 2026-08-31 | KF-01, KF-03 | Point-in-time sections no longer rendered as ongoing; a distinction with no end date reads 2018, not 2018–present | fix |
| 2026-08-31 | — | README documents the playful reuses and links the backlog | docs |
| 2026-09-01 | KF-02, KF-05, FUN-03, INF-05…INF-07 | Code/tool review recorded nine correctness, security and portability findings | scope |
| 2026-09-01 | KF-02 | Authorless citation exports promoted from roadmap enhancement to adoption blocker; implementation started | planned/P1 → in-progress/P0 |
| 2026-09-01 | INF-05, INF-06, INF-07 | Contract, web trust-boundary and cross-platform hardening opened from review | — → in-progress |
| 2026-09-01 | KF-02 | Bulk work detail fetch implemented and live-verified: 33/33 current works carry contributors; funding detail remains | in-progress → in-progress |
| 2026-09-01 | INF-03 | Public API egress restored; record and bulk-work shapes verified, remaining activity shapes still pending | scope |
| 2026-09-01 | KF-05 | Empty-work scoring and multi-source assertion classification corrected | fix |
| 2026-09-01 | FUN-03 | Heatmap now renders intervening zero-output years instead of hiding them | fix |
| 2026-09-01 | INF-05, INF-06, INF-07 | Strict schema, safe/race-proof web loading, and cross-platform CLI/test fixes verified | in-progress → done |
| 2026-09-01 | KF-02 | Preferred funding details fetched and live-verified at `57000.0 EUR`; work authors and graceful fallbacks retained | in-progress → done |
| 2026-09-01 | INF-03 | Live `funding-summary` and full funding response shapes verified; remaining uncommon activity shapes stay open | planned → in-progress |
| 2026-09-01 | INF-04 | Published outputs regenerated at schema 0.2.0 and playful website artifacts added to daily sync | planned → done |
| 2026-10-15 | KF-10 | Epic #6 opened for a local network pilot; parallel implementation started for model, interface, server, and runbook | — → in-progress |
| 2026-10-15 | KF-07, KF-08 | Local groups and manual-refresh feed pilot tracked in KF-10; hosted team mode and Atom scope remain planned | scope |
| 2026-10-15 | — | README polling permission claim corrected; unattended network monitoring requires an agreed ORCID access arrangement | docs |
| 2026-10-15 | KF-10 | Local pilot implemented; Python/JS tests, live ORCID import, desktop/mobile walkthrough and package contents verified; coordinator feedback pending | in-progress → in-review |
| 2026-10-15 | KF-11 | Local working-group milestone #8 started for bulk roster, contributions, selected outputs, requests, and scoped team packs; verification pending | — → in-progress |
| 2026-10-15 | — | Documentation repository links updated to orcid-playground; Python package and command names preserved | docs |
| 2026-10-15 | KF-11 | 178 Python tests and 9 JS tests passed; browser workflow, bulk failure/retry/cancellation, scoped ZIP and existing workspace preservation verified; coordinator report feedback pending | in-progress → in-review |
| 2026-10-18 | KF-12 | Roster assertion contract, fixtures and tests opened for #9 | — → in-review |
| 2026-10-30 | KF-01 | Markdown now renders qualifications, invited positions and research resources | fix |
| 2026-10-30 | INF-08 | GCP hosting strategy documented in docs/gcp-hosting.md; no deployment yet | — → planned |
| 2026-10-30 | INF-08 | Static site builder, Firebase config and preview-channel deploy workflow added | planned → in-progress |
| 2026-10-30 | INF-09 | Hosted multi-researcher service designed and gated on auth; pilot not deployable as is | — → planned |
| 2026-10-30 | INF-08 | Preview deployed to orcid-playground-889 (run 41071880181) | in-progress → done |
| 2026-10-30 | KF-10, KF-11 | Network pilot (PR #7) merged to main; coordinator feedback (#8) still pending | merged |
| 2026-10-30 | INF-10 | In-browser playground: Studio, network on Pyodide, optional ORCID sign-in | — → in-review |
| 2026-10-30 | INF-10 | Audit: deploy hardening, cross-tab workspace lock, confirmed handoffs, engine recovery, identity check | fix |
| 2026-10-30 | INF-10 | Pyodide self-hosted with pinned hashes; Studio tabs keyboard-accessible (#14) | fix |
| 2026-10-30 | KF-13 | Shareable group links, collaboration graph, group heatmap and bibliography (#15 phase 1) | — → in-review |
| 2026-10-30 | KF-14 | Group record health and team biosketch in the group view (#15 phase 2) | — → in-review |
| 2026-10-30 | KF-15 | Group Wrapped, card deck, embeddable widget, offline app and digest (#15 phase 3) | — → in-review |
| 2026-10-31 | INF-10 | Live at orcid-playground-889.web.app (run 41182335060); verified in headless Chrome on the live site; sign-in split to INF-11 | in-review → done |
| 2026-10-31 | KF-13, KF-14, KF-15 | Merged (#16, #17, #18), deployed live and verified on the live site; #15 closed | in-review → done |
| 2026-10-31 | INF-11 | ORCID sign-in verification split from INF-10; awaits a registered client (#14) | — → planned |
| 2026-10-31 | INF-10 | Deploy policy: main and weekly sync deploy live; previews on demand | policy |
| 2026-10-31 | KF-16 | Workspace backup/restore, Studio "Me" panel and password-encrypted team packages, all in the browser | — → in-review |
