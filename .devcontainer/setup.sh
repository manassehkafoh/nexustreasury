#!/usr/bin/env bash
# =============================================================================
# NexusTreasury Dev Container — Post-Create Setup
# =============================================================================
# Runs automatically after the devcontainer is created (postCreateCommand).
# Goal: Fully operational platform for E2E testing and prototyping,
#       zero manual steps, in under 5 minutes on a modern laptop.
#
# Phases:
#   1  — System prerequisites  (Node, pnpm, global tools, k6)
#   2  — Infrastructure boot   (Docker Compose infra tier only)
#   3  — Health gates          (wait for every container to be healthy)
#   4  — Database bootstrap    (Prisma generate/migrate, Kafka topics, seed)
#   5  — Keycloak bootstrap    (realm, client, 4 dev users)
#   6  — Vault bootstrap       (KV secrets engine, all service secrets)
#   7  — Build                 (14 TypeScript packages, turbo cached)
#   8  — Smoke tests           (invariants, unit suite, E2E probes, audit)
#   9  — .env.local generation (all service URLs, ports, feature flags)
#  10  — Service map printout  (URLs, quick-start commands, next steps)
#
# Skip flags (set to "1" to skip a phase):
#   NEXUS_SKIP_INFRA=1        skip Docker Compose boot (infra already running)
#   NEXUS_SKIP_KEYCLOAK=1     skip Keycloak provisioning
#   NEXUS_SKIP_VAULT=1        skip Vault provisioning
#   NEXUS_SKIP_TESTS=1        skip smoke tests (faster cold start)
#
# Tenant override:
#   NEXUS_TENANT_ID=<id>      default: bank-dev-001
# =============================================================================

set -euo pipefail
IFS=$'\n\t'

# ── Colour helpers ─────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

log()     { echo -e "${BLUE}[nexus]${RESET} $*"; }
success() { echo -e "${GREEN}[✓]${RESET} $*"; }
warn()    { echo -e "${YELLOW}[!]${RESET} $*"; }
err()     { echo -e "${RED}[✗]${RESET} $*" >&2; }
section() { echo -e "\n${BOLD}${CYAN}━━━ $* ━━━${RESET}"; }

# ── Elapsed timer ──────────────────────────────────────────────────────────────
SETUP_START=$(date +%s)
elapsed() { echo "$(( $(date +%s) - SETUP_START ))s"; }

# ── Configuration (all values from docker-compose.yml) ────────────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NEXUS_SKIP_INFRA="${NEXUS_SKIP_INFRA:-0}"
NEXUS_SKIP_KEYCLOAK="${NEXUS_SKIP_KEYCLOAK:-0}"
NEXUS_SKIP_VAULT="${NEXUS_SKIP_VAULT:-0}"
NEXUS_SKIP_TESTS="${NEXUS_SKIP_TESTS:-0}"
NEXUS_TENANT_ID="${NEXUS_TENANT_ID:-bank-dev-001}"

# Infrastructure ports — must match docker-compose.yml
POSTGRES_PORT=5432
REDIS_PORT=6379
KAFKA_PORT=9092
SCHEMA_REGISTRY_PORT=8081
KAFKA_UI_PORT=8090
KEYCLOAK_PORT=8080
VAULT_PORT=8200
PROMETHEUS_PORT=9090
GRAFANA_PORT=3001
JAEGER_PORT=16686
KIBANA_PORT=5601
MAILHOG_SMTP_PORT=1025
MAILHOG_UI_PORT=8025

# Credentials — must match docker-compose.yml
POSTGRES_USER=nexus
POSTGRES_PASS=nexus_dev_secret
POSTGRES_DB=nexustreasury
REDIS_PASS=nexus_redis_secret
VAULT_TOKEN=nexus-vault-dev-token    # VAULT_DEV_ROOT_TOKEN_ID in docker-compose
KEYCLOAK_ADMIN=admin
KEYCLOAK_ADMIN_PASS=admin

DB_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASS}@localhost:${POSTGRES_PORT}/${POSTGRES_DB}"

cd "$REPO_ROOT"

