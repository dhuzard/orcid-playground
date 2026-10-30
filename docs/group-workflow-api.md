# Local working-group milestone

User chose a local pilot with a real ORCID roster. Extend the existing single
workspace; do not introduce fake identity verification, invitations or permissions.
All group roles, expertise and project attribution are locally recorded decisions.
Existing SQLite workspaces and API calls remain compatible.

## Group state extensions

Each group has defaults for:

```json
{
  "member_details": {"person-id": {"role":"", "expertise":"", "contribution":""}},
  "selected_work_ids": [],
  "requests": [{"id":"uuid", "title":"", "description":"", "owner_id":null, "due_date":"", "status":"open", "created_at":"ISO timestamp"}]
}
```

Selected outputs must be among current members' public works. Removing members or
refreshing records prunes unavailable selections/details and clears request owners
who leave the roster. DOI key migration preserves valid project selections.

## Additional HTTP endpoints (same X-Pilot-Request header)

- `POST /api/groups/members/add` `{id, member_ids}` atomically appends existing
  imported people without replacing other group metadata or roster entries.
- `POST /api/groups/member` `{id, person_id, role, expertise, contribution}` records
  local details (role max 120, expertise max 500, contribution max 1000 characters).
- `POST /api/groups/output` `{id, work_id, selected: boolean}` adds/removes one output.
- `POST /api/groups/requests` `{id, title, description, owner_id, due_date}` creates a
  request. Title max 160, description max 2000; owner optional current member;
  due_date empty or real YYYY-MM-DD. Server supplies UUID and created_at.
- `POST /api/groups/requests/update` `{id, request_id, status}` resolves/reopens it;
  status is `open` or `resolved` only. No notification is sent.
- POST successes return the full state, as before.
- `GET /api/groups/<id>/export?scope=project&from=YYYY-MM-DD&to=YYYY-MM-DD&members=id1,id2`
  adds optional export options. Default no query stays all-member legacy export.
  scope `project` uses only selected outputs; scope `members` uses all member works.
  Missing members parameter means all, explicit empty means no selected members
  and is rejected. Invalid dates/order/unknown members are rejected. Partial dates
  use interval overlap for filtering; unknown publication dates excluded when date
  bounds are set, explained in manifest. Roster/member biosketches use chosen people;
  bibliography and each biosketch works list use the selected scope/date window.
  Include a manifest describing source scope, filters and unconfirmed attribution.

## Python methods on NetworkStore

- `add_group_members(id, member_ids)`
- `set_group_member(id, person_id, role, expertise, contribution)`
- `select_group_work(id, work_id, selected)`
- `create_group_request(id, title, description, owner_id=None, due_date='')`
- `set_group_request_status(id, request_id, status)`
- `export_group(id, *, scope='members', date_from='', date_to='', member_ids=None)`

## Bulk roster UX

In the group view, paste ORCID iDs/URLs (support whitespace/comma/semicolon-separated
and pasted Markdown links; deduplicate IDs; ignore HTML `&#x20;` whitespace).
Preview valid and invalid entries before requests. Limit 50 unique entries.
Explicitly start imports; process one at a time using existing `/api/import`, then
append each successful id via `/api/groups/members/add`. Show per-entry result,
allow cancellation between records and retry failures without dropping successes.
Existing imported profiles may be reused (clearly label); do not re-fetch them
automatically. A failed import never inserts a placeholder or claims membership.

## UI

Group detail sections: Roster / Project outputs / Requests / Team pack.
Roster supports bulk addition and editable local member details. Outputs separate
selected project collection from suggested member works. Requests have title,
description, owner, due date and resolve/reopen. Team pack controls choose scope,
members and dates, with project scope the explicit default in the new form.
Preserve existing People + group picker; use atomic append endpoint for it.
