# Demo videos

Videos of the web app UI only (no terminal). `python scripts/build_site.py site && node demo/render.mjs site`
renders a ~100 s full demo (1280x720) and 1080x1080 LinkedIn clips into `demo/out/` (needs Playwright and ffmpeg).

The real built site is served locally. The Studio runs on the maintainer's stored profile (the "stored, offline" chip)
and the research network on its labelled **Demo** sample data, so no ORCID API access is needed. Pyodide is pinned by
SHA-256 in `scripts/build_site.py`; if the CDN is blocked, put the verified files in `.cache/pyodide-0.26.4/`.
Not shown: the Group view (it needs live ORCID records) and sign-in with ORCID. Record those from a networked machine.

| File | Length | Message |
|---|---|---|
| `orcid-playground-full-demo.mp4` | ~100 s | Studio tour, then the research network |
| `clip-0-teaser` | ~5 s | "Your ORCID record, re-expressed." |
| `clip-1-record-check` | ~12 s | Score and concrete fixes |
| `clip-2-funder-templates` | ~12 s | ERC / NIH / Horizon from one record |
| `clip-3-wrapped` | ~12 s | Year in review and Fortune |
| `clip-4-card-and-heatmap` | ~12 s | Trading card and honest heatmap |
| `clip-5-research-network` | ~20 s | Feed, people, working groups |
| `clip-6-citations-and-data` | ~8 s | BibTeX, RIS, CSL, JSON-LD, Markdown |

## LinkedIn copy (drafts)

**Full demo.** Your ORCID record already holds a decade of your work. What if you could reuse it, on your terms?
ORCID Playground turns the public record into a biosketch, NIH/ERC/Horizon templates, citations, a quality check and a few playful extras.
The researcher controls the narrative; ORCID supplies the assertions; every field keeps its provenance. Open source, works offline.
orcid-playground-889.web.app  #ORCID #OpenScience #FAIR #ResearchData

**Clip 1.** How complete is your ORCID record? The Studio gives a score and tells you exactly what to fix.

**Clip 2.** Writing a grant biosketch again? Generate the NIH, ERC or Horizon skeleton from your ORCID record. The story stays yours.

**Clip 3.** "Wrapped" for researchers, with no made-up numbers: busiest month, longest gap, how your title vocabulary drifted.

**Clip 4.** A printable trading card and a publication heatmap, both built only from what your record asserts. Honest about fallow years.

**Clip 6.** Take it with you: BibTeX, RIS, CSL JSON, Schema.org JSON-LD and Markdown, with per-field provenance preserved.

**Clip 5.** A local pilot for following collaborators' public outputs and curating working groups. Sample data is labelled Demo; membership is never presented as verified.

Post tip: LinkedIn autoplays muted, so the captions carry the message. Upload the MP4 natively rather than linking it.