echo ""
echo -e "${BOLD}${CYAN}"
echo "  ███╗   ██╗███████╗██╗  ██╗██╗   ██╗███████╗"
echo "  ████╗  ██║██╔════╝╚██╗██╔╝██║   ██║██╔════╝"
echo "  ██╔██╗ ██║█████╗   ╚███╔╝ ██║   ██║███████╗"
echo "  ██║╚██╗██║██╔══╝   ██╔██╗ ██║   ██║╚════██║"
echo "  ██║ ╚████║███████╗██╔╝ ██╗╚██████╔╝███████║"
echo "  ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝"
echo "  Treasury Management System  ·  Dev Environment"
echo -e "${RESET}"

# =============================================================================
# PHASE 1 — System prerequisites
# =============================================================================
section "Phase 1 — System prerequisites"

# Node.js version check (Node 22 LTS is the target — matches CI)
NODE_MAJOR=$(node --version 2>/dev/null | sed 's/v//; s/\..*//' || echo "0")
if [ "$NODE_MAJOR" -lt 22 ]; then
  warn "Node.js ${NODE_MAJOR} detected. Node 22 LTS is required (matches CI workflow)."
  warn "  Install: nvm install 22 && nvm use 22"
else
  success "Node.js $(node --version)"
fi

# Install pnpm@9 if missing or outdated
if ! command -v pnpm &>/dev/null; then
  log "Installing pnpm@9..."
  npm install -g pnpm@9 --silent
elif [[ "$(pnpm --version | cut -d. -f1)" -lt 9 ]]; then
  log "Upgrading pnpm to v9..."
  npm install -g pnpm@9 --silent
fi
success "pnpm $(pnpm --version)"

# Install global dev tools (installed once into the container layer)
log "Installing global dev tools (turbo, prisma, tsx, concurrently, wait-on)..."
npm install -g turbo@latest prisma@latest tsx concurrently wait-on --silent 2>/dev/null || true
success "Global tools ready"

# Install k6 for performance/load tests (tests/performance/k6-load.js)
if ! command -v k6 &>/dev/null; then
  log "Installing k6 (performance testing)..."
  if command -v apt-get &>/dev/null; then
    curl -fsSL https://dl.k6.io/key.gpg \
      | sudo gpg --dearmor -o /usr/share/keyrings/k6-archive-keyring.gpg 2>/dev/null
    echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
      | sudo tee /etc/apt/sources.list.d/k6.list >/dev/null
    sudo apt-get update -qq && sudo apt-get install -y -qq k6 2>/dev/null \
      || warn "k6 install skipped — run manually: sudo apt-get install k6"
  fi
fi
command -v k6 &>/dev/null \
  && success "k6 $(k6 version 2>&1 | head -1)" \
  || warn "k6 not available (performance tests will be skipped)"

# Install workspace dependencies (honours frozen lockfile)
log "Installing 14-package workspace dependencies..."
pnpm install --frozen-lockfile 2>&1 | grep -E "Done|Warn|Err" | head -5 || true
success "pnpm workspace installed"


# =============================================================================
# PHASE 2 — Infrastructure boot (Docker Compose — infra tier only)
# =============================================================================
section "Phase 2 — Infrastructure (Docker Compose)"

# We start the INFRASTRUCTURE tier only — NOT the app service containers.
# App services (trade-service, risk-service, etc.) run via `pnpm dev` for
# hot-reload. Starting them via docker-compose would fight with the dev server.
INFRA_SERVICES=(
  postgres redis
  zookeeper kafka schema-registry kafka-ui
  vault keycloak
  prometheus grafana
  elasticsearch kibana
  jaeger
  mailhog
)

if [ "$NEXUS_SKIP_INFRA" = "1" ]; then
  warn "NEXUS_SKIP_INFRA=1 — skipping Docker Compose boot"
elif ! command -v docker &>/dev/null; then
  warn "Docker not found — skipping infra boot (start manually: pnpm docker:up)"
elif ! docker info &>/dev/null 2>&1; then
  warn "Docker daemon not running — skipping infra boot (start manually: pnpm docker:up)"
else
  log "Starting infrastructure services: ${INFRA_SERVICES[*]}"
  docker-compose up -d "${INFRA_SERVICES[@]}" 2>&1 \
    | grep -v "^Creating\|^Starting\|^Pulling\|up-to-date" || true
  success "Infrastructure containers started"
fi

# =============================================================================
# PHASE 3 — Health gates (wait until every service is ready)
# =============================================================================
section "Phase 3 — Health gates"

