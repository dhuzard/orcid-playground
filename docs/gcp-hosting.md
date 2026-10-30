# Hosting a shareable version on GCP

Status: in-browser playground on Firebase Hosting project `orcid-playground-889` (BACKLOG INF-08, INF-10); shared multi-researcher service **designed, not built** (INF-09).

## What the site is

A static site whose code runs in the visitor's browser:

- `/` **Studio**: any public ORCID iD, the stored sample, or the signed-in visitor's own record, rendered into every single-record output.
- `/network/` **Research network**: the unchanged pilot app (`web/network/app.js`). `network-bridge.js` answers its `/api/*` calls from the in-browser engine instead of a server.
- `engine.js` is a Web Worker that loads Pyodide from jsDelivr and the package from `py/orcid_biosketch.zip`. It patches `urllib` with a synchronous XHR restricted to `pub.orcid.org`, so `fetch_orcid_record` runs unchanged (`orcid_biosketch.playground`).
- The network workspace is the pilot's SQLite file on an IndexedDB-backed filesystem. It never leaves that browser, and each visitor has their own; "Clear this workspace" deletes it.

What may be hosted, and what may not:

- Hosted: public `generated/*` outputs, the web pages and the package source. `scripts/build_site.py` copies nothing else.
- Never hosted: a server-side workspace or the loopback server itself. It has no authentication, and a shared copy would publish curated rosters (issues #6, #8, #9). The same goes for roster exports (`orcid_biosketch.roster`) and any ORCID token; public reads need none.

The CSP allows only `self`, Pyodide on jsDelivr, `pub.orcid.org` and ORCID's JWKS, plus `wasm-unsafe-eval`; `unsafe-eval` is not needed. Generated SVGs contain untrusted ORCID text, so they are shown through `<img>` with blob URLs and never inlined.

## Sign in with ORCID (optional)

Sign-in is optional; typing an iD works without it. It uses the OpenID Connect implicit flow (`response_type=id_token`, `scope=openid`). The browser verifies the ID token's RS256 signature against `https://orcid.org/oauth/jwks` and checks the issuer, audience, nonce and expiry. Only the iD and name are kept, in `sessionStorage`; no access token is requested.

1. On <https://orcid.org/developer-tools>, register a **Public API** client while signed in with the ORCID account that should own it.
2. Add these redirect URIs: `https://orcid-playground-889.web.app/` and the preview channel URL printed by the deploy run, with its trailing `/`.
3. Set the GitHub repository variable `ORCID_CLIENT_ID` to the client ID (`APP-…`). It is public, not a secret. The build writes it into `config.json`; when it is empty, the sign-in button is hidden.

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
4. Authenticate with **Workload Identity Federation** (`google-github-actions/auth`) restricted to this repository; the workflow itself refuses to deploy anything but `main` to the live channel. No service-account JSON keys in GitHub secrets.
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

Project: `orcid-playground-889` (Firebase site `orcid-playground-889.web.app`). Run `scripts/gcp_setup.sh` as a project owner; it does everything below and prints the three GitHub variables to set. The commands are kept here for reference.

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

This is a shared, server-backed version of the network pilot (merged from PR #7) and issue #6's shared-service milestone. **It must not be deployed by pointing Cloud Run at the pilot as it is.** The pilot deliberately refuses any bind address except `127.0.0.1` ("shared hosting requires authentication"), has one workspace, no accounts and a local SQLite file. Removing that guard would publish group rosters to anyone with the URL.

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

The in-browser playground already covers individual use; this service is only needed for workspaces shared between people. Prerequisites, in order: coordinator feedback in #8; add auth, workspace isolation and a storage interface to the pilot; add a Dockerfile and tests that assert the service refuses unauthenticated requests; only then add a Cloud Run deploy workflow (INF-09).
