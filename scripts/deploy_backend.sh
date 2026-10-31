#!/usr/bin/env bash
# Deploy the team-workspace backend (docs/team-workspaces.md): Firestore rules and the
# ORCID token-exchange function. Run by a project owner after `gcloud auth login`.
# Requires the Blaze plan (Cloud Functions). Idempotent.
set -euo pipefail
PROJECT_ID="${PROJECT_ID:-orcid-playground-889}"
REGION="${REGION:-europe-west1}"
ORCID_CLIENT_ID="${ORCID_CLIENT_ID:?set ORCID_CLIENT_ID to the ORCID public client id (APP-...)}"
SA="exchange-fn@${PROJECT_ID}.iam.gserviceaccount.com"
cd "$(dirname "$0")/.."

gcloud services enable cloudfunctions.googleapis.com run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com iamcredentials.googleapis.com --project "$PROJECT_ID"

# A dedicated identity whose only power is signing custom tokens as itself.
gcloud iam service-accounts describe "$SA" --project "$PROJECT_ID" >/dev/null 2>&1 \
  || gcloud iam service-accounts create exchange-fn --project "$PROJECT_ID" --display-name "ORCID token exchange"
gcloud iam service-accounts add-iam-policy-binding "$SA" --project "$PROJECT_ID" \
  --member "serviceAccount:$SA" --role roles/iam.serviceAccountTokenCreator >/dev/null

PROJECT_ID="$PROJECT_ID" scripts/deploy_rules.sh

gcloud functions deploy exchange --gen2 --project "$PROJECT_ID" --region "$REGION" \
  --runtime python312 --source functions/exchange --entry-point exchange --trigger-http \
  --allow-unauthenticated --service-account "$SA" --max-instances 3 --memory 256Mi --timeout 15s \
  --set-env-vars "ORCID_CLIENT_ID=${ORCID_CLIENT_ID}"

echo "Exchange URL: https://${REGION}-${PROJECT_ID}.cloudfunctions.net/exchange"
echo "Set GitHub variables ORCID_EXCHANGE_URL (above) and FIREBASE_WEB_API_KEY, then redeploy the site."