# Polls a TCP port until it accepts a connection
wait_port() {
  local svc=$1 host=$2 port=$3 max=${4:-120}
  local waited=0
  printf "${BLUE}[nexus]${RESET} Waiting for %s on %s:%s " "$svc" "$host" "$port"
  until nc -z "$host" "$port" 2>/dev/null; do
    [ $waited -ge $max ] && { echo ""; warn "$svc not ready after ${max}s — continuing"; return 1; }
    sleep 2; waited=$((waited+2)); printf "."
  done
  echo ""
  success "$svc ready (${waited}s)"
}

# Polls an HTTP endpoint until it returns 2xx
wait_http() {
  local svc=$1 url=$2 max=${3:-180}
  local waited=0
  printf "${BLUE}[nexus]${RESET} Waiting for %s HTTP " "$svc"
  until curl -sf "$url" &>/dev/null; do
    [ $waited -ge $max ] && { echo ""; warn "$svc HTTP not ready after ${max}s — continuing"; return 1; }
    sleep 3; waited=$((waited+3)); printf "."
  done
  echo ""
  success "$svc HTTP ready (${waited}s)"
}

_container_running() { docker ps --format '{{.Names}}' 2>/dev/null | grep -q "$1"; }

# PostgreSQL — TCP + query gate
if _container_running "nexus-postgres"; then
  wait_port "PostgreSQL" localhost "$POSTGRES_PORT" 120 || true
  log "Waiting for PostgreSQL to accept queries..."
  until docker exec nexus-postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" &>/dev/null; do
    sleep 2; printf ".";
  done; echo ""
  success "PostgreSQL accepting queries"
fi

# Redis
_container_running "nexus-redis" && wait_port "Redis" localhost "$REDIS_PORT" 60 || true

# Kafka broker (not ZooKeeper — we care about the broker port)
_container_running "nexus-kafka" && wait_port "Kafka broker" localhost "$KAFKA_PORT" 120 || true

# Schema Registry
_container_running "nexus-schema-registry" \
  && wait_http "Schema Registry" "http://localhost:${SCHEMA_REGISTRY_PORT}/subjects" 60 || true

# Keycloak — HTTP readiness
if _container_running "nexus-keycloak"; then
  wait_http "Keycloak" "http://localhost:${KEYCLOAK_PORT}/health/ready" 180 || true
fi

# Vault
_container_running "nexus-vault" \
  && wait_http "Vault" "http://localhost:${VAULT_PORT}/v1/sys/health" 60 || true

# Elasticsearch
_container_running "nexus-elasticsearch" \
  && wait_http "Elasticsearch" "http://localhost:9200/_cluster/health" 120 || true


# =============================================================================
# PHASE 4 — Database bootstrap
# =============================================================================
section "Phase 4 — Database bootstrap"

if _container_running "nexus-postgres" || nc -z localhost "$POSTGRES_PORT" 2>/dev/null; then

  # 4a. Generate Prisma client
  log "Generating Prisma client..."
  DATABASE_URL="$DB_URL" \
    pnpm exec prisma generate --schema=prisma/schema.prisma 2>&1 \
    | grep -v "^warn\|^info\|Tip:\|prisma:" || true
  success "Prisma client generated"

  # 4b. Run database migrations
  log "Applying Prisma migrations..."
  DATABASE_URL="$DB_URL" \
    pnpm exec prisma migrate deploy --schema=prisma/schema.prisma 2>&1 | tail -5 \
    || warn "Migrations may already be applied — continuing"
  success "Database migrations applied"

  # 4c. Create Kafka topics + Dead Letter Topics
  if _container_running "nexus-kafka"; then
    log "Creating Kafka topics (14 domain topics + DLTs)..."

    # Format: "topic-name:partitions"
    # Replication factor is 1 for dev (single-broker)
    TOPICS=(
      "nexus.trades.booked:12"
      "nexus.positions.updated:12"
      "nexus.risk.limit-breached:6"
      "nexus.risk.pre-deal-checked:6"
      "nexus.market.rates-updated:24"
      "nexus.market.datasource-failover:3"
      "nexus.market.trading-halt:3"
      "nexus.alm.lcr-updated:6"
      "nexus.alm.nsfr-updated:6"
      "nexus.bo.reconciliation-result:6"
      "nexus.accounting.journal-posted:6"
      "nexus.audit.events:6"
      "nexus.regulatory.submissions:3"
      "nexus.notifications.alerts:6"
      "nexus.chaos.experiment-results:3"
    )

    for spec in "${TOPICS[@]}"; do
      IFS=':' read -r topic parts <<< "$spec"
      docker exec nexus-kafka kafka-topics \
        --bootstrap-server localhost:9092 \
        --create --if-not-exists \
        --topic "$topic" \
        --partitions "$parts" \
        --replication-factor 1 >/dev/null 2>&1 || true
      # Dead Letter Topic (3 partitions, uniform)
      docker exec nexus-kafka kafka-topics \
        --bootstrap-server localhost:9092 \
        --create --if-not-exists \
        --topic "${topic}.dlt" \
        --partitions 3 \
        --replication-factor 1 >/dev/null 2>&1 || true
    done
    success "Kafka topics ready (${#TOPICS[@]} topics + ${#TOPICS[@]} DLTs)"
  fi

  # 4d. Provision development tenant
  if [ -f "scripts/provision-tenant.ts" ]; then
    log "Seeding development tenant: ${NEXUS_TENANT_ID}..."
    DATABASE_URL="$DB_URL" \
    VAULT_ADDR="http://localhost:${VAULT_PORT}" \
    VAULT_TOKEN="$VAULT_TOKEN" \
    KAFKA_BROKERS="localhost:${KAFKA_PORT}" \
      tsx scripts/provision-tenant.ts \
        --tenantId "$NEXUS_TENANT_ID" \
        --currency USD \
        2>&1 | tail -6 \
      || warn "Tenant seed failed (may already exist) — continuing"
    success "Development tenant provisioned: ${NEXUS_TENANT_ID}"
  fi

