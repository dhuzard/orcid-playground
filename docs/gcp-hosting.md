# Hosting a shareable version on GCP

Status: in-browser playground on Firebase Hosting project `orcid-playground-889` (BACKLOG INF-08, INF-10); shared multi-researcher service **designed, not built** (INF-09).

## What the site is

A static site whose code runs in the visitor's browser:

- `/` **Studio**: any public ORCID iD, the stored sample, or the signed-in visitor's own record, rendered into every single-record output.
- `/network/` **Research network**: the unchanged pilot app (`web/network/app.js`). `network-bridge.js` answers its `/api/*` calls from the in-browser engine instead of a server.
- `/group/` **Group view**: a link carrying a group name and public ORCID iDs in the URL fragment, which is never sent to a server. It is read only on request and shows an evidence-backed collaboration graph (an edge exists only when both records assert the same DOI), shared outputs, record health for coordinators (each member's record check, issues ranked by how many members share them), a draft team biosketch in ERC/Horizon/NIH format, Group Wrapped, a printable card deck, an embeddable snapshot for the `<orcid-group>` widget, a group heatmap and a merged bibliography.
- `sw.js` makes the site installable and usable offline: site files network-first, the pinned runtime cache-first in a cache kept across deploys, the ORCID API never intercepted. The build stamps it with a digest of the site so every deploy refreshes the cache.
- `orcid-group.js` and `orcid-biosketch.js` are served with `Access-Control-Allow-Origin: *` so other sites can load them as modules. The network app's "Share & visualise" builds such a link from a group's real iDs; sample people are never included.
- `engine.js` is a Web Worker that loads Pyodide from this site (`/pyodide/0.26.4/`, each file checked against a pinned SHA-256 by `scripts/build_site.py`) and the package from `py/orcid_biosketch.zip`. It patches `urllib` with a synchronous XHR restricted to `pub.orcid.org`, so `fetch_orcid_record` runs unchanged (`orcid_biosketch.playground`).
- The network workspace is the pilot's SQLite file on an IndexedDB-backed filesystem. It never leaves that browser, and each visitor has their own; "Clear this workspace" deletes it.

What may be hosted, and what may not:

- Hosted: public `generated/*` outputs, the web pages and the package source. `scripts/build_site.py` copies nothing else.
- Never hosted: a server-side workspace or the loopback server itself. It has no authentication, and a shared copy would publish curated rosters (issues #6, #8, #9). The same goes for roster exports (`orcid_biosketch.roster`) and any ORCID token; public reads need none.

The CSP allows only `self`, `pub.orcid.org` and ORCID's JWKS, plus `wasm-unsafe-eval`; `unsafe-eval` is not needed and no third-party script runs. Generated SVGs contain untrusted ORCID text, so they are shown through `<img>` with blob URLs and never inlined.

## Sign in with ORCID (optional)

Sign-in is optional; typing an iD works without it. The button stays hidden until a client id is configured (BACKLOG INF-11).

### How it works

- OpenID Connect **implicit flow** against `https://orcid.org/oauth/authorize` with `response_type=id_token token`, `scope=openid`, a random `state` and `nonce` (kept in `sessionStorage` for the tab) and `redirect_uri` = the site origin plus `/`.
- ORCID documents the implicit flow only for the `token` and `id_token token` response types with the `openid` scope, accepts `nonce`, and returns the values in the URL fragment ([ORCID OpenID Connect technical documentation](https://github.com/ORCID/ORCID-Source/blob/main/orcid-web/ORCID_AUTH_WITH_OPENID_CONNECT.md), linked from the [ORCID OpenID FAQ](https://info.orcid.org/faq/what-is-openid)). Bare `id_token` is listed in the [discovery document](https://orcid.org/.well-known/openid-configuration) but not in that documentation, so it is not used.
- The browser verifies the ID token's RS256 signature against `https://orcid.org/oauth/jwks` (key chosen by the token's `kid`) and checks `iss` = `https://orcid.org`, `aud` = the client id, `nonce`, and `exp` (5 minutes of clock skew allowed; ORCID tokens live 10 minutes). It keeps only `sub` (the ORCID iD) and `given_name` + `family_name`, in `sessionStorage`.
- The short-lived access token that comes with `id_token token` is never read, stored or used; the whole fragment is removed from the address bar at once.
- An `error` in the fragment (with the tab's `state`) or in the query string (while a sign-in is pending) is shown as "cancelled or refused".
- `web/playground/auth.test.mjs` covers this offline with locally generated keys and signed tokens.

A signed-in iD proves only that the visitor controls that ORCID account at that moment. It does not verify anything the record asserts.

### Register the ORCID Public API client (free, once)

The client belongs to the ORCID record of whoever registers it and cannot be transferred. The Public API is free for non-commercial use only ([Registering a Public API client](https://info.orcid.org/documentation/integration-guide/registering-a-public-api-client/)).

1. Sign in at <https://orcid.org/signin> with the ORCID account that should own the client.
2. Make sure the account has a **verified email address**. Developer Tools stays locked until it does; ORCID offers to resend the verification email.
3. Open the menu under your name (top right) and choose **Developer tools** (<https://orcid.org/developer-tools>).
4. Read and accept the ORCID Public API Terms of Service, then click **Register for ORCID Public API Credentials** (the label may differ slightly).
5. Fill in the form:
   - **Name**: `ORCID Playground` (shown to people on the ORCID consent screen).
   - **Application URL** (website): `https://orcid-playground-889.web.app/`
   - **Description**: for example `Optional sign-in for an in-browser playground that renders a researcher's public ORCID record into biosketches. Only the ORCID iD and name from the signed ID token are used, in the visitor's browser tab; nothing is stored on a server.`
   - **Redirect URIs**: exactly `https://orcid-playground-889.web.app/` (HTTPS, with the trailing `/`).
6. Click **Save my application and generate my client ID and secret** and copy the **Client ID** (`APP-` followed by 16 characters).

Redirect URI rules ([API tutorial: get an authenticated ORCID iD](https://info.orcid.org/documentation/api-tutorials/api-tutorial-get-and-authenticated-orcid-id/)): only HTTPS is accepted in production; the domain must match exactly, including subdomains, and each subdomain must be registered separately; a host-only registration allows any path on that host, but registering the full URI is recommended. The site always sends `${location.origin}/`, so for the live site that is exactly `https://orcid-playground-889.web.app/`.

Preview channels are served from other hostnames (`orcid-playground-889--<channel>-<hash>.web.app`), and a channel's hostname changes when it expires and is recreated. Add a preview URL (with its trailing `/`) only when you want to test sign-in there, and remove it afterwards. The alternative domain `orcid-playground-889.firebaseapp.com` would also need its own entry; it is not used.

What is public and what is not:

- The **client id** is public. It ends up in `config.json` and in every authorize URL.
- The **client secret** is not needed by the implicit flow. Never put it in the repository, a repository variable, a secret used by this site, `config.json` or an issue. If it is ever exposed, reset it in Developer Tools.

### Turn it on

```bash
gh variable set ORCID_CLIENT_ID --repo dhuzard/orcid-playground --body APP-XXXXXXXXXXXXXXXX
gh workflow run deploy-hosting.yml --repo dhuzard/orcid-playground --ref main -f channel=live
```

Pushes to `main` deploy only the preview channel, so the live site needs the manual `channel=live` run. The build writes the id into `config.json`; an empty value hides the button again. Check it with `curl -s https://orcid-playground-889.web.app/config.json`.

### Manual test on the live site

1. Open <https://orcid-playground-889.web.app/> in a private window. **Sign in with ORCID** appears top right. If not, check `config.json` and that the live deploy ran.
2. Click it. ORCID's sign-in page opens and the address bar shows `response_type=id_token+token`, `scope=openid` and `redirect_uri=https%3A%2F%2Forcid-playground-889.web.app%2F`. A redirect URI error here means the registered URI does not match exactly.
3. Sign in and authorize. You return to the Studio with your name (or iD) top right, the **My record** chip, and your public record loading. The address bar has no `#` fragment left.
4. In DevTools, the Network tab shows one request to `https://orcid.org/oauth/jwks` and no CSP errors in the Console; Application > Session Storage holds `orcid-playground-signin` with only `orcid` and `name`.
5. Click **Sign out**: the button returns. Sign in again and click **Deny** on ORCID's consent screen: you should return with "ORCID sign-in was cancelled or refused." and not be signed in. ORCID does not document where a denial is reported, so if you land elsewhere, note the URL (without any token) in issue #14.

Then tick the INF-11 criteria in `BACKLOG.md` with the date and deploy run.

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
