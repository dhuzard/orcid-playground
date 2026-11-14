<p><img src="brand/wordmark.png" alt="Science Record Player — Publish or Play" width="420"></p>

# Science Record Player (SRP)

## Explore your scientific record. Connect your research world.

**Publish or Play.** Two ways in, both running in your browser. No sign-in is needed to explore public ORCID records.

| **Explore & Play** — for one record | **Connect & Organize** — for the people you work with |
| --- | --- |
| Turn a public ORCID record into a profile, trading card, publication heatmap, career Wrapped, a **Record check** with suggested fixes, draft funder biosketches and citation exports. | Keep **Contacts** with conference context, private notes and follow-ups; curate local working **Groups**; select project outputs and download a team pack. Kept in this browser. |
| **[Explore a record →](https://science-record-player.web.app/)** | **[Open My Network →](https://science-record-player.web.app/network/#contacts)** · [Try it with sample data](https://science-record-player.web.app/network/?sample=1#groups) |
| [Quick Start](#quick-start-explore--play) · [Studio guide](docs/source/studio.md) | [Quick Start](#quick-start-connect--organize) · [My Network guide](docs/source/research-network.md) |

[How it works (documentation)](https://science-record-player.web.app/docs/) · [Public Group View](https://science-record-player.web.app/group/) · [Send feedback without GitHub](https://science-record-player.web.app/feedback/) · [Source code](https://github.com/dhuzard/science-record-player)

> **This is an independent open-source project and is not affiliated with, sponsored by, or endorsed by ORCID.** It reads public data through the [ORCID Public API](https://info.orcid.org/what-is-orcid/services/public-api/). ORCID® is a registered trademark of ORCID, Inc.

Developed and maintained independently by **Damien Huzard / Neuronautix** under the [MIT license](LICENSE). ORCID data are public assertions, not independently verified credentials.

## Quick Start: Explore & Play

**Outcome:** a record-quality report and a citation file for one public record. **About 4 steps, 2 minutes.** Nothing is installed and nothing is stored on a server.

1. Open **[Explore](https://science-record-player.web.app/)** and choose **The maintainer's profile (stored, offline)**. This stored sample makes no ORCID request. Or paste any public ORCID iD and select **Explore** (this reads `pub.orcid.org`).
2. Open the **Record check** tab: a graded checklist of detectable gaps, with suggested fixes to make *in ORCID*. The score is this tool's completeness rubric, not research merit.
3. Open **Citations & data** and download **BibTeX**, **RIS**, CSL JSON, the provenance-aware **Biosketch JSON**, Schema.org **JSON-LD** or Markdown.
4. Try **Trading card**, **Heatmap**, **Wrapped**, **Fortune** or **Funder biosketch** (NIH / ERC / Horizon *drafts*).

Next step: **Keep this researcher in My Network** (from #56) offers **Save as contact**, **Add to group** or **Follow**, and asks before anything is read or saved. Walkthroughs: [Get started](docs/source/getting-started.md) and the [five-minute tutorials](docs/source/tutorials.md).

## Quick Start: Connect & Organize

**Outcome:** a labelled sample workspace with a contact note and a curated group, ready to export as a team pack. **About 5 steps, 5 minutes.** Everything stays in this browser unless you download a file.

1. Open **[My Network with sample data](https://science-record-player.web.app/network/?sample=1#groups)** and confirm the prompt. Sample data is added only after you confirm; every sample person is labelled **Demo**.
2. The sample adds people and a group but no contacts. In **People**, select **+** on a Demo person and add a tag (for example a conference name): that makes them a contact. Then open **Contacts** and add a note and a follow-up with a due date. With real people, use **I just met people** in Contacts: paste ORCID iDs, name the context and choose **Import & tag**. Nobody is notified.
3. In **Groups**, open the demonstration group: review the roster and locally entered roles, then choose which member outputs belong to the project.
4. Open **Team pack** and download it for the selected people, outputs and dates. Team packs never include Contacts notes.
5. Optional: compose a shareable **[Public Group View](https://science-record-player.web.app/group/)** link from public ORCID iDs. It carries only a group name and the iDs.

Before investing time in notes, download a **workspace backup** (it contains your notes, so keep it private). Full walkthrough: [Explore → Contact → Group tutorial](docs/source/tutorials.md#tutorial-2--connect--organize-explore--contact--group), [My Network guide](docs/source/research-network.md) and [Public Group View guide](docs/source/groups.md).

## What is available where?

| Feature | Status | Where the data lives |
| --- | --- | --- |
| **Explore** (Studio): profile, Record check, cards, heatmap, Wrapped, Fortune, funder drafts, exports | Live public web app; computed in your browser | Your browser and your downloads; live records read from `pub.orcid.org` on request |
| **My Network**: People, Feed, Saved, Contacts (tags, notes, follow-ups) | Live public web app; **browser-local** | This browser profile only (IndexedDB). Clearing site data deletes it |
| **Local curated Groups**: roster, roles, project outputs, requests, team pack | Live public web app; **browser-local** | This browser. Roles and membership are your annotations, not confirmed by the people listed |
| Workspace backup / restore; password-encrypted team package | Live public web app; **browser-local** files | Files you download. The backup includes Contacts notes; the encrypted package does not |
| **Public Group View link** | Live public web app | The link itself: group name and public ORCID iDs, in the URL fragment. As public as wherever you post it |
| Installable app, offline reopening | Live public web app | Cached app code and stored data reopen offline after a visit; reading a new ORCID record needs a connection |
| Optional ORCID sign-in | Live public web app (not re-checked on the current hostname) | Tab-scoped session state |
| Python package, `srp` CLI, local SQLite network pilot, Web Components | Local Python pilot / self-hosted | Your local files |
| **Private cloud Teams** and personal cloud sync | **Experimental — not available.** Not yet confirmed active on the public site | Would use an EU cloud database if activated; code and emulator tests exist, no production test or security review recorded |
| Guided first-run journeys and Explore → My Network handoffs (Save as contact, Add to group) | Added by #56 ([PR #66](https://github.com/dhuzard/science-record-player/pull/66), which merges before this documentation); not verified on the live site | This browser, after you confirm each import |
| Published demo video | Planned; no video published yet | — |

“Live public web app” means the feature is deployed with the site; the [claims and privacy audit](communications/claims-privacy-audit.md) records that **no feature has yet been verified on the live deploy** and that public promotion is blocked until the [release checklist](communications/release-checklist.md) is signed. Studio and My Network never require private cloud Teams. See [Provenance, limits and privacy](docs/source/trust.md).

**Three different things called “group”:** a *local curated Group* in My Network (your private annotations, in this browser); a *Public Group View link* (only a name and public iDs, anyone with the link can open it); and a *private cloud Team* (invite-only, not available).

## The scientific boundaries matter

- **ORCID provides public assertions.** A valid iD or a public record does not independently verify the person's identity, affiliations, authorship, funding or project membership.
- **Shared-DOI edges are co-assertions.** In Public Group View, two members are linked when both public records list the same DOI, and the DOI is shown. That is a co-assertion of one output, not independent evidence that they collaborated, held specific roles or agreed to a group listing. Colleagues with incomplete records or DOI-less outputs are not linked.
- **Funder-format exports are drafts.** Verify the content and current official requirements before use.
- **Your local notes are not public ORCID data.** My Network stays in your browser by default; a downloaded backup or encrypted team package contains local annotations, so handle it carefully.
- **Not everything works offline.** Cached application code and stored data can be usable offline after a visit; live public ORCID reads need a connection.

## Help shape the next version

We especially welcome feedback from **individual scientists, lab and consortium coordinators, research software engineers, data stewards and librarians**. No code is necessary: try a real task (or the labelled sample data), then tell us what was confusing, which result needs correction, and what would make the tool worth using again.

**[Send scientist feedback without GitHub](https://science-record-player.web.app/feedback/)** · [Open a GitHub issue](https://github.com/dhuzard/science-record-player/issues/new/choose) · [How to contribute](CONTRIBUTING.md) · [Backlog](BACKLOG.md)

Scientific correctness, provenance and privacy concerns are prioritized over decorative additions.

## For developers: Python package and CLI

Install the `science-record-player` package (import `science_record_player`) and use the `srp` command. The former names `orcid_biosketch`, `orcid-biosketch` and `orcid-network`, and the `<orcid-biosketch>` / `<orcid-group>` tags, still work as deprecated aliases and will be removed in a future release.

```bash
python -m pip install -e .

srp generate 0000-0003-4820-7951 \
  --config config/biosketch.json --output generated
srp lint 0000-0003-4820-7951
srp export 0000-0003-4820-7951 --format bibtex > refs.bib
srp export 0000-0003-4820-7951 --template nih
srp wrapped 0000-0003-4820-7951 --year 2025
```

Generated files include `biosketch.json` (provenance-aware), `biosketch.jsonld` (Schema.org) and `biosketch.md`. The CLI also supports `card`, `heatmap`, `fortune`, `badge`, offline `--record` / `--biosketch` input, `--sandbox`, and optional public-record details. Do not commit access tokens.

Local SQLite research-network pilot:

```bash
python -m science_record_player.network --port 8877 --data .local/network.sqlite3
```

Open `http://127.0.0.1:8877`. The pilot is local-only and has no shared logins or verified group membership. See [the local network guide](docs/network-pilot.md).

### Embedding in your website

The `<srp-biosketch>` Web Component reads a published `biosketch.json` and supports biography, a searchable works table, source details and print/PDF export; the `<srp-group>` component reads a published group snapshot. Follow the [website integration guide](docs/website-integration.md). The static snapshot does not update itself until regenerated.

### Build, tests and documentation

```bash
python -m pip install -e ".[dev]"
python -m pytest -q

python -m pip install -r docs/requirements.txt
python -m sphinx -b html -n -W --keep-going docs/source docs/_build/html
```

Sphinx is built from [docs/source](docs/source/index.md) and deployed with the site at [How it works](https://science-record-player.web.app/docs/). Scripted screen recordings of the real built site (Studio, working groups, Contacts) are produced by the merged, manually dispatched video workflow described in [demo/README.md](demo/README.md); no video has been published yet, and publication is gated by the [release checklist](communications/release-checklist.md).

## Name, license and attribution

Formerly “ORCID Playground”, renamed after ORCID's written response on branding (see [communications/branding-and-rename.md](communications/branding-and-rename.md)); the display name is set in [`config/brand.json`](config/brand.json). ORCID has not reviewed or approved the new name.

[MIT](LICENSE) for repository code. Public ORCID records are subject to their own data policies and visibility settings. This is an independent open-source project and is not affiliated with, sponsored by, or endorsed by ORCID. ORCID® is a registered trademark of ORCID, Inc. Refer to the [ORCID public API](https://info.orcid.org/what-is-orcid/services/public-api/) and [brand guidelines](https://info.orcid.org/brand-guidelines/).