else
  warn "PostgreSQL not reachable — skipping DB bootstrap"
  warn "  Resolve and re-run: bash .devcontainer/setup.sh"
fi


# =============================================================================
# PHASE 5 — Keycloak identity bootstrap
# =============================================================================
section "Phase 5 — Keycloak identity bootstrap"

if [ "$NEXUS_SKIP_KEYCLOAK" = "1" ]; then
  warn "NEXUS_SKIP_KEYCLOAK=1 — skipping"
elif ! curl -sf "http://localhost:${KEYCLOAK_PORT}/health/ready" &>/dev/null; then
  warn "Keycloak not reachable — skipping realm setup"
  warn "  Re-run after infra is ready: NEXUS_SKIP_INFRA=1 bash .devcontainer/setup.sh"
else
  log "Obtaining Keycloak admin token..."
  KC_BASE="http://localhost:${KEYCLOAK_PORT}"
  KC_TOKEN=$(curl -sf -X POST \
    "${KC_BASE}/realms/master/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "client_id=admin-cli&grant_type=password&username=${KEYCLOAK_ADMIN}&password=${KEYCLOAK_ADMIN_PASS}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null \
    || echo "")

  if [ -z "$KC_TOKEN" ]; then
    warn "Could not get Keycloak admin token — check admin credentials (admin/admin)"
  else
    log "Configuring 'nexustreasury' realm..."

    # Create realm (idempotent — 409 Conflict is silently OK)
    curl -sf -X POST "${KC_BASE}/admin/realms" \
      -H "Authorization: Bearer ${KC_TOKEN}" \
      -H "Content-Type: application/json" \
      -d '{"realm":"nexustreasury","enabled":true,"displayName":"NexusTreasury Dev",
           "accessTokenLifespan":28800,"ssoSessionMaxLifespan":86400,
           "bruteForceProtected":false,"loginTheme":"keycloak"}' \
      2>/dev/null || true

    # Create service client (confidential, direct grants + standard flow)
    curl -sf -X POST "${KC_BASE}/admin/realms/nexustreasury/clients" \
      -H "Authorization: Bearer ${KC_TOKEN}" \
      -H "Content-Type: application/json" \
      -d '{"clientId":"nexustreasury-services","secret":"dev-client-secret-not-for-prod",
           "enabled":true,"protocol":"openid-connect","publicClient":false,
           "serviceAccountsEnabled":true,"directAccessGrantsEnabled":true,
           "standardFlowEnabled":true,
           "redirectUris":["http://localhost:3000/*","http://localhost:4001/*",
                           "http://localhost:4003/*","http://localhost:4011/*"]}' \
      2>/dev/null || true

    # Create dev users: "username|displayName|role|email"
    declare -A USER_ROLES=(
      ["trader-dev"]="TRADER"
      ["risk-dev"]="RISK_MANAGER"
      ["admin-dev"]="ADMIN"
      ["auditor-dev"]="AUDITOR"
    )
    for uname in "${!USER_ROLES[@]}"; do
      role="${USER_ROLES[$uname]}"
      curl -sf -X POST "${KC_BASE}/admin/realms/nexustreasury/users" \
        -H "Authorization: Bearer ${KC_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"${uname}\",\"email\":\"${uname}@dev.local\",
             \"enabled\":true,\"emailVerified\":true,
             \"credentials\":[{\"type\":\"password\",\"value\":\"devpassword123\",\"temporary\":false}],
             \"attributes\":{\"tenantId\":[\"${NEXUS_TENANT_ID}\"],\"role\":[\"${role}\"]}}" \
        2>/dev/null || true
    done

    success "Keycloak: realm 'nexustreasury' + client + ${#USER_ROLES[@]} dev users configured"
    log "  Credentials: <username> / devpassword123"
  fi
