# Local network pilot contract

Implementation coordination contract for [epic #6](https://github.com/dhuzard/orcid-playground/issues/6). The pilot is one local workspace,
not authenticated multi-user hosting. Bind to 127.0.0.1 only. No scheduled polling.
The local working-group extension is implemented and locally verified under
[milestone #8](https://github.com/dhuzard/orcid-playground/issues/8); its detailed
validation and bulk-import contract is [group-workflow-api.md](group-workflow-api.md).

## HTTP

- `GET /api/state` returns the state below.
- `POST /api/demo` adds sample profiles/group idempotently (does not overwrite real data).
- `POST /api/import` `{orcid}` imports or refreshes a public record. First import
  follows it; subsequent refreshes preserve the follow preference.
- `POST /api/follow` `{id, following: boolean}`.
- `POST /api/save` `{id, saved: boolean}` (work id).
- `POST /api/groups` `{name, description, member_ids: []}` creates a group.
- `POST /api/groups/update` `{id, name, description, member_ids: []}` updates a group.
- `POST /api/groups/members/add` `{id, member_ids: []}` appends imported people atomically.
- `POST /api/groups/member` `{id, person_id, role, expertise, contribution}` records local member details.
- `POST /api/groups/output` `{id, work_id, selected: boolean}` selects or removes a project output.
- `POST /api/groups/requests` `{id, title, description, owner_id, due_date}` creates a local request.
- `POST /api/groups/requests/update` `{id, request_id, status}` resolves or reopens a request.
- `GET /api/groups/<id>/export` downloads a ZIP team pack. Optional query parameters:
  `scope=project|members`, `from=YYYY-MM-DD`, `to=YYYY-MM-DD`, and comma-separated
  `members`. Without parameters, the legacy all-member export remains available.
  The new UI explicitly defaults to project scope. Invalid dates, reversed ranges,
  unknown members, and an explicitly empty member selection are rejected.
- All POST successes return the entire state; failures return `{error: string}`.
- Browser requests send `X-Pilot-Request: 1`; server validates Host/Origin and JSON.

State shape (all arrays always present):

```json
{
  "people": [{"id":"ORCID or demo-ada", "name":"Name", "orcid":null, "headline":"", "affiliation":"", "keywords":[], "demo":true, "following":true, "last_checked":"ISO timestamp", "work_count":2}],
  "works": [{"id":"stable key", "title":"", "type":"journal-article", "date":"2024-01", "doi":"", "url":"", "people_ids":[], "saved":false, "demo":true}],
  "events": [{"id":"stable key", "work_id":"work key", "kind":"work-added", "observed_at":"ISO timestamp", "people_ids":[], "demo":true}],
  "groups": [{"id":"uuid", "name":"", "description":"", "member_ids":[], "member_details":{}, "selected_work_ids":[], "requests":[], "created_at":"ISO timestamp"}]
}
```

Feed uses events associated with followed researchers. Event `people_ids` identifies
researchers for whom an addition was observed; work `people_ids` identifies all
current record associations. First real import produces
no events (baseline); subsequent new works produce `work-added` events. Initial
demo data has illustrative events explicitly marked demo. Work publication date
and time observed are separate. Shared DOI works are deduplicated, all associated
people remain visible. All works can be browsed through People/Saved/Groups even
when there are no new events. Rosters are locally curated, unconfirmed membership.
`member_details` maps a current person's id to local `role`, `expertise`, and
`contribution` strings. These do not modify ORCID records or imply self-declared
credentials. `selected_work_ids` records local project selections from current
member works. Requests contain `id`, `title`, `description`, optional `owner_id`,
`due_date`, `status`, and `created_at`; they send no notifications.

Roster removal or record refresh prunes unavailable selections/details and
clears request owners who leave. DOI key migration preserves valid selections.
Export scope, chosen members, and date filters apply to bibliography and
biosketch works. Date filtering uses interval overlap for partial dates and
excludes undated works when date bounds are set; the manifest states this policy
and the local, unconfirmed nature of project attribution.
The exported `group.json` contains only chosen members, their details, and
exported project selections. Requests are included when unassigned or owned by
a chosen member; publication-date filters do not filter requests. The manifest
records this metadata policy as well.

## Python model interface

`network_store.py`: `NetworkStore(path)` with `state()`, `add_demo()`,
`import_biosketch(bio)` (normalised biosketch from core),
`follow(id, following)`, `save(id, saved)`,
`create_group(name, description, member_ids)`,
`update_group(id, name, description, member_ids)`,
`add_group_members(id, member_ids)`,
`set_group_member(id, person_id, role, expertise, contribution)`,
`select_group_work(id, work_id, selected)`,
`create_group_request(id, title, description, owner_id=None, due_date='')`,
`set_group_request_status(id, request_id, status)`,
`export_group(id, *, scope='members', date_from='', date_to='', member_ids=None) -> bytes`.
Persistence is a SQLite file (default `.local/network.sqlite3`).
Mutation methods need not return state; HTTP adapter calls state afterwards.
Invalid inputs raise ValueError. Model handles atomic persistence and concurrency.
Store retains normalized biosketches for existing exporter reuse.
