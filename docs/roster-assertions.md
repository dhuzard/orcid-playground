# Roster assertion export (contract 0.1.0)

A researcher can export a local working group as a list of **asserted
identifiers**: who they listed, which ORCID iD they typed or imported, which
outputs they selected, and which CRediT roles a source declared or they
confirmed. The contract is
[`schema/roster-assertion.schema.json`](../schema/roster-assertion.schema.json);
the builder, validator and a reference consumer live in
`orcid_biosketch.roster`.

The export is **inert**. It is not an authorization server, not proof of
membership and not a substitute for ORCID OAuth. Every document carries a fixed
statement of what importing it does:

```json
"access_effect": {"grants": "none", "invitations": "none", "accounts": "none",
                  "authorship": "not-implied", "credit": "not-inferred"}
```

Status: contract, fixtures and tests only. Nothing in this repository writes
roster exports during sync, and wiring them into private production workflows
waits for the ORAtlas security model (dhuzard/oratlas#202).

## What each fact means

| Fact | Values | Meaning |
|---|---|---|
| Assertion `basis` | `public-orcid-record` | Read from the public ORCID record, with its record version |
| | `owner-curated` | Entered or chosen by the group creator |
| | `external-verified` | Checked by another platform; never produced by an offline roster |
| ORCID `status` | `claimed` | Typed or imported; nobody authenticated |
| | `oauth-verified` | The holder signed in with ORCID OAuth on a shared service (future, ORAtlas #203) |
| Membership `status` | `listed-member` | The creator put this person on the list. That is all |
| | `verified-invitation-accepted`, `active-member-per-source` | Reserved for `origin: external-platform` with external evidence |
| Contribution `status` | `source-declared` | Transcribed from a source's own contribution statement; needs a reference |
| | `curator-confirmed` | Confirmed by a named curator for that output |

`local_role` is a free-text label from the local group. It is never mapped to a
CRediT role or an access role. CRediT roles are never derived from ORCID
coauthorship, roster membership or public works: a group with no recorded
contributions exports none.

An offline roster (`origin: local-offline-roster`) can never carry an
OAuth-verified iD, an accepted invitation, active membership or any
`external-verified` assertion. The builder refuses to produce them and the
validator rejects them.

## Privacy defaults

- Export requires the group creator's recorded opt-in (`consent.status:
  granted`, `granted_by` = creator). Without it, nothing is exported.
- `distribution` is always `private-recipient-only`; there is no public roster.
- Members marked `private` are omitted entirely, including from counts and
  contributions, even when selected explicitly.
- By default only the ORCID iD is shared; `display_name` and `local_role` must
  be requested. Fields not chosen are `null`, and `redaction.member_fields`
  records the choice.
- Outputs are included only when selected and when their reuse rights are
  `public-orcid-record` or `owner-provided`; others are dropped and only a
  reason code is kept.
- Project references are omitted unless requested, are always `proposed`, and
  a URL is kept only when `sharing_approved` is true.
- Revoking consent produces a content-free notice (`build_revocation`); a
  recipient must discard earlier copies. A revoked document that still carries
  members fails validation.
- The public biosketch, its feeds and `generated/` never read roster data.

## Integrity

`digest.value` is the SHA-256 of the canonical JSON (sorted keys, no
insignificant whitespace, UTF-8) of the document without `digest`.
`generated_at` and `export_id` come from the group's last change, so the same
group and options always produce the same bytes.

## Consuming an export (ORAtlas, Diggypaper)

1. Validate against the JSON Schema, then apply the semantic rules
   (`validate_export`, or an equivalent port).
2. Treat each member as a **candidate contact** for a team pack, never as an
   account, collaborator or grant. Joining a project still requires an
   authenticated local account and a project-controller-approved invitation.
3. Treat each contribution as a **credit claim** to review. Importing it does
   not confirm it in the consumer's own credit trail (ORAtlas #207).
4. On a revocation notice, discard the earlier export.

`candidate_contacts(document)` is the reference reading.
[`tests/fixtures/roster/demo-export.json`](../tests/fixtures/roster/demo-export.json)
and its expected reading
[`candidate-contacts.json`](../tests/fixtures/roster/candidate-contacts.json)
are the interoperability fixtures; both contain only synthetic people, ORCID's
documented example iDs and Crossref's `10.5555` test DOI prefix.

## Local group input

`build_export(group, members=None, outputs=None, fields=("orcid",),
include_project_references=False, sandbox=False)` reads a plain dictionary; see
[`tests/fixtures/roster/local-group.json`](../tests/fixtures/roster/local-group.json).
Adapting the network pilot's workspace (PR #7) to this shape is a follow-up.