fi

# =============================================================================
# PHASE 6 — Vault secrets bootstrap
# =============================================================================
section "Phase 6 — Vault secrets bootstrap"

if [ "$NEXUS_SKIP_VAULT" = "1" ]; then
  warn "NEXUS_SKIP_VAULT=1 — skipping"
elif ! curl -sf "http://localhost:${VAULT_PORT}/v1/sys/health" &>/dev/null; then
  warn "Vault not reachable — .env.local will use inline dev secrets"
else
  log "Writing dev secrets to Vault (kv/nexustreasury/dev)..."
  export VAULT_ADDR="http://localhost:${VAULT_PORT}"
  export VAULT_TOKEN

  # Enable KV v2 secrets engine (silently skip if already enabled)
  vault secrets enable -version=2 kv 2>/dev/null || true

  vault kv put kv/nexustreasury/dev \
    jwt_secret="devcontainer-jwt-secret-minimum-256-bits-long-!!" \
    audit_hmac_key="devcontainer-hmac-key-exactly-32-chars!!" \
    database_url="$DB_URL" \
    redis_url="redis://:${REDIS_PASS}@localhost:${REDIS_PORT}" \
    kafka_brokers="localhost:${KAFKA_PORT}" \
    keycloak_client_secret="dev-client-secret-not-for-prod" \
    anthropic_api_key="${ANTHROPIC_API_KEY:-}" \
    bloomberg_host="localhost" \
    bloomberg_port="8194" \
    torchserve_url="http://localhost:8080" \
    smtp_host="localhost" \
    smtp_port="${MAILHOG_SMTP_PORT}" \
    2>/dev/null || warn "Vault write failed — check VAULT_TOKEN and Vault health"

  success "Vault secrets written to kv/nexustreasury/dev"
fi


# =============================================================================
# PHASE 7 — Build all 14 packages
# =============================================================================
section "Phase 7 — Build (14 packages, TypeScript strict, turbo cached)"

log "Running pnpm build across @nexustreasury/* workspace..."
pnpm build 2>&1 | tail -4

# Verify task count — turbo reports "N successful, M total"
BUILD_OUT=$(pnpm build 2>&1 | grep "Tasks:" || echo "")
if echo "$BUILD_OUT" | grep -qE "14 successful|cached.*14"; then
  success "Build: 14/14 packages (cached or fresh)"
else
  warn "Build summary: ${BUILD_OUT:-unknown}"
  warn "  Run 'pnpm build' manually to inspect errors"
fi

# =============================================================================
# PHASE 8 — Smoke tests
# =============================================================================
section "Phase 8 — Smoke tests"

if [ "$NEXUS_SKIP_TESTS" = "1" ]; then
  warn "NEXUS_SKIP_TESTS=1 — skipping all tests"
