# Local network pilot contract

Implementation coordination contract for epic #6. The pilot is one local workspace,
not authenticated multi-user hosting. Bind to 127.0.0.1 only. No scheduled polling.

## HTTP

- `GET /api/state` returns the state below.
- `POST /api/demo` adds sample profiles/group idempotently (does not overwrite real data).
- `POST /api/import` `{orcid}` imports or refreshes a public record. First import
  follows it; subsequent refreshes preserve the follow preference.
- `POST /api/follow` `{id, following: boolean}`.
- `POST /api/save` `{id, saved: boolean}` (work id).
- `POST /api/groups` `{name, description, member_ids: []}` creates a group.
- `POST /api/groups/update` `{id, name, description, member_ids: []}` updates a group.
- `GET /api/groups/<id>/export` downloads a ZIP team pack.
- All POST successes return the entire state; failures return `{error: string}`.
- Browser requests send `X-Pilot-Request: 1`; server validates Host/Origin and JSON.

State shape (all arrays always present):

```json
{
  "people": [{"id":"ORCID or demo-ada", "name":"Name", "orcid":null, "headline":"", "affiliation":"", "keywords":[], "demo":true, "following":true, "last_checked":"ISO timestamp", "work_count":2}],
  "works": [{"id":"stable key", "title":"", "type":"journal-article", "date":"2024-01", "doi":"", "url":"", "people_ids":[], "saved":false, "demo":true}],
  "events": [{"id":"stable key", "work_id":"work key", "kind":"work-added", "observed_at":"ISO timestamp", "people_ids":[], "demo":true}],
  "groups": [{"id":"uuid", "name":"", "description":"", "member_ids":[], "created_at":"ISO timestamp"}]
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

## Python model interface

`network_store.py`: `NetworkStore(path)` with `state()`, `add_demo()`,
`import_biosketch(bio)` (normalised biosketch from core),
`follow(id, following)`, `save(id, saved)`,
`create_group(name, description, member_ids)`,
`update_group(id, name, description, member_ids)`, `export_group(id) -> bytes`.
Persistence is a SQLite file (default `.local/network.sqlite3`).
Mutation methods need not return state; HTTP adapter calls state afterwards.
Invalid inputs raise ValueError. Model handles atomic persistence and concurrency.
Store retains normalized biosketches for existing exporter reuse.
