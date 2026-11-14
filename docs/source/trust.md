# Provenance, limits and privacy

This project makes **asserted public ORCID data more usable**; it does not claim to establish an independently verified academic identity or scientific contribution.

## What is the source?

- Only fields publicly accessible from ORCID can be retrieved through the public API. Hidden or absent fields may not appear.
- A valid ORCID iD is a syntactically valid identifier, **not proof that the named person, employment, authorship or other assertions are genuine**.
- ORCID record data can contain duplicates, missing identifiers and incomplete dates. Downloads should be reviewed before use in a CV, funding submission or research information system.
- CLI-generated JSON preserves source and override provenance. The project does not deliberately fabricate credentials or fill missing accomplishments with language-model guesses.

## What is—and is not—a collaboration?

Public Group View joins two records **only when the same DOI is listed in both public records**. This documents a co-assertion of one output, not a verified author relationship, real-world collaboration, project participation or consent. Some true colleagues will not be connected if records or DOIs are incomplete.

## Data flow by feature

| Feature | Where information lives | External interactions |
| --- | --- | --- |
| Explore (Studio) and Public Group View | Computation in your browser; downloaded exports on your device | Public ORCID API when you request a live record; hosted site serves code/runtime |
| My Network: People, Contacts, local curated Groups | A workspace in your browser (IndexedDB/local browser storage) | Public ORCID API on requested import/refresh |
| Browser workspace backup | Unencrypted file downloaded to your device; includes Contacts notes, tags and follow-ups | No automatic upload of the file; users control sharing |
| Encrypted team package | Password-encrypted file downloaded to your device; group details and members' public records, **no Contacts notes** | No automatic upload; anyone with the file and password can read it |
| Shareable Group view link | The URL fragment: group name and public ORCID iDs only | Recipients' browsers read the public ORCID records; the link is as public as where you post it |
| Static group snapshot / web component | Files on the website where you publish them | Public by design |
| Optional ORCID sign-in | Tab-scoped authentication state | ORCID authorization and public keys |
| Private Teams / personal cloud sync **when activated** | Google Cloud Firestore in an EU region, subject to team access rules | ORCID sign-in, token-exchange endpoint and Firebase/Firestore API |
| Python CLI / local network pilot | Local files and (for the network pilot) a local SQLite database | Optional public ORCID API calls |

**Current release qualification (14 November 2026):** The Teams backend code, access rules and tests exist, but repository deployment notes say the cloud exchange endpoint awaits production activation. Private Teams and cloud sync are **not available** on the hosted site until a successful live test and a security review are recorded. The browser-local My Network, its local curated Groups and manual backups are distinct from cloud Teams. Features listed above as hosted are deployed with the site, but none has yet been signed off as verified on the live deploy. The [claims and privacy audit](https://github.com/dhuzard/science-record-player/blob/main/communications/claims-privacy-audit.md) keeps the per-feature availability matrix.

## What should never be published inadvertently?

- Your workspace backup may include locally entered **contact notes, tags, meeting dates, roles, group selections, requests and follow-ups**.
- Password-protected encrypted group packages can be decrypted by anyone with **both** the package and its password. The file is not proof of member consent or a secure identity-verification mechanism.
- Shareable Group view URLs disclose the **group name and public ORCID iDs** to those who receive the URL; they deliberately exclude local annotations.
- Static embeddable group snapshots are public to anyone accessing the website where you post them.

## Independence and attribution

**{{ disclaimer }}** {{ brand }} is developed and maintained independently by {{ owner }} under the {{ license }} license. It does not write to public ORCID records. {{ trademark }} Refer to [the official ORCID Public API documentation](https://info.orcid.org/what-is-orcid/services/public-api/) and [ORCID brand guidance](https://info.orcid.org/brand-guidelines/) for terms and proper attribution.

For a methodological discussion or to report a misleading assertion, please [send feedback](feedback.md).
