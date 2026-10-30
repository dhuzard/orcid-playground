# Hosting a shareable version on GCP

Status: **strategy only, nothing deployed** (BACKLOG INF-08).

## What can be shared safely

Only the public, static outputs on `main`: `generated/*` (JSON, JSON-LD, Markdown, card, heatmap, wrapped, fortune), `web/orcid-biosketch.js` and a small demo `index.html`. These are derived from public ORCID assertions and are already public on GitHub.

Do **not** host:

- the local network/working-group pilot (PR #7). It is loopback-only, single-workspace, has no authentication and holds locally curated rosters. Hosting it would publish private group data and imply authentication that does not exist (see issues #6, #8, #9);
- roster exports (`orcid_biosketch.roster`), which are private by contract;
- any ORCID token. Public reads need none.

## Recommended: static site on Cloud Storage behind Cloud CDN

The site is static, so the cheapest and smallest-attack-surface option is a bucket, not a server.

| Option | Fit | Notes |
|---|---|---|
| **Cloud Storage + external HTTPS load balancer + Cloud CDN** | Best for a custom domain | Cost is a few euros per month, mostly the load balancer |
| **Firebase Hosting** (a GCP product) | Best for a quick shareable `*.web.app` URL | Free tier, managed TLS, one command deploy, preview channels for review |
| Cloud Run (nginx container) | Overkill now | Only worthwhile when a server component such as the network pilot becomes a shared service |

Start with **Firebase Hosting preview channels** to share a link this week, then move to bucket + CDN if a custom domain and IAM-governed hosting are wanted.

## Pipeline

1. `sync.yml` already regenerates `generated/` daily and commits it.
2. Add `deploy.yml`, triggered on push to `main` touching `generated/**` or `web/**` plus `workflow_dispatch`.
3. It assembles `site/` by copying `generated/`, `web/orcid-biosketch.js` and `examples/plain-html.html` as `index.html` (with the component `src` pointed at the relative `generated/biosketch.json`), then runs `gcloud storage rsync --delete-unmatched-destination-objects` (or `firebase deploy`).
4. Authenticate with **Workload Identity Federation** (`google-github-actions/auth`) restricted to this repo and branch. No service-account JSON keys in GitHub secrets.
5. The deploy service account gets only `roles/storage.objectAdmin` on the one bucket.

Note the CI-created commit from `sync.yml` uses `GITHUB_TOKEN`, which does not trigger other workflows. Either call the deploy as a final step of `sync.yml` or use `workflow_run`.

## Bucket settings

- Uniform bucket-level access; public read via the load balancer backend bucket rather than `allUsers` on the bucket where a custom domain is used.
- `Cache-Control: public, max-age=300` on JSON and `max-age=3600` on SVG. The daily sync makes longer caches pointless.
- CORS on `generated/*` allowing `GET` from sites that embed the component.
- Headers: `Content-Security-Policy: default-src 'self'; img-src 'self' data:; script-src 'self'`, `X-Content-Type-Options: nosniff`. SVGs are served as `image/svg+xml` and only embedded through `<img>`, never inlined, because ORCID text is untrusted.
- Pin the component by tag or commit rather than `@main` on the jsDelivr URL for any site you do not control.

## Decisions needed

1. Custom domain, or is a `*.web.app` URL enough for sharing?
2. GCP project and billing owner, and region (EU, given the author's location and GDPR).
3. Whether the showcase should stay a single researcher or become the multi-researcher service. The latter needs the shared-service milestone in #6 (OAuth, per-user authorisation, privacy controls) first, and is a Cloud Run + Firestore/Cloud SQL design, not this one.

## Later: hosting the network pilot

Out of scope until #6's shared-service milestone: ORCID OAuth, per-user authorisation, confirmed invitations, privacy controls, and an agreed ORCID API access/sync model for unattended monitoring. Then Cloud Run behind Identity-Aware Proxy or app-level OAuth, with managed storage replacing the local SQLite file.
