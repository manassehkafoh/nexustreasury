#!/bin/bash
# NexusTreasury — Newman API Test Runner
# Runs the Postman collection against a target environment using Newman.
#
# Usage:
#   ./scripts/run-api-tests.sh [local|staging|production]
#
# Prerequisites:
#   npm install -g newman newman-reporter-htmlextra
#
# Environment variables (override defaults):
#   NEXUS_BASE_URL         Trade Service base URL
#   NEXUS_RISK_URL         Risk Service URL
#   NEXUS_REPORTING_URL    Reporting Service URL
#   NEXUS_ACCESS_TOKEN     JWT token (obtain via Keycloak before running)
#   NEXUS_TENANT_ID        Tenant identifier

set -euo pipefail

ENV="${1:-local}"
COLLECTION="docs/NexusTreasury_API_Collection.postman_collection.json"
REPORT_DIR="reports/newman"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# ── Environment resolution ────────────────────────────────────────────────────
case "$ENV" in
  local)
    BASE_URL="${NEXUS_BASE_URL:-http://localhost:4001/api/v1}"
    RISK_URL="${NEXUS_RISK_URL:-http://localhost:4003/api/v1}"
    ACCOUNTING_URL="${NEXUS_ACCOUNTING_URL:-http://localhost:4007/api/v1}"
    BO_URL="${NEXUS_BO_URL:-http://localhost:4005/api/v1}"
    AUDIT_URL="${NEXUS_AUDIT_URL:-http://localhost:4008/api/v1}"
    REPORTING_URL="${NEXUS_REPORTING_URL:-http://localhost:4011/api/v1}"
    ENV_FILE="docs/NexusTreasury_Local.postman_environment.json"
    ;;
  staging)
    BASE_URL="${NEXUS_BASE_URL:-https://trade.staging.nexustreasury.io/api/v1}"
    RISK_URL="${NEXUS_RISK_URL:-https://risk.staging.nexustreasury.io/api/v1}"
    ACCOUNTING_URL="${NEXUS_ACCOUNTING_URL:-https://accounting.staging.nexustreasury.io/api/v1}"
    BO_URL="${NEXUS_BO_URL:-https://bo.staging.nexustreasury.io/api/v1}"
    AUDIT_URL="${NEXUS_AUDIT_URL:-https://audit.staging.nexustreasury.io/api/v1}"
    REPORTING_URL="${NEXUS_REPORTING_URL:-https://reporting.staging.nexustreasury.io/api/v1}"
    ENV_FILE="docs/NexusTreasury_Staging.postman_environment.json"
    ;;
  production)
    echo "⚠️  Running against PRODUCTION. Press Ctrl+C in 5s to cancel..."
    sleep 5
    BASE_URL="${NEXUS_BASE_URL:-https://trade.nexustreasury.io/api/v1}"
    RISK_URL="${NEXUS_RISK_URL:-https://risk.nexustreasury.io/api/v1}"
    ACCOUNTING_URL="${NEXUS_ACCOUNTING_URL:-https://accounting.nexustreasury.io/api/v1}"
    BO_URL="${NEXUS_BO_URL:-https://bo.nexustreasury.io/api/v1}"
    AUDIT_URL="${NEXUS_AUDIT_URL:-https://audit.nexustreasury.io/api/v1}"
    REPORTING_URL="${NEXUS_REPORTING_URL:-https://reporting.nexustreasury.io/api/v1}"
    ENV_FILE=""
    ;;
  *)
    echo "Usage: $0 [local|staging|production]"
    exit 1
    ;;
esac

ACCESS_TOKEN="${NEXUS_ACCESS_TOKEN:-}"
TENANT_ID="${NEXUS_TENANT_ID:-bank-001}"

if [[ -z "$ACCESS_TOKEN" ]]; then
  echo "❌ NEXUS_ACCESS_TOKEN is not set. Obtain a JWT token first:"
  echo "   export NEXUS_ACCESS_TOKEN=\$(curl -s -X POST \\"
  echo "     https://auth.${ENV}.nexustreasury.io/realms/nexustreasury-bank-001/protocol/openid-connect/token \\"
  echo "     -d 'grant_type=password&client_id=nexustreasury-web&username=ADMIN_EMAIL&password=ADMIN_PASS' \\"
  echo "     | jq -r .access_token)"
  exit 1
fi

# ── Run Newman ────────────────────────────────────────────────────────────────
mkdir -p "$REPORT_DIR"

NEWMAN_ARGS=(
  run "$COLLECTION"
  --reporters cli,htmlextra,json
  --reporter-htmlextra-export "${REPORT_DIR}/report_${ENV}_${TIMESTAMP}.html"
  --reporter-json-export "${REPORT_DIR}/report_${ENV}_${TIMESTAMP}.json"
  --env-var "baseUrl=${BASE_URL}"
  --env-var "baseUrl_risk=${RISK_URL}"
  --env-var "baseUrl_accounting=${ACCOUNTING_URL}"
  --env-var "baseUrl_bo=${BO_URL}"
  --env-var "baseUrl_audit=${AUDIT_URL}"
  --env-var "baseUrl_reporting=${REPORTING_URL}"
  --env-var "accessToken=${ACCESS_TOKEN}"
  --env-var "tenantId=${TENANT_ID}"
  --bail            # Stop on first test failure
  --timeout 30000   # 30s request timeout
)

if [[ -n "$ENV_FILE" && -f "$ENV_FILE" ]]; then
  NEWMAN_ARGS+=(--environment "$ENV_FILE")
fi

echo ""
echo "🧪 Running NexusTreasury API tests"
echo "   Environment: ${ENV}"
echo "   Base URL:    ${BASE_URL}"
echo "   Tenant:      ${TENANT_ID}"
echo "   Report:      ${REPORT_DIR}/report_${ENV}_${TIMESTAMP}.html"
echo ""

newman "${NEWMAN_ARGS[@]}"

EXIT_CODE=$?

if [[ $EXIT_CODE -eq 0 ]]; then
  echo ""
  echo "✅ All API tests passed."
else
  echo ""
  echo "❌ API tests FAILED. Check report: ${REPORT_DIR}/report_${ENV}_${TIMESTAMP}.html"
fi

exit $EXIT_CODE
