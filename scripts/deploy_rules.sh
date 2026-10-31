#!/usr/bin/env bash
# Publish firestore.rules to the project's default database via the Firebase Rules API.
# Usage: PROJECT_ID=orcid-playground-889 scripts/deploy_rules.sh  (needs gcloud auth with rules admin)
set -euo pipefail
PROJECT_ID="${PROJECT_ID:-orcid-playground-889}"
TOKEN="${TOKEN:-$(gcloud auth print-access-token)}"
API="https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}"
HDR=(-H "Authorization: Bearer ${TOKEN}" -H "x-goog-user-project: ${PROJECT_ID}" -H "Content-Type: application/json")
BODY=$(python -c 'import json;print(json.dumps({"source":{"files":[{"name":"firestore.rules","content":open("firestore.rules",encoding="utf-8").read()}]}}))')
RULESET=$(curl -sf -X POST "${HDR[@]}" --data "$BODY" "$API/rulesets" | python -c 'import json,sys;print(json.load(sys.stdin)["name"])')
RELEASE="projects/${PROJECT_ID}/releases/cloud.firestore"
curl -sf -X PATCH "${HDR[@]}" -d "{\"release\":{\"name\":\"${RELEASE}\",\"rulesetName\":\"${RULESET}\"}}" "$API/releases/cloud.firestore" >/dev/null
echo "Released ${RULESET}"
