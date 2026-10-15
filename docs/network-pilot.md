# Local research network pilot

Status: the local pilot and working-group extension are verified and ready for
coordinator testing under [milestone #8](https://github.com/dhuzard/orcid-playground/issues/8)
and [epic #6](https://github.com/dhuzard/orcid-playground/issues/6).

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

## Five-minute working-group test

Use a real group and a small roster supplied by its coordinator. The following
workflow describes milestone #8 and is awaiting implementation verification.
Allow the initial public-record imports to finish before starting the timer;
network latency and public-record completeness are separate observations.
For an offline rehearsal, use the labelled sample data. Ask the coordinator to
work without hints and record where they need help.

| Time | Task | What to observe |
|---|---|---|
| 0–1 min | Open the group roster and record one member's role, expertise, and contribution. | Can they distinguish locally entered details from imported ORCID assertions? |
| 1–2 min | Select two relevant suggested outputs for the project collection. | Do they understand that a member's publication is not automatically a project output? |
| 2–3 min | Create a collaboration request with an owner and deadline, then resolve it. | Is ownership clear? Do they understand that no message or notification is sent? |
| 3–4 min | Choose project outputs, a member subset, and a date range in Team pack. | Can they predict which people and outputs will be included? |
| 4–5 min | Download the pack and inspect its roster, references, and manifest. | Does the pack match the chosen scope, and would it help with the actual deliverable? |

To build the roster, create a group, paste ORCID iDs or links in its bulk-add
control, review the preview, and explicitly start importing. Pasted Markdown
links and whitespace, comma, or semicolon separators are supported. Repeated
iDs count once, with a limit of 50 unique entries. Existing imported profiles
can be reused without refreshing. Inspect each result: failed entries are not
added to the group, and retrying failures preserves successful additions.
Cancellation takes effect between records. The **+** control on People cards
also adds an imported researcher to an existing group.

Reload the browser and confirm that the roster, local member details, project
selections, and request status persist. Separately, restart the server with the
same data path to check that the workspace survives a process restart.

For an optional live-data test, import an ORCID iD or link, inspect the public
record, and refresh it manually. The first import is a baseline: existing works
appear in the researcher's outputs but do not become new feed events. A refresh
of an unchanged record should add no events. An older work first observed on a
later refresh is an added-to-record update, not a newly published paper. Do not
edit a real ORCID record just to manufacture a test update.

## What this pilot does and does not establish

- Importing a public record follows it locally; it does not authenticate its
  holder, notify them, or claim that they joined this application.
- Groups are locally curated rosters. Membership is unconfirmed. Roles,
  expertise, contributions, and project selections record the local coordinator's
  decisions; they are not verified statements or changes to anyone's ORCID.
- Member outputs are suggestions until selected for the project collection.
  Team packs can contain the selected project collection or all member outputs;
  neither constitutes researcher-confirmed project attribution. Check the scope
  and filters in the pack's manifest before sharing.
- Export date filters use publication dates, not import dates. Partially known
  dates are included when their possible date interval overlaps the chosen
  range; undated outputs are excluded when a date bound is set. The manifest
  records this policy. A member with no public works can still appear in the
  roster and receive local details and requests.
- Requests are local coordination notes. Assigning an owner or deadline does
  not notify that person or establish that they accepted the task. Local notes
  and roster details can be included in exports; review the pack before sharing.
  Exported group metadata includes requests owned by chosen members and
  unassigned requests. Publication-date filters do not filter those requests.
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

For the first five participants, aim for four to complete project-output
selection and scoped group export without assistance. Record task completion, time,
errors, and help needed. Every participant should understand that sample data
are fictional, roster membership is unconfirmed, and an observed update is not
necessarily a recent publication. Misunderstandings here require a design fix.

Ask one coordinator to prepare a small real team report using the exported pack
and compare elapsed time and corrections with their usual process. Record
missing public data separately from interface failures. During a one-week follow-up,
record whether the coordinator returns to update outputs or resolve requests;
these are observations to collect, not claims already demonstrated.

Feedback prompts:

1. What would bring you back next week?
2. Which information or label was confusing or missing?
3. What would you change before using this team pack in a report?
4. Which matters most next: shared groups, sign-in, a digest, or better exports?

Add observations and reproducible failures to
[milestone #8](https://github.com/dhuzard/orcid-playground/issues/8), including the view,
steps, expected result, actual result, and whether the data were sample or live.
The developer contract is in [network-api.md](network-api.md), with the working-group
extension in [group-workflow-api.md](group-workflow-api.md).

After the local test, a separate hosted milestone can add ORCID sign-in, shared
accounts, accepted invitations, permissions, and visibility controls. The local
pilot does not require an API client registration or a callback URL.
