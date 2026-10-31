# ORCID Playground

Tools for reusing public ORCID records in biosketches and a local research network.
The Python package and CLI names remain `orcid_biosketch` and `orcid-biosketch`.

Generate a researcher-controlled, provenance-aware biosketch from a public ORCID record. The tool creates stable JSON, Schema.org JSON-LD and Markdown outputs that can be consumed by personal websites, institutional profiles and research agents.

The central design rule is simple: **ORCID supplies structured assertions; the researcher controls narrative and selection.** The tool does not silently invent or rewrite scientific credentials.

## Quick start

```bash
python -m pip install -e .
orcid-biosketch generate 0000-0003-4820-7951 \
  --config config/biosketch.json \
  --output generated
```

`orcid-biosketch <ORCID>` still generates, as before subcommands existed.

Outputs:

- `generated/biosketch.json` — canonical normalized record
- `generated/biosketch.jsonld` — Schema.org `Person`
- `generated/biosketch.md` — website- and CV-ready Markdown

Only public ORCID data are retrieved. An optional `ORCID_ACCESS_TOKEN` environment variable is supported; never commit access tokens.
By default the tool also batches selected work put-codes through ORCID's bulk
works endpoint so citation exports include contributors, and fetches preferred
funding entries so amounts and currencies are preserved. Pass `--summary-only`
to skip those detail requests when a faster summary is sufficient.

## Hosted playground

The playground runs everything in the visitor's browser: try it at
<https://orcid-playground-889.web.app>. Every merge to `main` and the weekly
ORCID sync deploy it automatically; branches can be previewed on demand (see
[docs/gcp-hosting.md](docs/gcp-hosting.md)).

- **Studio** (`/`): enter any ORCID iD, or sign in with ORCID, for the biosketch,
  trading card, heatmap, wrapped, fortune, record check, funder templates and
  BibTeX/RIS/CSL/JSON-LD downloads.
- **Research network** (`/network/`): the pilot below, with its workspace stored
  only in that browser.
- **Group view** (`/group/`): a shareable link of public ORCID iDs that shows who
  has published together, linking members only through DOIs both records assert,
  with record health, a funder team biosketch, Group Wrapped and a printable card deck.

The site installs as an app and works offline after one visit. To show a group on
a lab website, download its snapshot from the group view's Embed tab and add:

```html
<script type="module" src="https://orcid-playground-889.web.app/orcid-group.js"></script>
<orcid-group src="/group.json"></orcid-group>
```

