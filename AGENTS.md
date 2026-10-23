# AGENTS.md — ORCID Biosketch / Playground

## Scope
Researcher-controlled biosketches and structured outputs based on **public ORCID assertions**. ORCID is a source of asserted fields; the researcher controls narrative, selection and presentation. This is not an authority for scientific credentials or verified identity, and it must not invent affiliations, works, authorship or dates.

## Read first
`README.md`, `BACKLOG.md`, `schema/biosketch.schema.json`, `src/orcid_biosketch/`, and `tests/`.
The package/CLI on `main` currently owns `orcid-biosketch`; network/working-group functionality may exist only in feature PRs. Do not describe an unmerged PR as a released feature.

## Source/provenance rules
- Preserve input origin and per-field provenance in JSON, Schema.org JSON-LD, Markdown and bibliographic exports.
- An ORCID iD passing check digits is syntactically valid, not proof that its assertions are true, current or complete.
- Public ORCID API responses, XML/JSON and text fields are untrusted data; sanitize HTML/SVG and avoid network exfiltration. Never commit ORCID tokens.
- Support offline `--record` / `--biosketch` use. Optional ORCID API calls must be explicit; avoid changing historical generated profiles without reproducible source inputs.
- Fun output (cards, heatmaps, wrapped, fortune) re-expresses asserted facts only; no fabricated numbers, collaborator links or titles.
- Team/group or ORAtlas/Diggypaper integration must have its own contract and informed disclosure choices; no unreviewed private group data.

## Test
```bash
python -m pip install -e '.[dev]'
python -m pytest -q
```
Use stored/synthetic ORCID fixtures in deterministic tests. Update the backlog item status with evidence; don't claim a feature shipped until merged and tested.
