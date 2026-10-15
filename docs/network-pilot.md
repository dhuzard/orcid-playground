# Local research network pilot

Status: local implementation verified; ready for coordinator testing under
[epic #6](https://github.com/dhuzard/orcid-biosketch/issues/6).

The pilot tests whether following research outputs and preparing a working-group
team pack are useful enough to return to. It runs as one local workspace with
Feed, People, Groups, and Saved views. The initial test needs no ORCID account or
API connection when using the labelled sample data.

## Run locally

Use Python 3.10 or newer. From the repository directory:

```bash
python -m pip install -e .
python -m orcid_biosketch.network --port 8877 --data .local/network.sqlite3
```

Open <http://127.0.0.1:8877> and leave the terminal running. Stop with `Ctrl+C`.
The installed `orcid-network` command accepts the same options.
The server binds only to `127.0.0.1`; another participant runs their own copy or
joins a facilitated screen-sharing session. A localhost URL is not a public
invitation link.

The workspace starts empty. Choose the UI's sample-data action to add fictional,
labelled researchers and illustrative updates, or import a public ORCID iD.
Loading samples again does not overwrite real imports. Follow choices, saved
outputs, groups, and imported records persist at `.local/network.sqlite3`; use the
same command to resume. For a fresh participant, select a new path such as
`--data .local/participant-02.sqlite3`. Run only one server per data file.

## Five-minute test

Use sample data so network latency and record completeness do not affect the
first usability test. Ask the participant to work without hints; record where
they need help.

| Time | Task | What to observe |
|---|---|---|
| 0–1 min | Load samples and find an interesting update in Feed. | Can they explain what changed and distinguish an observed update from a publication date? |
| 1–2 min | Open People, unfollow a researcher, then follow them again. | Can they predict which updates belong in their feed? |
| 2–3 min | Save an output, find it in Saved, then remove it. | Can they recover something worth reading without help? |
| 3–4 min | Create a working group from two researchers and inspect its outputs. | Can they understand the roster and recognise shared works without duplicate entries? |
| 4–5 min | Download the group's team pack and inspect its roster and references. | Would these files help with a real report or proposal? Is their scope clear? |

Reload the browser and confirm that follows, groups, and any remaining saved
outputs persist. Separately, restart the server with the same data path to check
that the workspace survives a process restart.

For an optional live-data test, import an ORCID iD or link, inspect the public
record, and refresh it manually. The first import is a baseline: existing works
appear in the researcher's outputs but do not become new feed events. A refresh
of an unchanged record should add no events. An older work first observed on a
later refresh is an added-to-record update, not a newly published paper. Do not
edit a real ORCID record just to manufacture a test update.

## What this pilot does and does not establish

- Importing a public record follows it locally; it does not authenticate its
  holder, notify them, or claim that they joined this application.
- Groups are locally curated rosters. Membership is unconfirmed. Their combined
  output library and exports contain members' outputs, which are not necessarily
  outputs of that group or project.
- Publication dates and observation times are separate. Shared works with the
  same DOI are deduplicated while retaining their researcher associations.
- Public records can be incomplete or out of date. Refresh is manual; there is
  no background polling, email digest, or real-time notification service.
- Each import uses a public record summary, without extra author-enrichment
  requests. Team-pack references use the available ORCID metadata and may omit
  full author lists. Inspect exports before using them in a submitted report.
- There is no OAuth, multiuser authorization, shared invitation flow, public
  group page, announcement feed, or researcher consent workflow yet. The local
  SQLite database is the workspace storage, not a hosted multiuser service.

Before unattended monitoring or hosted deployment, resolve the ORCID access
arrangement and implement accounts, authorization, confirmed membership,
visibility controls, and data retention rules. The
[Public API terms](https://info.orcid.org/public-client-terms-of-service/)
prohibit continuous polling and limit commercial use; a public endpoint does
not by itself authorize a monitoring service. This pilot does not change the
repository's pre-existing synchronization workflow.

## Success measures and feedback

For the first five participants, aim for four to complete saving an output and
creating/exporting a group without assistance. Record task completion, time,
errors, and help needed. Every participant should understand that sample data
are fictional, roster membership is unconfirmed, and an observed update is not
necessarily a recent publication. Misunderstandings here require a design fix.

Ask one coordinator to prepare a small real team report using the exported pack
and compare elapsed time with their usual process. During a one-week follow-up,
record whether participants return voluntarily and which outputs they save;
these are observations to collect, not claims already demonstrated.

Feedback prompts:

1. What would bring you back next week?
2. Which information or label was confusing or missing?
3. What would you change before using this team pack in a report?
4. Which matters most next: shared groups, sign-in, a digest, or better exports?

Add observations and reproducible failures to
[epic #6](https://github.com/dhuzard/orcid-biosketch/issues/6), including the view,
steps, expected result, actual result, and whether the data were sample or live.
The developer contract is in [network-api.md](network-api.md).