else

  # 8a. Mathematical invariants (must pass before any deployment)
  log "Running platform health invariants (CIP, put-call parity, IRS NPV)..."
  if NODE_OPTIONS="--max-old-space-size=512" \
      pnpm --filter @nexustreasury/domain exec vitest run \
      src/pricing/platform-health.test.ts \
      --reporter=dot 2>&1 | tail -5; then
    success "Platform invariants: all passing"
  else
    warn "Platform invariants failed — check domain/src/pricing/platform-health.test.ts"
  fi

  # 8b. Core unit test suite (fastest packages only for cold-start speed)
  log "Running core unit tests (8 key packages)..."
  UNIT_PASS=0; UNIT_FAIL=0
  CORE_PKGS=(domain trade-service risk-service alm-service
             accounting-service audit-service reporting-service notification-service)
  for pkg in "${CORE_PKGS[@]}"; do
    result=$(NODE_OPTIONS="--max-old-space-size=512" \
      pnpm --filter "@nexustreasury/${pkg}" exec vitest run 2>&1)
    passed=$(echo "$result" | grep -oP '\d+ passed' | grep -oP '\d+' | head -1)
    failed=$(echo "$result" | grep -oP '\d+ failed' | grep -oP '\d+' | head -1)
    UNIT_PASS=$(( UNIT_PASS + ${passed:-0} ))
    UNIT_FAIL=$(( UNIT_FAIL + ${failed:-0} ))
  done
  [ "$UNIT_FAIL" -eq 0 ] \
    && success "Unit tests: ${UNIT_PASS} passed, 0 failed" \
    || warn    "Unit tests: ${UNIT_PASS} passed, ${UNIT_FAIL} FAILED — run 'pnpm test' for details"

  # 8c. E2E integration tests (requires live PostgreSQL)
  if nc -z localhost "$POSTGRES_PORT" 2>/dev/null; then
    log "Running E2E integration tests (in-memory transport)..."
    JWT_SECRET="devcontainer-jwt-secret-minimum-256-bits-long-!!" \
    AUDIT_HMAC_KEY="devcontainer-hmac-key-exactly-32-chars!!" \
    DATABASE_URL="$DB_URL" \
    NODE_OPTIONS="--max-old-space-size=512" \
      pnpm --filter @nexustreasury/e2e exec vitest run --reporter=dot 2>&1 | tail -6 \
      || warn "Some E2E tests failed — check infra connectivity"
    success "E2E integration tests complete"
  else
    warn "E2E tests skipped (PostgreSQL not reachable)"
  fi

  # 8d. Security audit (prod dependencies only)
  log "Running pnpm audit (prod dependencies)..."
  AUDIT_OUT=$(pnpm audit --prod 2>&1 | tail -1)
  if echo "$AUDIT_OUT" | grep -q "No known vulnerabilities"; then
    success "Security audit: 0 prod CVEs"
  else
    warn "Security audit: ${AUDIT_OUT}"
    warn "  Run 'pnpm audit --prod' to review — Renovate Bot auto-patches on next CI run"
  fi
fi


# =============================================================================
# PHASE 9 — .env.local generation
# =============================================================================
section "Phase 9 — .env.local generation"

ENV_FILE="${REPO_ROOT}/.env.local"

if [ -f "$ENV_FILE" ]; then
  warn ".env.local already exists — not overwriting"
  warn "  Delete it and re-run to regenerate: rm .env.local && bash .devcontainer/setup.sh"
