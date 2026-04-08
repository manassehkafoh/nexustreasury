# NexusTreasury — Architecture Guide

This document explains the system design, key decisions, and the reasoning behind them.
It is the starting point for any engineer reviewing, extending, or debugging the platform.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Bounded Context Map](#2-bounded-context-map)
3. [Event Topology — Who Publishes What](#3-event-topology--who-publishes-what)
4. [Data Flow: Trade Booking (Happy Path)](#4-data-flow-trade-booking-happy-path)
5. [Domain Model Summary](#5-domain-model-summary)
6. [Infrastructure Layer](#6-infrastructure-layer)
7. [Security Architecture](#7-security-architecture)
8. [Database Architecture](#8-database-architecture)
9. [Kubernetes & GitOps](#9-kubernetes--gitops)
10. [Observability Stack](#10-observability-stack)
11. [Architecture Decision Records (ADRs)](#11-architecture-decision-records-adrs)

---

## 1. System Overview

NexusTreasury is a **cloud-native, event-driven Treasury Management System (TMS)**
designed for commercial and central banks. It provides real-time trade booking,
position keeping, pre-deal risk controls, ALM analytics, and back-office settlement.

```
┌─────────────────────────────────────────────────────────────────────┐
│  FRONT-END (Next.js 15)                                             │
│  TradingBlotter  │  LiquidityDashboard  │  RiskLimitPanel          │
│  WebSocket ◄──────────────────── REST / JWT ──────────────────►    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTPS + JWT (Keycloak OIDC)
┌──────────────────────────────▼──────────────────────────────────────┐
│  API GATEWAY LAYER (Fastify, port 4001–4006)                       │
│  trade-service │ position-service │ risk-service                   │
│  alm-service   │ bo-service       │ market-data-service            │
└────────┬───────────────┬───────────────────┬────────────────────────┘
         │ PostgreSQL     │ Kafka              │ gRPC (pre-deal check)
         │ (per schema)   │ (event bus)        │ risk-service
┌────────▼───────┐  ┌────▼──────────────┐  ┌──▼──────────────────────┐
│  PostgreSQL    │  │  Apache Kafka      │  │  Redis                  │
│  4 schemas     │  │  nexus.* topics    │  │  Rate limiting cache    │
│  + TimescaleDB │  │  exactly-once      │  │  Session store          │
└────────────────┘  └───────────────────┘  └─────────────────────────┘
```

**Core SLAs:**

- Trade booking P99: < 100ms end-to-end
- Pre-deal limit check P99: < 5ms (synchronous gRPC)
- Uptime: 99.99% (4 nines)
- Throughput: 500+ TPS
- STP rate: ≥ 95% (SWIFT auto-matching)

---

## 2. Bounded Context Map

Each service owns exactly one **bounded context** — a cohesive slice of the business
domain with its own data model, language, and invariants. Services communicate
**only via Kafka events** (async) or the **pre-deal gRPC channel** (sync).

```
┌──────────────────────────────────────────────────────────────────────────┐
│  @nexustreasury/domain  (shared kernel — no infrastructure)             │
│  Aggregates: Trade, Position, Limit, LiquidityGapReport                │
│  Value Objects: Money, BusinessDate, Percentage, branded IDs            │
│  Domain Events: TradeBooked, TradeAmended, LimitBreached, LCRBreach    │
└──────────────────────────────────────────────────────────────────────────┘
         ▲                ▲                ▲                ▲
         │                │                │                │
 ┌───────┴──────┐  ┌──────┴──────┐  ┌─────┴──────┐  ┌────┴──────────┐
 │   TRADING    │  │  POSITION   │  │    RISK    │  │     ALM       │
 │ trade-service│  │pos-service  │  │risk-service│  │ alm-service   │
 │              │  │             │  │            │  │               │
 │ Trade        │  │ Position    │  │ Limit      │  │LiquidityGap   │
 │ TradeEvent   │  │ PositionEvt │  │ VaRSnapshot│  │Report         │
 │              │  │             │  │            │  │               │
 │ DB: trading  │  │ DB: position│  │ DB: risk   │  │ DB: alm       │
 └──────────────┘  └─────────────┘  └────────────┘  └───────────────┘
```

```
 ┌──────────────────┐  ┌─────────────────────────┐
 │   BACK OFFICE    │  │     MARKET DATA          │
 │   bo-service     │  │  market-data-service     │
 │                  │  │                          │
 │ SWIFTMatcher     │  │ MockRateAdapter          │
 │ SettlementLadder │  │ BloombergBLPAPIAdapter   │
 │                  │  │ RefinitivRDPAdapter      │
 │ (stateless)      │  │ (publisher only)         │
 └──────────────────┘  └─────────────────────────┘
```

---

## 3. Event Topology — Who Publishes What

```
Producer                  Topic                        Consumer(s)
─────────────────────────────────────────────────────────────────────
trade-service    →  nexus.trading.trades         →  position-service
                                                 →  risk-service
                                                 →  bo-service

risk-service     →  nexus.risk.events            →  trade-service (breach alert)
                                                 →  web (real-time dashboard)

alm-service      →  nexus.alm.events             →  web (liquidity dashboard)

market-data-     →  nexus.marketdata.rates       →  risk-service (VaR recalc)
  service                                        →  position-service (MTM)
                                                 →  trade-service (pricing)
```

### Kafka Topic Naming Convention

All topics follow: `nexus.{context}.{aggregate-or-topic}`

- `nexus.trading.trades` — all Trade lifecycle events
- `nexus.position.positions` — Position update events
- `nexus.risk.events` — Limit breach / VaR events
- `nexus.alm.events` — LCR/NSFR report events
- `nexus.marketdata.rates` — Real-time rate ticks

### Domain Event Naming Convention

All domain events follow: `nexus.{context}.{entity}.{verb-past-tense}`

Examples:

- `nexus.trading.trade.booked`
- `nexus.trading.trade.amended`
- `nexus.trading.trade.cancelled`
- `nexus.trading.trade.settled`
- `nexus.position.position.updated`
- `nexus.position.position.revalued`
- `nexus.risk.limit.breached`
- `nexus.risk.limit.resolved`
- `nexus.alm.liquidity-gap.generated`
- `nexus.alm.lcr.breach`

---

## 4. Data Flow: Trade Booking (Happy Path)

This is the most critical flow. Understanding it gives you the mental model for everything else.

```
Web Browser (TradingBlotter)
    │
    │  POST /api/v1/trades  { assetClass, direction, notional, ... }
    │  Authorization: Bearer <JWT>
    ▼
trade-service (port 4001)
    │
    ├── 1. JWT verified (Fastify @fastify/jwt + Keycloak public key)
    │
    ├── 2. Zod validates request body (type-safe parse)
    │
    ├── 3. BookTradeCommand.execute()
    │       │
    │       ├── 3a. PreDealCheckService.check()
    │       │         └── (dev: PassThroughPreDealCheck — always approves)
    │       │             (prod: GrpcPreDealCheck → risk-service:50051)
    │       │             Target: P99 < 5ms
    │       │
    │       ├── 3b. Trade.book() — domain aggregate factory
    │       │         Enforces: value date > trade date, notional > 0,
    │       │                   currency must be 3 chars, etc.
    │       │         Emits: TradeBookedEvent
    │       │
    │       ├── 3c. TradeRepository.save()  → PostgreSQL trading schema
    │       │         + persistEvents() → trade_events outbox table
    │       │
    │       └── 3d. KafkaProducer.publishDomainEvents()
    │                 → nexus.trading.trades (exactly-once semantics)
    │
    ├── 4. HTTP 201 { tradeId, reference, status: "PENDING_VALIDATION" }
    │
    └── 5. BlotterGateway.broadcast() → WebSocket push to all blotter clients
               (trade-service holds a Set<WebSocket> of connected browsers)

Concurrently (async, Kafka-driven):
    │
    ├── position-service consumes nexus.trading.trades
    │       → PositionKafkaConsumer.onTradeBooked()
    │       → Position.applyTradeBooked() — updates net quantity, avg cost
    │       → PrismaPositionRepository.save/update()
    │       → Emits PositionUpdatedEvent
    │
    └── risk-service (future: consumes trade for limit utilisation update)
```

**Key timing characteristics:**

- Steps 1–4 (synchronous path): target P99 < 100ms
- Step 3a (pre-deal check): target P99 < 5ms
- Steps in "Concurrently" block: typically complete within 50–200ms of the trade
- WebSocket push (step 5): < 5ms after HTTP response

---

## 5. Domain Model Summary

### Trade Aggregate (`packages/domain/src/trading/trade.aggregate.ts`)

The central entity. Enforces the complete lifecycle:

```
PENDING_VALIDATION → VALIDATED → CONFIRMED → SETTLED
                 ↘              ↗
                  → AMENDED ──→
                  → CANCELLED
```

All state transitions are guarded by invariants. You cannot settle a trade that
is not CONFIRMED. You cannot amend a SETTLED trade. Violations throw `TradeDomainError`.

### Position Aggregate (`packages/domain/src/position/position.aggregate.ts`)

Event-sourced. Rebuilt by replaying `TradeBookedEvent` and `TradeCancelledEvent`.
Tracks: net quantity, average cost, MTM value, unrealised P&L.
Supports revaluation when market data updates.

### Limit Aggregate (`packages/domain/src/risk/limit.aggregate.ts`)

Enforces pre-deal and exposure controls at four levels:
`LEGAL_ENTITY | BOOK | TRADER | COUNTERPARTY`

The `checkPreDeal()` method is called synchronously before every trade booking.
It returns `{ approved, utilisationPct, headroom, failureReasons }`.
Breaches emit `LimitBreachedEvent`. Resolution emits `LimitResolvedEvent`.

### LiquidityGapReport Aggregate (`packages/domain/src/alm/liquidity-gap.aggregate.ts`)

Generated on-demand or on schedule. Calculates:

- **LCR** (Liquidity Coverage Ratio) per BCBS 238 — must be ≥ 100%
- **NSFR** (Net Stable Funding Ratio) per BCBS 295 — must be ≥ 100%
- Cumulative cash flow gaps across 9 BCBS time buckets

Basel III HQLA haircuts are applied in `LCRCalculator`:

- Level 2A assets: 15% haircut
- Level 2B assets: 25% haircut (conservative), capped at 15% of total HQLA

---

## 6. Infrastructure Layer

### Why Fastify over Express?

Fastify was chosen over Express for three reasons:

1. **Performance** — 2–3× faster request throughput (important at 500 TPS target)
2. **Native TypeScript** — First-class JSON schema validation with full type inference
3. **Plugin system** — `@fastify/jwt`, `@fastify/swagger`, `@fastify/websocket`
   compose cleanly without the middleware ordering issues of Express

### Why pnpm over npm/Yarn?

pnpm's strict hoisting and workspace protocol (`workspace:*`) prevents phantom
dependency issues that silently break builds in npm. It's also significantly faster
for installs in monorepos and creates correct symlinks for cross-package imports.

### Kafka — Exactly-Once Semantics

All Kafka producers are configured with `idempotent: true`. Combined with
`transactional` consumers on the position-service side, this gives exactly-once
delivery for trade events — critical for position accuracy.

### Pre-Deal Check Architecture

The pre-deal check is the one **synchronous** inter-service call in the system.
It uses gRPC (not HTTP) because:

- gRPC is binary (Protocol Buffers) — lower latency than JSON/HTTP
- gRPC supports streaming for future real-time limit streaming
- Target P99 of 5ms requires every microsecond to count

In development/test, `PassThroughPreDealCheck` is used (always approves).
In production, `GrpcPreDealCheck` connects to `risk-service:50051`.

---

## 7. Security Architecture

### Authentication & Authorization

- **Identity Provider:** Keycloak (OIDC/OAuth2)
- **Token format:** JWT (RS256 signed by Keycloak)
- **Validation:** `@fastify/jwt` on every service using Keycloak's public key
- **Tenant isolation:** `tenantId` claim extracted from JWT and applied to all
  database queries — no data from other tenants can leak through the API

### Zero Trust Networking (Kubernetes)

- **Cilium eBPF** provides default-deny-all network policy
- Explicit allowlists: each service declares which pods it can receive traffic from
- Workload identity via ServiceAccount tokens (no shared secrets between pods)

### Container Security

All Docker images run as:

- Non-root user (UID 1001, group `nexus`)
- Read-only root filesystem (`readOnlyRootFilesystem: true`)
- All capabilities dropped (`drop: [ALL]`)
- No privilege escalation (`allowPrivilegeEscalation: false`)

### Secret Management

- **HashiCorp Vault** agent injects secrets at pod startup
- `JWT_SECRET` is never hardcoded — service fails fast at startup if missing
- All `*-secret.yaml` and `*-values-prod.yaml` files are in `.gitignore`

---

## 8. Database Architecture

### One Prisma Schema, Four PostgreSQL Schemas

```
PostgreSQL database: nexustreasury
  ├── Schema: trading       (owned by trade-service)
  │   ├── trades
  │   └── trade_events
  ├── Schema: position      (owned by position-service)
  │   ├── positions
  │   └── position_events
  ├── Schema: risk          (owned by risk-service)
  │   ├── limits
  │   └── var_snapshots
  └── Schema: alm           (owned by alm-service)
      └── liquidity_gap_reports
```

The `prisma/schema.prisma` file at the repo root defines all models with
`@@schema()` annotations and `previewFeatures = ["multiSchema"]`. A single
`prisma generate` creates one `@prisma/client` with all 7 models.

> **Why not separate databases?** This is a deliberate trade-off. Separate databases
> would give perfect isolation but complicate local dev, migrations, and cross-schema
> reporting. PostgreSQL schemas give strong isolation without the operational overhead.
> We can split to separate databases in a future major version if needed.

### Row Level Security

All tables have `@@schema()` annotations. Application-level tenantId filters
are applied on every query. A future enhancement will add PostgreSQL RLS policies
for defence-in-depth.

---

## 9. Kubernetes & GitOps

### Deployment Model

```
Developer push → main
    ↓
GitHub Actions ci.yml (lint, test, build, scan)
    ↓ (on success)
GitHub Actions cd-staging.yml
    ↓
ArgoCD nexustreasury-staging (auto-sync, prune + selfHeal)
    ↓ (manual promotion)
ArgoCD nexustreasury-production (manual sync, 2-approver gate)
```

### Overlay Structure (Kustomize)

```
infra/kubernetes/
├── base/                  # All manifests (Deployment + Service + HPA + ServiceAccount)
└── overlays/
    ├── staging/           # 1 replica, debug logging, staging image tags
    └── production/        # 3–20 replicas, info logging, pinned release tags
```

### HPA Configuration

All services scale between 3 (min) and 20 (max) replicas in production.
CPU threshold: 70% average utilisation triggers scale-up.
Scale-down is stabilised over 5 minutes to prevent flapping.

---

## 10. Observability Stack

| Tool                       | Purpose                                | Access                      |
| -------------------------- | -------------------------------------- | --------------------------- |
| **Grafana**                | Metrics dashboards                     | :3001 (admin/admin locally) |
| **Prometheus**             | Metrics collection, 11 alert rules     | :9090                       |
| **Jaeger** (via OTLP)      | Distributed tracing                    | :16686                      |
| **Elasticsearch + Kibana** | Structured log aggregation (Pino JSON) | :5601                       |
| **Kafka UI**               | Topic inspection, consumer group lag   | :8080                       |

### Prometheus Alert Rules

11 rules across 5 groups (in `infra/monitoring/alerts/nexustreasury.rules.yaml`):

| Group    | Rule                                    | Severity |
| -------- | --------------------------------------- | -------- |
| Trading  | `TradeBookingLatencyHigh` (P99 > 100ms) | warning  |
| Trading  | `TradeServiceErrorRateHigh` (> 1%)      | critical |
| Platform | `KafkaConsumerLagHigh`                  | warning  |
| Platform | `ServiceDown` (1 minute)                | critical |
| Platform | `PodRestartingFrequently`               | warning  |
| ALM      | `LCRBelowMinimum` (< 100%)              | critical |
| ALM      | `LCRApproachingThreshold` (< 110%)      | warning  |
| ALM      | `NSFRBelowMinimum` (< 100%)             | critical |
| Risk     | `LimitBreachDetected`                   | critical |
| Security | `AuthFailureSpike`                      | warning  |
| Security | `CriticalCVEFound`                      | critical |

---

## 11. Architecture Decision Records (ADRs)

ADRs capture _why_ a decision was made, not just _what_ was decided.
See `docs/adr/` for the full list.

### ADR-001: Single Combined Prisma Schema at Root

**Status:** Accepted

**Context:** Four services need Prisma. In a pnpm monorepo, all packages share
a hoisted `@prisma/client`. Each `prisma generate` overwrites the shared
`.prisma/client/` output — whichever service runs last wins.

**Decision:** One `prisma/schema.prisma` at the repo root with all 7 models,
using `@@schema()` annotations and `previewFeatures = ["multiSchema"]`.
One `prisma generate` at root creates a single client with all models.

**Consequences:** All services share one Prisma client type. Schema changes
require a migration that runs on all schemas. Benefit: no race condition,
simpler CI, simpler developer workflow.

---

### ADR-002: Renovate Bot Instead of Dependabot

**Status:** Accepted

**Context:** Both Dependabot and Renovate Bot were active simultaneously,
creating duplicate PRs and lockfile conflicts.

**Decision:** Dependabot disabled (`open-pull-requests-limit: 0` for all
ecosystems in `.github/dependabot.yml`). Renovate handles npm, GitHub Actions,
and Docker base images via `renovate.json`.

**Consequences:** All dependency updates come through Renovate PRs. Security
patches auto-merge within 24 hours (SOC 2 CC6.8 evidence). Major upgrades
require manual review.

---

### ADR-003: Turbo v2 `tasks` Instead of `pipeline`

**Status:** Accepted

**Context:** Turbo v2.0 renamed the `pipeline` key to `tasks` in `turbo.json`.
The old key caused `error: "pipeline" has been renamed to "tasks"` on all builds.

**Decision:** Migrated `turbo.json` to use `tasks`. Added explicit
`@nexustreasury/{service}#build` entries with `dependsOn: ["@nexustreasury/domain#build"]`
to guarantee build order regardless of Turbo parallelism.

**Consequences:** Domain package always builds before any service. The
`tsc --build --force` flag ensures dist/ is always emitted even if a stale
`tsconfig.tsbuildinfo` is present (common cause of CI failures on fresh clones).

---

### ADR-004: (app as any).get() for @fastify/websocket Routes

**Status:** Accepted

**Context:** `@fastify/websocket` augments Fastify's `app.get()` with a
`websocket: true` route option and a different handler signature at runtime.
These augmentations are not reflected in Fastify's core TypeScript types,
causing `TS2353: websocket does not exist on RouteShorthandOptions`.

**Decision:** Cast `(app as any).get(...)` with an eslint-disable comment
on `BlotterGateway.register()`. This is the standard pattern for Fastify plugins
that augment the app without full declaration merging.

**Consequences:** One line of type unsafety, explicitly documented. The
`eslint-disable-next-line @typescript-eslint/no-explicit-any` comment makes
the intent visible to reviewers.

---

### ADR-005: `@ts-expect-error` Banned in Favour of Explicit Casts

**Status:** Accepted

**Context:** `@ts-expect-error` suppresses the next TypeScript error but
becomes a compile error itself if the error goes away (TS2578: unused directive).
This made CI brittle — a type improvement in a library would break our build.

**Decision:** Use explicit `as unknown as TargetType` casts with explanatory
comments rather than `@ts-expect-error`. Reserved for unavoidable runtime
augmentations only.

---

### ADR-006: One Vitest Config Per Package with `tsc --build --force`

**Status:** Accepted

**Context:** Without `vitest.config.ts` in each package, coverage thresholds,
test environment settings, and TypeScript path alias resolution all fail silently.

**Decision:** Each package has its own `vitest.config.ts`. Backend services use
`environment: 'node'`. The `web` package uses `environment: 'jsdom'`.
Coverage thresholds: 80% lines/functions/statements, 70% branches.

`tsc --build --force` is used (not just `tsc --build`) so that the `dist/`
directory is always emitted on CI fresh clones, even if a stale `tsconfig.tsbuildinfo`
from a prior build claims "nothing changed".
