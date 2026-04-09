# Developer Onboarding Guide

Welcome to NexusTreasury. This guide gets you from zero to a running local platform in under 15 minutes.

---

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Node.js | 22 LTS | Runtime |
| pnpm | 9.x | Package manager |
| Docker Desktop | 4.x+ | Local infrastructure |
| Git | Any | Version control |
| k6 | Latest | Performance tests (optional) |
| Newman | Latest | API tests (optional) |

---

## Option A: VS Code Dev Container (fastest — < 5 minutes)

The recommended path. Everything is pre-configured.

1. Install [VS Code](https://code.visualstudio.com/) and the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
2. Open the repository in VS Code
3. When prompted, click **"Reopen in Container"**
4. The `.devcontainer/setup.sh` script runs automatically:
   - Installs pnpm 9
   - Runs `pnpm install`
   - Starts Docker Compose (PostgreSQL, Kafka, Redis)
   - Runs Prisma migrations
   - Builds all 13 services
   - Runs domain smoke tests
5. Open `http://localhost:3000` — the dashboard auto-opens in your browser

**What's pre-configured in the Dev Container:**
- Node.js 22, Docker-in-Docker, kubectl, Helm, GitHub CLI
- 10 VS Code extensions: ESLint, Prettier, Vitest Explorer, OpenAPI viewer, REST Client, GitLens, Kubernetes tools, GitHub PR, Thunder Client
- All 13 service ports forwarded (3000, 4001–4011)
- Environment variables pre-set: `NODE_ENV`, `DATABASE_URL`, `KAFKA_BROKERS`, `JWT_SECRET`

---

## Option B: Manual Setup

### 1. Install Node.js 22 and pnpm

```bash
# Node.js via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
nvm install 22 && nvm use 22

# pnpm
npm install -g pnpm@9
```

### 2. Clone and install dependencies

```bash
git clone https://github.com/manassehkafoh/nexustreasury.git
cd nexustreasury
pnpm install
```

### 3. Start local infrastructure

```bash
make infra-up
# Starts: PostgreSQL 16 (TimescaleDB), Kafka 3.7, Redis 7, Elasticsearch 8
# Waits 10 seconds for services to become healthy
docker-compose ps    # Verify all services are Up
```

### 4. Run database migrations

```bash
make db-migrate
# Applies all Prisma migrations to the local PostgreSQL instance
```

### 5. Build all 13 services

```bash
make build
# Uses Turborepo — builds in dependency order
# domain → trade-service, risk-service, ... → web
# Expected: Tasks: 13 successful, 13 total
```

### 6. Run tests to verify the environment

```bash
make test           # 502 unit tests — should all pass
make test-e2e       # 31 E2E tests — should all pass
```

### 7. Start all services

```bash
make dev
# Starts all 13 services in parallel
# Dashboard:    http://localhost:3000
# Trade API:    http://localhost:4001/api/v1
# Risk API:     http://localhost:4003/api/v1
# Swagger UI:   http://localhost:4001/documentation
```

---

## Makefile Quick Reference

The `Makefile` at the root has 25 targets. Run `make help` to see them all.

```bash
make help           # Show all targets with descriptions
make install        # Install workspace dependencies
make build          # Build all 13 services
make test           # Run 502 unit tests
make test-e2e       # Run 31 E2E tests
make bench          # Run 7 SLA benchmark suites
make coverage       # Tests + HTML coverage report
make lint           # ESLint all TypeScript files
make typecheck      # tsc --noEmit (strict mode)
make audit          # pnpm audit --prod (must return 0 CVEs)
make dev            # Start all services (requires infra-up)
make infra-up       # Start PostgreSQL, Kafka, Redis
make infra-down     # Stop infrastructure
make db-migrate     # Apply Prisma migrations
make db-reset       # Reset DB and replay migrations
make db-studio      # Open Prisma Studio (visual DB browser)
make api-test       # Newman API smoke tests (local)
make api-test-staging # Newman API smoke tests (staging)
make k6             # k6 load test (10 VUs, 30s — requires k6)
make provision-tenant # Dry-run tenant provisioning
make deploy-staging # Trigger staging deploy via GitHub Actions
make postman-import # Show Postman import instructions
```

---

## API Testing with Postman

### Option 1: Mock Server (no setup required)

The mock server runs live at:
```
https://eeed7962-2b7b-495b-b197-03bb48aaae11.mock.pstmn.io
```

It returns realistic example responses for all 17 endpoints without requiring a running stack.

### Option 2: Import the Postman collection

```bash
make postman-import   # Shows import instructions
```

Import both files into Postman:
- `docs/NexusTreasury_API_Collection.postman_collection.json` — 17 requests, 9 examples
- `docs/NexusTreasury_Local.postman_environment.json` — pre-configured for localhost

Then run **🔐 Get JWT Token** first — it auto-saves `{{accessToken}}` to all subsequent requests.

### Option 3: Newman CLI (API smoke tests)

```bash
npm install -g newman newman-reporter-htmlextra
export NEXUS_ACCESS_TOKEN=$(curl -s -X POST \
  http://localhost:8080/realms/nexustreasury-bank-001/protocol/openid-connect/token \
  -d 'grant_type=password&client_id=nexustreasury-web&username=admin@bank.com&password=admin' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

make api-test           # Runs all 17 requests, generates HTML report
```

---

## Environment Variables

All local development environment variables are set in `.env.local` (copy from `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | Environment mode |
| `PORT` | Service-specific | Fastify listen port |
| `DATABASE_URL` | `postgresql://nexus:nexus_dev@localhost:5432/nexustreasury` | PostgreSQL |
| `KAFKA_BROKERS` | `localhost:9092` | Kafka bootstrap |
| `REDIS_URL` | `redis://localhost:6379` | Redis |
| `JWT_SECRET` | `dev-secret-not-for-prod` | JWT signing (dev only) |
| `AUDIT_HMAC_KEY` | `dev-hmac-key-32-chars!!!!!!!!` | HMAC audit signing (dev only) |
| `KEYCLOAK_URL` | `http://localhost:8080` | Identity provider |

> **Never commit real secrets.** Production secrets are managed by HashiCorp Vault (see [Production Runbook](production-runbook.md)).

---

## Project Structure

```
packages/
  domain/             Shared DDD kernel — aggregates, value objects, pricers
  trade-service/      Trade booking, sanctions, pre-deal check       [4001]
  position-service/   Event-sourced real-time position tracking      [4002]
  risk-service/       VaR, FRTB SA, Greeks, limit management         [4003]
  alm-service/        LCR, NSFR, NMD modelling, IRRBB                [4004]
  bo-service/         SWIFT, settlement, nostro reconciliation       [4005]
  market-data-service/ Bloomberg/LSEG rates and yield curves         [4006]
  accounting-service/ IFRS9, ECL, double-entry journals              [4007]
  audit-service/      HMAC audit trail, SOC 2                        [4008]
  notification-service/ Email, WebSocket, Webhook alerts             [4009]
  collateral-service/ ISDA CSA margin calls, CTD                     [4010]
  reporting-service/  LCR, NSFR, IRRBB regulatory reports           [4011]
  web/                Next.js 15 dealing room dashboard              [3000]

docs/
  api/                OpenAPI 3.1 + AsyncAPI 2.0 specifications
  adr/                Architecture Decision Records (ADR-001–ADR-010)
  architecture/c4/    C4 diagrams — 14 diagrams across all levels
  runbooks/           Operations runbooks (onboarding, production, incident)
  wiki/               Domain guides, glossary, FAQ, testing strategy
  strategy/           Calypso gap analysis

tests/
  e2e/                31 integration tests wiring all 12 bounded contexts
  performance/        k6 load tests — trade booking (500 TPS) + LCR
  contract/           Pact consumer contract tests

infra/
  kubernetes/base/    13 K8s Deployments + Services
  kubernetes/overlays/ Multi-region Kustomize overlays
  argocd/             ArgoCD ApplicationSet for active-active deployment
  helm/               Helm chart for full platform

.devcontainer/        VS Code Dev Container configuration
.github/workflows/    6 CI/CD workflows
Makefile              25 developer tasks
stryker.config.ts     Mutation testing configuration
```

---

## Tenant Provisioning

NexusTreasury supports multi-tenant white-label deployment. To provision a new bank tenant locally:

```bash
make provision-tenant TENANT_ID=my-bank DISPLAY_NAME="My Bank Ltd" ADMIN_EMAIL=admin@mybank.com

# Or run the script directly with full options:
pnpm tsx scripts/provision-tenant.ts \
  --tenantId   my-bank \
  --displayName "My Bank Ltd" \
  --adminEmail  admin@mybank.com \
  --currency    USD \
  --brand       nexustreasury \
  --dryRun      # remove --dryRun to actually provision
```

The provisioning script creates: PostgreSQL schema + RLS, Keycloak realm + 9 roles, Kafka consumer groups, Vault secrets, Chart of Accounts (47 entries), default risk limits, brand configuration, notification rules, and HMAC audit key.

---

## Common Issues

**`pnpm build` fails with "Cannot find module '@nexustreasury/domain'"**  
Run `pnpm install` first — the workspace symlinks need to be created before building.

**Docker Compose services fail to start**  
Check port conflicts: `lsof -i :5432` (PostgreSQL), `lsof -i :9092` (Kafka), `lsof -i :6379` (Redis). Stop any conflicting processes before `make infra-up`.

**Tests fail with Prisma connection errors**  
Ensure `make infra-up` has been run and PostgreSQL is healthy: `docker-compose ps postgres`. Then run `make db-migrate`.

**TypeScript errors after pulling latest code**  
Run `pnpm install && pnpm build` in that order. Turborepo may have cached stale build outputs — `make clean && make build` for a full rebuild.

See the full [FAQ](../wiki/FAQ.md) and [Troubleshooting guide](../wiki/Troubleshooting.md).
