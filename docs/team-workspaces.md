# Private team workspaces (design)

Status: **built, partly deployed** (issue #22, milestone Playground v2). Firestore (`eur3`) is live with these rules, and the collection-group index exists. The exchange function waits for the **Blaze** plan; until it is deployed, the site hides team workspaces and sync.

## Goal

Each team gets a page at `/team/#<team-id>` that only its members can open. The page is built for a coordinator and the people they invite. It holds what the hosted playground deliberately keeps out of links and public files:
- roles, expertise and contributions;
- selected project outputs;
- requests and notes.

Public ORCID records are still read live in the browser, as everywhere else in the playground.

## Principles (from AGENTS.md)

- **Proven identity grants access, nothing else does.** A person enters a team only by signing in with ORCID *and* accepting an invitation addressed to that iD. Knowing a URL, a team id or someone's ORCID iD grants nothing (#9).
- **Private by default.** Team data never reaches the public site, `generated/`, group links, snapshots or feeds. Publishing anything requires a separate, explicit action by members.
- **Informed disclosure, recorded.** Before accepting, a member sees what the team stores about them and who can see it. The accepted disclosure version and time are stored on their membership.
- **Leaving is complete.** A member can leave at any time, and their entries about themselves are removed. A coordinator can remove a member or delete the team. Deletion is immediate in Firestore; backups are not kept.
- **EU only.** Firestore in `eur3` (multi-region EU) and the function in `europe-west1`.
- **Provenance.** Public facts keep their ORCID source. Team facts are labelled "recorded by <member> in <team>" and never presented as ORCID assertions.

## Architecture

```
browser (static site, strict CSP)
  1. ORCID OpenID sign-in (existing auth.js) ─► ORCID ID token
  2. POST /exchange  ─► Cloud Function (europe-west1)
        verifies the ID token (RS256, ORCID JWKS, iss, aud = our client id, exp)
        returns a Firebase custom token with uid = ORCID iD
  3. Identity Toolkit REST signInWithCustomToken ─► Firebase ID token (1 h, refreshable)
  4. Firestore REST with "Authorization: Bearer <Firebase ID token>"
        security rules decide every read and write (firestore.rules)
```

**Why custom tokens rather than Identity Platform's OIDC provider:**
- With custom tokens the user ID *is* the ORCID iD, so the rules stay simple (`request.auth.uid`).
- Identity Platform bills OIDC users beyond a small free tier; Firebase Auth custom tokens are free.
- The function is about 60 lines, stateless and has no secrets beyond Google's own service identity.
- No Firebase JavaScript SDK is needed. REST calls keep the CSP to `self` plus three Google API origins: `identitytoolkit.googleapis.com`, `securetoken.googleapis.com` and `firestore.googleapis.com`.

**Cost at pilot scale:** Firestore's free tier (50k reads and 20k writes per day), Cloud Functions' free tier (2M invocations per month) and free custom-token auth come to about €0 a month. Blaze is still required to deploy a function. A budget alert at €5 is part of the setup.

## Data model (Firestore)

```
teams/{teamId}
  name, description, createdBy (ORCID iD), createdAt
  coordinators: [ORCID iD, ...]            # never empty
teams/{teamId}/members/{orcid}             # one document per person, id = ORCID iD
  orcid, teamName, status: "invited" | "active", invitedBy, invitedAt,
  disclosure: { version, acceptedAt } | null
teams/{teamId}/entries/{entryId}           # roles, contributions, notes, requests, selected outputs
  kind, subject (ORCID iD or work id), text, author (ORCID iD), createdAt, updatedAt
```

There is one document per member, not a map inside the team document, because Firestore rules cannot loop over a map. With separate documents, every rule checks exactly one membership. Invitees find their invitations with a collection-group query on `members` filtered by `orcid`.

## Access rules

These are enforced in [`firestore.rules`](../firestore.rules) and tested in the emulator by [`tests/rules/teams.test.mjs`](../tests/rules/teams.test.mjs) (16 cases).

| Who | team | members | entries |
|---|---|---|---|
| Not signed in, or a user id that is not an ORCID iD | – | – | – |
| Signed in, knows the team id or members' iDs | – | – | – |
| Invited | – | read own invitation; accept (with disclosure) or decline | – |
| Active member | read | read all; leave | read all; write own; delete own or about themselves |
| Coordinator | read, rename, promote active members, delete | invite (always as `invited`), remove | delete any |

- A team is created in one batch together with the creator's own active membership, so the creator is always its first coordinator.
- Only the invitee can turn `invited` into `active`, and only with a recorded disclosure. A coordinator cannot add anyone as already active.
- Coordinators must be demoted before they can leave or be removed, and the coordinator list can never be empty. A team therefore always has an owner.
- Entries are typed (`role`, `contribution`, `note`, `request`, `output`), limited to 5,000 characters, and always written as yourself.

Run the tests (Java 11+ and Node 20+ required):

```bash
cd tests/rules && npm ci && npm test
```

On Windows, the emulator's Java process may outlive the run. If the next run says "port taken", stop the `cloud-firestore-emulator` Java process first. Inside VS Code, run with `VSCODE_CWD` unset (`env -u VSCODE_CWD npm test`): firebase-tools otherwise assumes it is running in its VS Code extension and cannot find its templates.

## Pages

- `/team/` lists your teams and invitations. It needs sign-in.
- `/team/#<team-id>` is the private page: members and their ORCID records, then roles and contributions, project outputs, requests, and the team pack built from team data plus public records.

## Delivery steps (issue #22)

1. ✅ Design and access rules: `firestore.rules`, with 19 emulator tests in `tests/rules/`, run in CI.
2. ✅ Firestore created in `eur3`, rules released (`scripts/deploy_rules.sh`), index on `members.orcid` (`firestore.indexes.json`), restricted browser API key.
3. ✅ ORCID sign-in live (INF-11).
4. ✅ Exchange function `functions/exchange` with 11 tests: forged, expired, other-audience, wrong-issuer and algorithm-confusion tokens, and foreign origins, are all refused.
5. ✅ `/team/` pages (`team.js`) and the REST client (`cloud.js`), plus personal sync (`sync.js`) in the network sidebar. Verified end to end against the Auth and Firestore emulators with three users (create, invite, outsider refused, accept with disclosure, notes, leave with deletion, delete team, save/clear/load workspace).
6. ⏳ Owner: Blaze billing on the project, and Firebase Authentication "Get started" once in the console.
7. ⏳ `scripts/deploy_backend.sh`, then the GitHub variables `ORCID_EXCHANGE_URL` and `FIREBASE_WEB_API_KEY`, then a site redeploy and a live test with two real ORCID accounts.
8. Security review before real team data; pilot with one team (#20). Member-confirmed membership (#23) builds on `status: "active"` and the disclosure record.

## Personal sync

`users/{orcid}/workspace/` holds the research-network workspace (the same export as "Download my workspace"), gzip-compressed and split into chunks of at most 800,000 characters, plus a manifest with a SHA-256 checksum. Only its owner can read or write it. Saving is explicit, with optional auto-save after changes. Loading verifies the checksum, shows a summary and asks before replacing the browser's workspace.