The package runs under [Pyodide](https://pyodide.org), served from the site with
pinned hashes, in a Web Worker and reads only the public ORCID API; the site has
no server-side code. Build it with
`python scripts/build_site.py site`. Hosting and sign-in setup are in
[docs/gcp-hosting.md](docs/gcp-hosting.md).

## Local research network pilot

An early pilot adds **Feed, People, Groups, and Saved** to the biosketch tools.
Follow public ORCID records, save outputs, curate a working-group roster, and
download a team pack. Implementation and review are tracked in
[epic #6](https://github.com/dhuzard/orcid-playground/issues/6).
The local working-group milestone is ready for coordinator testing in
[issue #8](https://github.com/dhuzard/orcid-playground/issues/8): bulk roster
import, local roles and contributions, selected project outputs, collaboration
requests, and team packs scoped by members and publication dates.

```bash
python -m pip install -e .
python -m orcid_biosketch.network --port 8877 --data .local/network.sqlite3
```

Open <http://127.0.0.1:8877>. Load the labelled sample data from the UI for an
offline trial, or import a public ORCID record. Imports and refreshes are manual;
the first import establishes a baseline without flooding the feed with old
papers. Later refreshes report newly observed outputs separately from their
publication dates. State persists in the chosen local SQLite database.
The `orcid-network` command is an alias for the module command above.

This pilot is a single local workspace. It has no OAuth sign-in, shared accounts,
invitations, or automatic monitoring. Group rosters are locally curated and do
not establish confirmed membership. Project selections and member details record
local decisions, while public-record outputs remain attributable to their
sources. Exports describe their scope and do not establish confirmed project
attribution. See the [five-minute group test and pilot limits](docs/network-pilot.md).

## Commands

Every command accepts an ORCID iD, or works offline from `--record` (a saved
ORCID API response) or `--biosketch` (an already-generated `biosketch.json`).

| Command | Purpose |
|---|---|
| `generate` | Write `biosketch.json`, `.jsonld` and `.md` |
| `lint` | Score the record and say what to fix; `--fail-under N` exits non-zero |
| `export` | `--format csl\|bibtex\|ris`, or `--template nih\|erc\|horizon` for a funder biosketch |
| `wrapped` | A year in review, computed only from asserted data |
| `card` | Printable trading card (SVG) |
| `heatmap` | Publication heatmap (SVG) |
| `fortune` | Print one of your own titles, for a shell startup file |
| `badge` | shields.io endpoint JSON for the lint score |

```bash
orcid-biosketch lint 0000-0003-4820-7951            # what to fix, and why
orcid-biosketch export 0000-0003-4820-7951 --format bibtex > refs.bib
orcid-biosketch export 0000-0003-4820-7951 --template nih   # NIH-format biosketch
```

ORCID iDs are checksum-validated before any request, so a typo fails
immediately rather than as a confusing 404. Transient failures retry with
exponential backoff and honour `Retry-After`; `--sandbox` targets ORCID's
sandbox API.

## Playful reuses of an ORCID record

An ORCID record is a decade of someone's working life expressed as structured
data, and almost nobody looks at it twice. These commands re-present what is
already asserted there — under the same rule as everything else in this tool:
**every number and string is traceable to a field in the record. Nothing is
invented, inferred or embellished.**

```bash
orcid-biosketch wrapped 0000-0003-4820-7951 --year 2025   # a year in review
orcid-biosketch card    0000-0003-4820-7951 --qr ORCID.png -o card.svg
orcid-biosketch heatmap 0000-0003-4820-7951 -o years.svg  # publication grid
orcid-biosketch fortune --biosketch generated/biosketch.json
```

**`wrapped`** — a year in review: output count, top venue, most prolific month,
longest gap between outputs, busiest year of the career, first-time venues, and
how the vocabulary of your titles drifted between your early work and your
recent work. It is deliberately kind about sparse years: a two-paper year is
reported as two papers, not as a verdict.

**`card`** — a printable trading card. Years active as HP, output count as
attack, and a "special ability" drawn from the record's own keywords. Print a
stack for a lab door or a conference table. To include your official QR code,
sign in to ORCID and go to **Account Settings → Sharing → Get a QR code for
your ORCID iD**, download the PNG, and pass it with `--qr`. See
[ORCID's official QR-code guide](https://support.orcid.org/hc/en-us/articles/360006897654-Create-your-personal-ORCID-iD-QR-Code).

**`heatmap`** — the contribution-grid idea applied to publication dates. It is
honest about fallow years, which is the part a formatted CV quietly hides.

**`fortune`** — prints one of your own titles. Put it in your shell startup
file and get reminded, at random, of something you wrote and forgot.

Ideas tracked but not yet built ([BACKLOG.md](BACKLOG.md)): career sonification
to MIDI (FUN-04), a conference badge with QR plus vCard and email signature
(FUN-05), Erdős-style collaborator distance between two iDs (FUN-07),
deterministic generative art seeded from the iD itself (FUN-08), and academic
family trees reconstructed from education entries (FUN-09).

## Automatic synchronization

The included GitHub Actions workflow refreshes the generated files weekly (Monday 04:17 UTC) and commits only when the ORCID-derived output changes; a successful run then redeploys the hosted playground. The generated timestamp is derived from ORCID's record modification time, preventing meaningless commits. It can also be run manually from **Actions → Synchronize ORCID biosketch → Run workflow**.

Git commits create an auditable history. The existing scheduled workflow is
separate from the local network pilot, which only refreshes on request. ORCID's
[Public API terms](https://info.orcid.org/public-client-terms-of-service/)
prohibit continuous polling and restrict commercial use. The workflow's schedule
does not establish permission for unattended monitoring; the appropriate access
arrangement must be resolved before expanding it into a research network.

## Embed in a website

Load the web component and point it to any published `biosketch.json`:

```html
<script type="module" src="https://cdn.jsdelivr.net/gh/dhuzard/orcid-playground@main/web/orcid-biosketch.js"></script>
<orcid-biosketch
  src="https://raw.githubusercontent.com/dhuzard/orcid-playground/main/generated/biosketch.json"
  bio="true"
  works="all"
  search="true"
  pdf="true"
  provenance="true">
</orcid-biosketch>
```

The reusable component can display the biography, a searchable publication table, provenance, and an A4 PDF export. It adds no framework dependency and isolates its styling with Shadow DOM.

See the complete [website integration guide](docs/website-integration.md) for plain HTML, Astro, Jekyll/GitHub Pages, Hugo, Quarto and MyST, including browser-time and build-time synchronization.

## Researcher-controlled overrides

Pass a JSON document with `--config`. It is recursively merged onto the normalized record. This is intended for a headline, approved narrative variants and explicit publication-selection metadata. Overridden values are marked in provenance.

```json
{
  "person": {
    "headline": "Behavioral neuroscientist and FAIR metadata consultant"
  }
}
```

## Data quality and provenance

- The contract is `schema_version` 0.2.0, covering funding, peer review,
  distinctions, memberships, services, qualifications, invited positions and
  research resources alongside works and affiliations.
- ORCID visibility rules are respected: private and trusted-party-only information is not available through the public endpoint.
- Each work and affiliation retains its ORCID source and put-code where available;
  work groups retain every assertion source and live fetches include contributors.
- Duplicate ORCID work groups are represented by their preferred summary.
- ORCID is not a complete CV. Software, supervision, project narratives and selected-output policies usually require researcher-controlled additions.
- The generated timestamp reflects ORCID's record modification time, so identical source records produce identical outputs.

## Working-group roster export

`orcid_biosketch.roster` exports a local working group as an opt-in, private,
digest-sealed list of asserted identifiers for research workspaces such as
ORAtlas. It never grants access, confirms an invitation or infers a CRediT
role, and it is never part of the public outputs. See
[docs/roster-assertions.md](docs/roster-assertions.md).

## Development

```bash
python -m pip install -e ".[dev]"
pytest -q
```

## Included website capabilities

- Browser-time loading of the latest synchronized profile
- Configurable biography and work limits
- Publication search, output-type filtering and sorting
- DOI links and visible provenance
- Selectable, searchable A4 PDF biosketch export
- Framework-neutral Web Component
- Build-time JSON, JSON-LD and Markdown alternatives

## Roadmap

Tracked in [BACKLOG.md](BACKLOG.md), which carries status, acceptance criteria
and an append-only change log for every item. Next up:

- Full work records, including authors, via the bulk works endpoint (KF-02)
- Crossref/OpenAlex enrichment, labelled per field so ORCID assertions stay
  distinguishable and are never overwritten (KF-04)
- Assertion trust layer: self-asserted versus publisher-asserted works (KF-06)
- Lab and multi-researcher mode (KF-07)
- Change feed and publication Atom feed (KF-08)
- Named short, medium and long approved biography variants
- Optional ORCID OAuth and premium webhook adapter

## License

MIT
