# Demo videos

`node demo/render.mjs` renders a ~85 s full demo (1280x720) and six 1080x1080 LinkedIn clips into `demo/out/`.
Needs `pip install -e .`, Playwright (`NODE_PATH` or a local `node_modules`) and `ffmpeg`.

Everything on screen is real output: the CLI runs on the stored record (`generated/biosketch.json`), the card and
heatmap are the generated SVGs, and the network scenes are the local pilot with its labelled **Demo** sample data.
No ORCID network access is needed. Not shown yet: the hosted Studio and Group view (they need Pyodide from a CDN,
so record those from a networked machine and splice them in).

| File | Length | Message |
|---|---|---|
| `orcid-playground-full-demo.mp4` | ~85 s | Full walkthrough |
| `clip-0-teaser` | ~5 s | "Your ORCID record, re-expressed." |
| `clip-1-record-check` | ~16 s | Lint score and concrete fixes |
| `clip-2-funder-templates` | ~17 s | NIH / ERC / Horizon from one record |
| `clip-3-wrapped` | ~16 s | A year in review, no invented numbers |
| `clip-4-card-and-heatmap` | ~9 s | Trading card and honest heatmap |
| `clip-5-research-network` | ~19 s | Feed, people, working groups (local pilot) |

## LinkedIn copy (drafts)

**Full demo.** Your ORCID record already holds a decade of your work. What if you could reuse it, on your terms?
ORCID Playground turns the public record into a biosketch, NIH/ERC/Horizon templates, citations, a quality check and a few playful extras.
The researcher controls the narrative; ORCID supplies the assertions; every field keeps its provenance. Open source, works offline.
orcid-playground-889.web.app  #ORCID #OpenScience #FAIR #ResearchData

**Clip 1.** How complete is your ORCID record? One command gives a score and tells you exactly what to fix.

**Clip 2.** Writing a grant biosketch again? Generate the NIH, ERC or Horizon skeleton from your ORCID record. The story stays yours.

**Clip 3.** "Wrapped" for researchers, with no made-up numbers: busiest month, longest gap, how your title vocabulary drifted.

**Clip 4.** A printable trading card and a publication heatmap, both built only from what your record asserts. Honest about fallow years.

**Clip 5.** A local pilot for following collaborators' public outputs and curating working groups. Sample data is labelled Demo; membership is never presented as verified.

Post tip: LinkedIn autoplays muted, so the captions carry the message. Upload the MP4 natively rather than linking it.
