# Community launch copy and lightweight pilot

Do not publish until the public docs/feedback URLs are verified, the new hostname is live (INF-13) and ORCID has reviewed the rebranded app (#44), and the recorded video is checked. Every item in [`release-checklist.md`](release-checklist.md) (Release B) must be signed first; current findings are in [`claims-privacy-audit.md`](claims-privacy-audit.md).

## LinkedIn / community announcement (English)

**Publish or Play: your ORCID record can do more than identify you.**

I have been building **Science Record Player (SRP)**, an independent open-source experiment to see how public research records can become genuinely useful to scientists.

Paste an ORCID iD and explore a biosketch, searchable works, record-quality suggestions, citation exports, a publication heatmap and a year in review. You can also try a local research network, manage contacts after conferences, curate working groups and visualize shared DOI assertions across public records.

The important constraint: a public ORCID record is **not independently verified**, and a shared DOI is not proof of a collaboration or confirmed team membership.

**Try it without creating an account:** https://science-record-player.web.app/

I'm looking for researchers, lab coordinators and data stewards to spend five minutes with it. What would be useful? What is misleading? Which feature would you want next?

**Suggest a feature without GitHub:** https://science-record-player.web.app/feedback/

**Developer issues:** https://github.com/dhuzard/science-record-player/issues/new/choose

Built in the open. This is an independent open-source project and is not affiliated with, sponsored by, or endorsed by ORCID. ORCID® is a registered trademark of ORCID, Inc.

## Short teaser copy

A scientific profile is more than an ID. Explore your public ORCID record, improve its completeness, export reusable data and try research-group tools. **What should we build next?** https://science-record-player.web.app/

## Outreach plan

Recruit a small, deliberately varied pilot before announcing broad usability:

- 4–5 individual researchers: discover publications, inspect record check and export citations.
- 3–4 lab coordinators or consortium leads: group rosters, project attribution, team drafts.
- 2–3 RSEs, data stewards or librarians: machine-readable exports, provenance, embedding and failure modes.

Avoid measuring success only with clicks/stars. For each participant, collect voluntary, non-identifying feedback on **task completion**, whether a warning was understood, output reuse intent, the main blocker, and **one requested feature**. Treat claims of repeat use as intention until actually observed. Do not record contact notes or participant identifiers in public issues.

Suggested progression: recruit 10 testers → fix blocking usability/accuracy problems → publish full demo and short teaser → ask the broader scientific community for task-based feature proposals → release a public “You asked / we changed” summary.

## Scientific claims to avoid in promotion

- “Verified ORCID identity” merely because an iD has a valid checksum or a public record was read.
- “Automatically discovered collaborations” without specifying the shared-DOI heuristic and its limitations.
- “Official NIH/ERC/Horizon compliant” for unreviewed template drafts.
- “Fully private/no server” as a blanket statement for future private cloud Teams/sync.
- “All features live” before cloud activation and video coverage checks.

For ORCID trademarks/naming, consult the [official brand guidelines](https://info.orcid.org/brand-guidelines/); an independence disclaimer does not substitute for any permission that may be required.
