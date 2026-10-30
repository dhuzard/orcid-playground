#!/usr/bin/env bash
# One-time GCP setup for the static showcase (docs/gcp-hosting.md).
# Run once, by a project owner, after `gcloud auth login`. Idempotent where gcloud allows.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-neuronautix-506707}"   # GCP project IDs are lowercase
REPO="${REPO:-dhuzard/orcid-playground}"
SA="gh-deploy@${PROJECT_ID}.iam.gserviceaccount.com"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"

gcloud services enable firebasehosting.googleapis.com iamcredentials.googleapis.com \
  sts.googleapis.com cloudresourcemanager.googleapis.com --project "$PROJECT_ID"

gcloud iam service-accounts describe "$SA" --project "$PROJECT_ID" >/dev/null 2>&1 \
  || gcloud iam service-accounts create gh-deploy --project "$PROJECT_ID"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SA" --role=roles/firebasehosting.admin --condition=None >/dev/null

gcloud iam workload-identity-pools describe github --location=global --project "$PROJECT_ID" >/dev/null 2>&1 \
  || gcloud iam workload-identity-pools create github --location=global --project "$PROJECT_ID"
gcloud iam workload-identity-pools providers describe repo --location=global \
  --workload-identity-pool=github --project "$PROJECT_ID" >/dev/null 2>&1 \
  || gcloud iam workload-identity-pools providers create-oidc repo --location=global \
    --workload-identity-pool=github --project "$PROJECT_ID" \
    --issuer-uri=https://token.actions.githubusercontent.com \
    --attribute-mapping=google.subject=assertion.sub,attribute.repository=assertion.repository \
    --attribute-condition="assertion.repository=='${REPO}'"

gcloud iam service-accounts add-iam-policy-binding "$SA" --project "$PROJECT_ID" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/${REPO}" >/dev/null

echo "Firebase must also be enabled on the project (once): firebase projects:addfirebase ${PROJECT_ID}"
echo
echo "Set these GitHub repository variables (Settings > Secrets and variables > Actions > Variables):"
echo "  GCP_PROJECT_ID=${PROJECT_ID}"
echo "  GCP_DEPLOY_SERVICE_ACCOUNT=${SA}"
echo "  GCP_WORKLOAD_IDENTITY_PROVIDER=projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/providers/repo"
