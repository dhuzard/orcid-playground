# Hosting a shareable version on GCP

Status: static showcase pipeline **built but not yet run** (needs the GCP setup below); multi-researcher service **designed, not built** (BACKLOG INF-08, INF-09).

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

## Decisions taken

- Share through **Firebase Hosting preview channels** first (30-day expiry, `*.web.app` URL). Promote to `live` by running the workflow manually with `channel=live`.
- Region: **EU**. Firebase Hosting itself is served from Google's global CDN and has no region setting. The EU choice applies to everything that stores data: Cloud Run `europe-west1`, Firestore/Cloud SQL `eur3`/`europe-west1`, buckets `EU`.

## One-time GCP setup for the static showcase

Project: `neuronautix-506707`. Run `scripts/gcp_setup.sh` as a project owner; it does everything below and prints the three GitHub variables to set. The commands are kept here for reference.

```bash
gcloud projects create PROJECT_ID && gcloud billing projects link PROJECT_ID --billing-account=ACCOUNT
gcloud services enable firebasehosting.googleapis.com iamcredentials.googleapis.com --project PROJECT_ID
firebase projects:addfirebase PROJECT_ID
gcloud iam service-accounts create gh-deploy --project PROJECT_ID
gcloud projects add-iam-policy-binding PROJECT_ID --member=serviceAccount:gh-deploy@PROJECT_ID.iam.gserviceaccount.com --role=roles/firebasehosting.admin
gcloud iam workload-identity-pools create github --location=global --project PROJECT_ID
gcloud iam workload-identity-pools providers create-oidc repo --location=global --workload-identity-pool=github \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping=google.subject=assertion.sub,attribute.repository=assertion.repository \
  --attribute-condition="assertion.repository=='dhuzard/orcid-playground'" --project PROJECT_ID
gcloud iam service-accounts add-iam-policy-binding gh-deploy@PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/dhuzard/orcid-playground"
```

Then set these GitHub repository **variables** (not secrets, none are sensitive): `GCP_PROJECT_ID`, `GCP_WORKLOAD_IDENTITY_PROVIDER` (`projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/repo`) and `GCP_DEPLOY_SERVICE_ACCOUNT`. `.github/workflows/deploy-hosting.yml` builds `site/` with `scripts/build_site.py` and deploys it; `firebase.json` carries the CSP and cache headers.

## Multi-researcher service (designed, not built)

This is the hosted version of the network pilot in draft PR #7 and issue #6's shared-service milestone. **It must not be deployed by pointing Cloud Run at the pilot as it is.** The pilot deliberately refuses any bind address except `127.0.0.1` ("shared hosting requires authentication"), has one workspace, no accounts and a local SQLite file. Removing that guard would publish group rosters to anyone with the URL.

Target architecture, all in the EU:

| Concern | Choice |
|---|---|
| Compute | Cloud Run `europe-west1`, deployed with `--no-allow-unauthenticated` until app-level auth exists |
| Identity | ORCID OAuth (public client, `/authenticate` scope only) in the app; Identity-Aware Proxy as a stop-gap allow-list for the coordinator pilot |
| Authorisation | Per-user workspaces; an ORCID iD identifies a person and never grants access to a group or project (issue #9) |
| State | Firestore (`eur3`) or Cloud SQL Postgres, replacing SQLite; one workspace document per user, explicit consent and revocation records |
| Secrets | Secret Manager for the OAuth client secret; no ORCID tokens in the repo |
| ORCID API | Explicit, rate-limited, on-request imports only. No unattended polling until the API access/sync model in #6 is agreed with ORCID |
| Privacy | Rosters and project data private by default; never written to `generated/`, the static site or the feed; informed disclosure per #9 and `AGENTS.md` |
| Delivery | Separate workflow, `workflow_dispatch` only, same Workload Identity Federation |

Prerequisites, in order: merge PR #7 after the coordinator feedback in #8; add auth, workspace isolation and a storage interface to the pilot; add a Dockerfile and tests that assert the service refuses unauthenticated requests; only then add a Cloud Run deploy workflow (INF-09).