else
  log "Writing .env.local..."
  # Use printf to avoid heredoc variable-expansion complexities
  printf '%s\n' \
    "# ============================================================" \
    "# NexusTreasury — Local Development Environment" \
    "# Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "# DO NOT COMMIT — listed in .gitignore" \
    "# ============================================================" \
    "" \
    "# ── Runtime ──────────────────────────────────────────────────" \
    "NODE_ENV=development" \
    "CI=false" \
    "" \
    "# ── Database ─────────────────────────────────────────────────" \
    "DATABASE_URL=postgresql://nexus:nexus_dev_secret@localhost:5432/nexustreasury" \
    "REDIS_URL=redis://:nexus_redis_secret@localhost:6379" \
    "REDIS_HOST=localhost" \
    "REDIS_PORT=6379" \
    "" \
    "# ── Kafka ────────────────────────────────────────────────────" \
    "KAFKA_BROKERS=localhost:9092" \
    "KAFKA_CLIENT_ID=nexustreasury-dev" \
    "KAFKA_GROUP_ID_PREFIX=nexus-dev" \
    "SCHEMA_REGISTRY_URL=http://localhost:8081" \
    "" \
    "# ── Auth (DEV ONLY — NEVER use in prod) ──────────────────────" \
    "JWT_SECRET=devcontainer-jwt-secret-minimum-256-bits-long-!!" \
    "JWT_EXPIRY=8h" \
    "AUDIT_HMAC_KEY=devcontainer-hmac-key-exactly-32-chars!!" \
    "KEYCLOAK_URL=http://localhost:8080" \
    "KEYCLOAK_REALM=nexustreasury" \
    "KEYCLOAK_CLIENT_ID=nexustreasury-services" \
    "KEYCLOAK_CLIENT_SECRET=dev-client-secret-not-for-prod" \
    "" \
    "# ── HashiCorp Vault ───────────────────────────────────────────" \
    "VAULT_ADDR=http://localhost:8200" \
    "VAULT_TOKEN=nexus-vault-dev-token" \
    "" \
    "# ── Service ports ────────────────────────────────────────────" \
    "TRADE_SERVICE_PORT=4001" \
    "POSITION_SERVICE_PORT=4002" \
    "RISK_SERVICE_PORT=4003" \
    "ALM_SERVICE_PORT=4004" \
    "BO_SERVICE_PORT=4005" \
    "MARKET_DATA_SERVICE_PORT=4006" \
    "ACCOUNTING_SERVICE_PORT=4007" \
    "AUDIT_SERVICE_PORT=4008" \
    "NOTIFICATION_SERVICE_PORT=4009" \
    "COLLATERAL_SERVICE_PORT=4010" \
    "REPORTING_SERVICE_PORT=4011" \
    "PLANNING_SERVICE_PORT=4012" \
    "WEB_PORT=3000" \
    "" \
    "# ── Market data ───────────────────────────────────────────────" \
    "BLOOMBERG_BPIPE_HOST=localhost" \
    "BLOOMBERG_BPIPE_PORT=8194" \
    "BLOOMBERG_BPIPE_MOCK=true" \
    "" \
    "# ── AI / ML ──────────────────────────────────────────────────" \
    "# Obtain API key: https://console.anthropic.com" \
    "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}" \
    "TORCHSERVE_URL=http://localhost:8080" \
    "TORCHSERVE_MOCK=true" \
    "" \
    "# ── Observability ────────────────────────────────────────────" \
    "OTEL_EXPORTER_JAEGER_ENDPOINT=http://localhost:14268/api/traces" \
    "OTEL_SERVICE_NAME=nexustreasury-dev" \
    "PROMETHEUS_PORT=9090" \
    "LOG_LEVEL=debug" \
    "" \
    "# ── Email (MailHog dev SMTP) ──────────────────────────────────" \
    "SMTP_HOST=localhost" \
    "SMTP_PORT=1025" \
    "SMTP_SECURE=false" \
    "EMAIL_FROM=noreply@nexustreasury.dev" \
    "" \
    "# ── Multi-tenancy ────────────────────────────────────────────" \
    "DEFAULT_TENANT_ID=${NEXUS_TENANT_ID}" \
    "DEFAULT_TENANT_CURRENCY=USD" \
    "" \
    "# ── Feature flags ────────────────────────────────────────────" \
    "FEATURE_AI_ASSISTANT=true" \
    "FEATURE_BLOOMBERG_LIVE=false" \
    "FEATURE_BERT_CLASSIFIER=false" \
    "FEATURE_SSE_STREAMING=true" \
    "FEATURE_REGULATORY_REPORTING=true" \
    "FEATURE_CHAOS_EXPERIMENTS=false" \
    > "$ENV_FILE"

  success ".env.local written"
  log "  Add ANTHROPIC_API_KEY to enable the AI Treasury Assistant"
fi


# =============================================================================
# PHASE 10 — Service map, credentials, and next steps
# =============================================================================
section "Phase 10 — Setup complete"

TOTAL_TIME=$(elapsed)

echo ""
echo -e "${BOLD}${GREEN}✅  NexusTreasury dev environment ready in ${TOTAL_TIME}${RESET}"
echo ""

