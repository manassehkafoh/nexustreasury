# Contributing to NexusTreasury

Welcome to the NexusTreasury engineering team. This guide covers everything you need
to go from a fresh clone to a merged pull request. Read it once before touching any code.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [First-Time Setup](#2-first-time-setup)
3. [Repository Layout](#3-repository-layout)
4. [Bounded Contexts — What Lives Where](#4-bounded-contexts--what-lives-where)
5. [Running the Full Stack Locally](#5-running-the-full-stack-locally)
6. [Running Tests](#6-running-tests)
7. [Adding a New Service](#7-adding-a-new-service)
8. [Adding a New Domain Concept](#8-adding-a-new-domain-concept)
9. [Database Migrations](#9-database-migrations)
10. [Branch and PR Strategy](#10-branch-and-pr-strategy)
11. [Commit Message Format](#11-commit-message-format)
12. [CI Gates — What Must Pass Before Merge](#12-ci-gates--what-must-pass-before-merge)
13. [Dependency Management](#13-dependency-management)
14. [Environment Variables Reference](#14-environment-variables-reference)
15. [Useful Commands Cheatsheet](#15-useful-commands-cheatsheet)

---

## 1. Prerequisites

| Tool           | Min version | Install                            |
| -------------- | ----------- | ---------------------------------- |
| Node.js        | 20.x        | `nvm use` (reads `.nvmrc`)         |
| pnpm           | 9.x         | `npm install -g pnpm@9`            |
| Docker Desktop | 4.x         | docker.com/products/docker-desktop |
| Git            | 2.40+       | `brew install git`                 |

Everything else (Kafka, PostgreSQL, Redis, Keycloak, Vault, Grafana) runs inside
Docker Compose — you do **not** need them installed locally.

---

## 2. First-Time Setup

```bash
# 1. Clone
git clone https://github.com/manassehkafoh/nexustreasury.git
cd nexustreasury

# 2. Use the correct Node version (reads .nvmrc → Node 20)
nvm use

# 3. Install all workspace dependencies
pnpm install

# 4. Generate the combined Prisma client (all 7 models in one client)
pnpm exec prisma generate --schema=prisma/schema.prisma

# 5. Copy environment template
cp .env.example .env          # defaults work for local dev

# 6. Build all packages
pnpm build

# 7. Start the infrastructure stack
docker-compose up -d postgres redis kafka keycloak vault

# 8. Run database migrations
pnpm db:migrate

# 9. Confirm all services healthy
docker-compose ps
```

---

## 3. Repository Layout

```
nexustreasury/
├── packages/
│   ├── domain/               # ❶ Core domain model — aggregates, value objects, events
│   │                         #   This is the heart of the system. All business rules live here.
│   │                         #   Has NO infrastructure dependencies (no Prisma, no Kafka).
│   ├── trade-service/        # ❷ Trade booking, amendment, cancellation (port 4001)
│   ├── position-service/     # ❸ Real-time position keeping, event-sourced (port 4002)
│   ├── risk-service/         # ❹ Pre-deal limit checking, VaR, limit management (port 4003)
│   ├── alm-service/          # ❺ LCR/NSFR calculation, liquidity gap reports (port 4004)
│   ├── bo-service/           # ❻ SWIFT matching, settlement workflow (port 4005)
│   ├── market-data-service/  # ❼ Rate publishing to Kafka (port 4006)
│   └── web/                  # ❽ Next.js 15 front-end — blotter, dashboards (port 3000)
│
├── prisma/
│   └── schema.prisma         # Combined schema for all 4 PostgreSQL schemas
│                             # (trading, position, risk, alm) — ONE client, all models
│
├── infra/
│   ├── kubernetes/           # K8s manifests — base + staging/production overlays
│   ├── argocd/               # GitOps application manifests
│   ├── helm/nexustreasury/   # Helm chart — parameterised deployment template
│   └── monitoring/alerts/    # Prometheus alert rules (11 rules across 5 groups)
│
├── .github/workflows/        # CI/CD pipelines
│   ├── ci.yml                # 10-job CI chain (lint → typecheck → test → SAST → Docker → E2E)
│   ├── cd-staging.yml        # Auto-deploy to staging on main push
│   ├── cd-production.yml     # Manual 2-approver gate to production
│   └── security-patch.yml    # Scheduled CVE patching every 6 hours (SOC 2 CC6.8)
│
├── docs/                     # Postman collection + environment files
├── prisma/schema.prisma      # Root combined Prisma schema (see §9)
├── turbo.json                # Turbo task graph — defines build order
├── pnpm-workspace.yaml       # Workspace package globs
├── renovate.json             # Automated dependency updates (replaces Dependabot)
└── ARCHITECTURE.md           # System architecture, event topology, ADRs
```

---

## 4. Bounded Contexts — What Lives Where

NexusTreasury uses Domain-Driven Design. Each service owns one **bounded context**
and communicates with others **only via Kafka events or the pre-deal gRPC check**.
Direct cross-service imports are forbidden.

| Context     | Package               | PostgreSQL Schema         | Owns                                   |
| ----------- | --------------------- | ------------------------- | -------------------------------------- |
| Trading     | `trade-service`       | `trading`                 | Trade lifecycle, event outbox          |
| Position    | `position-service`    | `position`                | Aggregate positions by book/instrument |
| Risk        | `risk-service`        | `risk`                    | Counterparty limits, VaR snapshots     |
| ALM         | `alm-service`         | `alm`                     | LCR/NSFR reports, liquidity gap        |
| Back Office | `bo-service`          | _(none — stateless)_      | SWIFT matching, settlement             |
| Market Data | `market-data-service` | _(none — publisher only)_ | Rate publishing                        |

### The `domain` package is shared but infrastructure-free

`packages/domain` exports the aggregates, value objects, and domain events that
all services import. It **must never** import from `@prisma/client`, `kafkajs`,
`fastify`, or any other infrastructure library. If you need to add business logic,
add it here. If you need infrastructure wiring, add it in the relevant service.

---

## 5. Running the Full Stack Locally

```bash
# Start everything (15 containers)
docker-compose up -d

# Watch trade-service logs
docker-compose logs -f trade-service

# Stop everything
docker-compose down

# Stop and remove volumes (full reset)
docker-compose down -v
```

**Service ports (local dev):**

| Service             | Port | URL                                 |
| ------------------- | ---- | ----------------------------------- |
| web                 | 3000 | http://localhost:3000               |
| trade-service       | 4001 | http://localhost:4001/docs          |
| position-service    | 4002 | http://localhost:4002/health/live   |
| risk-service        | 4003 | http://localhost:4003/health/live   |
| alm-service         | 4004 | http://localhost:4004/health/live   |
| bo-service          | 4005 | http://localhost:4005/health/live   |
| market-data-service | 4006 | http://localhost:4006/metrics/rates |
| Kafka UI            | 8080 | http://localhost:8080               |
| Grafana             | 3001 | http://localhost:3001 (admin/admin) |
| Keycloak            | 8090 | http://localhost:8090               |

---

## 6. Running Tests

```bash
# All packages — unit + integration tests
pnpm test

# All packages — with coverage reports
pnpm test:coverage

# Single package
pnpm --filter @nexustreasury/domain test:coverage

# Watch mode (development)
pnpm --filter @nexustreasury/domain exec vitest --watch
```

**Coverage thresholds** (enforced in CI — will fail if not met):

| Package      | Lines | Functions | Branches |
| ------------ | ----- | --------- | -------- |
| `domain`     | 80%   | 80%       | 70%      |
| All services | 80%   | 80%       | 70%      |

---

## 7. Adding a New Service

Follow this checklist to add a new bounded context:

```bash
# 1. Scaffold the package
mkdir -p packages/my-service/src/routes
mkdir -p packages/my-service/src/application
mkdir -p packages/my-service/src/infrastructure/postgres

# 2. Copy package.json from an existing service and update:
#    - name: "@nexustreasury/my-service"
#    - port in server.ts

# 3. Add to pnpm-workspace.yaml (already covered by packages/*)

# 4. Add to turbo.json — explicit build dependency on domain:
#    "@nexustreasury/my-service#build": {
#      "dependsOn": ["@nexustreasury/domain#build"],
#      "outputs": ["dist/**"]
#    }

# 5. Add Prisma schema section to prisma/schema.prisma if needed
#    Add your schema name to the datasource schemas array

# 6. Add to docker-compose.yml (copy an existing service block)

# 7. Add Kubernetes manifests in infra/kubernetes/base/my-service.yaml

# 8. Add to CI Docker build matrix in .github/workflows/ci.yml
```

---

## 8. Adding a New Domain Concept

When adding a new aggregate, value object, or domain event to `packages/domain`:

1. **Aggregates** — Create in `src/{context}/{name}.aggregate.ts`
   - Must extend no base class (aggregates are plain classes)
   - Must have a private constructor and a static factory method (`create()` or `book()`)
   - Must collect domain events in `_domainEvents: DomainEvent[]`
   - Must expose `pullDomainEvents()` to drain the queue
   - Must define invariant guards (throw `{Name}DomainError` on invalid state)
   - Must define a `{Name}Repository` interface (never import Prisma here)

2. **Value Objects** — Add to `src/shared/value-objects.ts`
   - Use branded types: `export type MyId = Brand<string, 'MyId'>`
   - Make them immutable (`readonly` fields, return new instance from operations)

3. **Re-export** — Add to `src/index.ts`

4. **Test** — Add `src/{context}/{name}.aggregate.test.ts`
   - Must cover all factory invariants, all command methods, all domain events

---

## 9. Database Migrations

We use Prisma Migrate with a **single combined schema** at `prisma/schema.prisma`.
All four PostgreSQL schemas (`trading`, `position`, `risk`, `alm`) are defined there.

```bash
# Create a new migration (dev only)
pnpm exec prisma migrate dev --name add_my_new_field

# Apply migrations to staging/production (CI handles this automatically)
pnpm exec prisma migrate deploy

# Regenerate Prisma client after schema changes
pnpm exec prisma generate --schema=prisma/schema.prisma
```

> ⚠️ **Important:** Never run `prisma generate` inside individual service packages.
> Always run it from the repo root using the combined schema. Per-service generate
> calls overwrite each other's output (they all share one hoisted `@prisma/client`).

---

## 10. Branch and PR Strategy

```
main          ← protected, always deployable, gates: all CI jobs green + 1 approval
  └── feature/NEXUS-123-add-fx-spot-booking
  └── fix/NEXUS-456-position-drift-on-cancel
  └── chore/NEXUS-789-upgrade-fastify-5
```

**Rules:**

- Branch names must follow the pattern: `{type}/{ticket}-{short-description}`
- All PRs require at least **1 approval** (production deployments require 2)
- Squash-merge is preferred — one commit per feature on `main`
- Never force-push to `main`
- Delete branches after merge

---

## 11. Commit Message Format

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body]

[optional footer: closes NEXUS-xxx]
```

**Types:** `feat` | `fix` | `test` | `style` | `refactor` | `docs` | `chore` | `build` | `ci`

**Examples:**

```
feat(trade-service): add MT300 FX confirmation matching
fix(domain): position revalue throws on flat position
test(alm): add LCR breach scenario coverage
docs: add CONTRIBUTING.md and ARCHITECTURE.md
chore(deps): bump next from 15.5.0 to 15.5.14
```

---

## 12. CI Gates — What Must Pass Before Merge

All 10 jobs in `.github/workflows/ci.yml` must be green:

| Job                        | What it checks                                                       |
| -------------------------- | -------------------------------------------------------------------- |
| Install & Cache            | `pnpm install --frozen-lockfile` + `prisma generate` + `pnpm build`  |
| Lint & Format Check        | ESLint + Prettier (uses `.prettierignore` — Helm templates excluded) |
| TypeScript Type Check      | `pnpm typecheck` across all packages                                 |
| Unit & Integration Tests   | `pnpm test:coverage` — coverage thresholds enforced                  |
| SAST (CodeQL)              | Static security analysis on TypeScript                               |
| SCA (Snyk)                 | Dependency vulnerability scan                                        |
| Build & Scan Docker Images | Build all 7 Docker images + Trivy CVE scan                           |
| E2E Tests (Playwright)     | End-to-end UI tests against local stack                              |

> **If CI is failing:** Check the GitHub Actions tab. Each job logs its full output.
> The most common failures and their fixes are documented in `docs/ci-troubleshooting.md`.

---

## 13. Dependency Management

We use **Renovate Bot** (not Dependabot) for all dependency updates.
Renovate is configured in `renovate.json` with these rules:

| Update type                     | Behaviour                         |
| ------------------------------- | --------------------------------- |
| Security patches (any severity) | Auto-merged within 24 hours       |
| Minor/patch (non-security)      | Auto-merged after 3 days          |
| Major version upgrades          | PR opened, requires manual review |
| GitHub Actions                  | Same as minor/patch above         |

> **Do not open manual dependency PRs.** Let Renovate handle it.
> If you need an urgent dependency change, edit the relevant `package.json` and
> run `pnpm install` to regenerate the lockfile, then open a normal PR.

---

## 14. Environment Variables Reference

| Variable                       | Service                    | Description                                    | Example                                             |
| ------------------------------ | -------------------------- | ---------------------------------------------- | --------------------------------------------------- |
| `JWT_SECRET`                   | All services               | JWT signing secret — **required**, no fallback | Injected by Vault                                   |
| `DATABASE_URL`                 | trade, position, risk, alm | PostgreSQL connection string                   | `postgresql://nexus:pw@postgres:5432/nexustreasury` |
| `KAFKA_BROKERS`                | All services               | Comma-separated broker list                    | `kafka:29092`                                       |
| `REDIS_HOST`                   | trade-service              | Redis host for rate limiting                   | `redis`                                             |
| `REDIS_PORT`                   | trade-service              | Redis port                                     | `6379`                                              |
| `OTEL_EXPORTER_OTLP_ENDPOINT`  | All services               | OpenTelemetry collector endpoint               | `http://jaeger:4317`                                |
| `NEXT_PUBLIC_TRADE_SERVICE_WS` | web                        | WebSocket URL for live blotter                 | `ws://localhost:4001/api/v1/trades/stream`          |
| `RATE_SOURCE`                  | market-data-service        | Rate adapter: `MOCK`, `BLOOMBERG`, `REFINITIV` | `MOCK`                                              |

---

## 15. Useful Commands Cheatsheet

```bash
# Build
pnpm build                                          # build all packages
pnpm --filter @nexustreasury/domain build           # build one package

# Test
pnpm test                                           # run all tests
pnpm test:coverage                                  # run with coverage
pnpm --filter @nexustreasury/domain exec vitest --watch  # watch mode

# Prisma
pnpm exec prisma generate --schema=prisma/schema.prisma  # regenerate client
pnpm exec prisma migrate dev --name my_migration         # new migration
pnpm exec prisma studio                                   # GUI for data

# Lint / Format
pnpm lint                                           # ESLint check
pnpm exec prettier --write "**/*.{ts,tsx,yaml,md}" --ignore-path .prettierignore

# Docker
docker-compose up -d                                # start all infra
docker-compose logs -f trade-service               # tail a service
docker-compose down -v                             # full reset

# Release
git checkout -b release/v1.2.0
# bump versions, update CHANGELOG.md
git tag v1.2.0
git push origin v1.2.0                             # triggers CD pipeline
```