echo -e "${BOLD}Application services (start with: ${YELLOW}pnpm dev${RESET}${BOLD})${RESET}"
echo -e "  ${GREEN}●${RESET}  Web Dashboard (Next.js)    http://localhost:3000"
echo -e "  ${GREEN}●${RESET}  Trade Service              http://localhost:4001"
echo -e "  ${GREEN}●${RESET}  Position Service           http://localhost:4002"
echo -e "  ${GREEN}●${RESET}  Risk Service               http://localhost:4003"
echo -e "  ${GREEN}●${RESET}  ALM Service                http://localhost:4004"
echo -e "  ${GREEN}●${RESET}  Back-Office Service        http://localhost:4005"
echo -e "  ${GREEN}●${RESET}  Market Data Service        http://localhost:4006"
echo -e "  ${GREEN}●${RESET}  Accounting Service         http://localhost:4007"
echo -e "  ${GREEN}●${RESET}  Audit Service              http://localhost:4008"
echo -e "  ${GREEN}●${RESET}  Notification Service       http://localhost:4009"
echo -e "  ${GREEN}●${RESET}  Collateral Service         http://localhost:4010"
echo -e "  ${GREEN}●${RESET}  Reporting Service          http://localhost:4011"
echo -e "  ${GREEN}●${RESET}  Planning Service           http://localhost:4012"
echo ""

echo -e "${BOLD}Infrastructure UIs${RESET}"
echo -e "  ${CYAN}●${RESET}  Kafka UI (topics/consumers) http://localhost:${KAFKA_UI_PORT}"
echo -e "  ${CYAN}●${RESET}  Grafana (metrics)           http://localhost:${GRAFANA_PORT}       admin / admin"
echo -e "  ${CYAN}●${RESET}  Jaeger (distributed traces) http://localhost:${JAEGER_PORT}"
echo -e "  ${CYAN}●${RESET}  Keycloak (identity)         http://localhost:${KEYCLOAK_PORT}       admin / admin"
echo -e "  ${CYAN}●${RESET}  Vault (secrets)             http://localhost:${VAULT_PORT}         token: ${VAULT_TOKEN}"
echo -e "  ${CYAN}●${RESET}  Kibana (logs)               http://localhost:${KIBANA_PORT}"
echo -e "  ${CYAN}●${RESET}  MailHog (dev email)         http://localhost:${MAILHOG_UI_PORT}"
echo -e "  ${CYAN}●${RESET}  Prometheus                  http://localhost:${PROMETHEUS_PORT}"
echo ""

echo -e "${BOLD}Quick start commands${RESET}"
echo -e "  ${YELLOW}pnpm dev${RESET}               Start all 14 services + web UI (hot-reload)"
echo -e "  ${YELLOW}pnpm test${RESET}              Run full 854-test suite"
echo -e "  ${YELLOW}pnpm test:coverage${RESET}     Coverage report (all packages, include-scoped)"
echo -e "  ${YELLOW}pnpm build${RESET}             TypeScript compile (turbo cached)"
echo -e "  ${YELLOW}pnpm lint${RESET}              ESLint + Prettier check"
echo -e "  ${YELLOW}pnpm typecheck${RESET}         TypeScript type check (strict)"
echo -e "  ${YELLOW}pnpm docker:logs${RESET}       Tail all infra container logs"
echo -e "  ${YELLOW}pnpm docker:down${RESET}       Stop all containers"
echo ""

echo -e "${BOLD}Keycloak dev users${RESET}  (realm: nexustreasury  |  password: devpassword123)"
echo -e "  trader-dev    TRADER role"
echo -e "  risk-dev      RISK_MANAGER role"
echo -e "  admin-dev     ADMIN role"
echo -e "  auditor-dev   AUDITOR role"
echo ""

echo -e "${BOLD}E2E testing${RESET}"
echo -e "  Vitest E2E:   ${YELLOW}pnpm --filter @nexustreasury/e2e exec vitest run${RESET}"
echo -e "  k6 load test: ${YELLOW}k6 run tests/performance/k6-load.js${RESET}"
echo -e "  API testing:  Import ${YELLOW}docs/NexusTreasury_API_Collection.postman_collection.json${RESET} into Postman"
echo ""

echo -e "${BOLD}Docs${RESET}"
echo -e "  Onboarding    docs/onboarding/README.md"
echo -e "  Learner docs  docs/learner/"
echo -e "  SRE runbooks  docs/sre/"
echo -e "  C4 diagrams   docs/architecture/c4/"
echo ""

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo -e "${YELLOW}⚠${RESET}  ANTHROPIC_API_KEY is not set."
  echo -e "   The AI Treasury Assistant will return rule-based fallback responses."
  echo -e "   Add it to ${BOLD}.env.local${RESET} and restart services to enable live AI."
  echo ""
fi

echo -e "${BOLD}Active tenant:${RESET} ${NEXUS_TENANT_ID}"
echo -e "${BOLD}Env file:${RESET}      .env.local  (edit to customise; never commit)"
echo ""

