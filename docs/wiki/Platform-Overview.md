# Platform Overview

NexusTreasury is a **cloud-native, event-driven Treasury Management System (TMS)** built
for commercial and central banks. It handles the complete trade lifecycle from booking
through settlement, with real-time risk controls, liquidity analytics, and back-office
automation.

---

## Design Philosophy

Three principles drive every decision in this codebase:

**1. Business rules belong in the domain — not in the database, not in the API layer.**
The `@nexustreasury/domain` package contains all invariants, state transitions, and
business logic. Infrastructure (Prisma, Kafka, Fastify) is a detail, not the core.

**2. Services communicate via events, never via direct database access.**
If position-service needs to know about a new trade, it reads from Kafka —
not from the `trading` schema. Bounded context isolation is enforced structurally.

**3. The system must be auditable by design.**
Every state change produces a domain event. Events are persisted to outbox tables.
Nothing is updated silently. The full history of any trade or position can be
reconstructed from the event log.

---

## The Eight Services

```
┌─────────────────────────────────────────────────────────────┐
│             web  (Next.js 15, port 3000)                    │
│  TradingBlotter │ LiquidityDashboard │ RiskLimitPanel       │
│  WebSocket ◄────────────────────────────── REST + JWT       │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
  trade-service     risk-service     alm-service
  (port 4001)       (port 4003)      (port 4004)
  Trade lifecycle   Pre-deal check   LCR / NSFR
  Event outbox      Limit management Gap reports

          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
  position-service   bo-service    market-data-service
  (port 4002)        (port 4005)   (port 4006)
  Position keeping   SWIFT match   Rate publishing
  Event-sourced      Settlement    Kafka publisher
```

### Service Responsibilities

| Service               | Port | Primary Responsibility             | Database Schema |
| --------------------- | ---- | ---------------------------------- | --------------- |
| `web`                 | 3000 | UI — blotter, dashboards, alerts   | —               |
| `trade-service`       | 4001 | Book, amend, cancel, settle trades | `trading`       |
| `position-service`    | 4002 | Real-time position aggregation     | `position`      |
| `risk-service`        | 4003 | Pre-deal limit checks, VaR         | `risk`          |
| `alm-service`         | 4004 | LCR/NSFR, liquidity gap reports    | `alm`           |
| `bo-service`          | 4005 | SWIFT auto-matching, settlement    | — (stateless)   |
| `market-data-service` | 4006 | Rate publishing to Kafka           | — (publisher)   |
| `domain`              | —    | Shared aggregates, value objects   | —               |

---

## Key SLAs

| Metric                     | Target      | Measured by                     |
| -------------------------- | ----------- | ------------------------------- |
| Trade booking (end-to-end) | P99 < 100ms | `TradeBookingLatencyHigh` alert |
| Pre-deal limit check       | P99 < 5ms   | gRPC response time              |
| Platform uptime            | 99.99%      | Prometheus `ServiceDown` alert  |
| Throughput                 | 500+ TPS    | Load test baseline              |
| SWIFT STP rate             | ≥ 95%       | BO service exceptions count     |
| CVE patching               | < 24 hours  | `security-patch.yml` workflow   |

---

## Technology Stack

| Layer              | Technology                  | Why                                           |
| ------------------ | --------------------------- | --------------------------------------------- |
| API framework      | Fastify 4                   | 2–3× faster than Express; native TypeScript   |
| Language           | TypeScript 5                | Type safety across domain + infra layers      |
| Database           | PostgreSQL 16 + TimescaleDB | Multi-schema isolation, time-series for rates |
| Event bus          | Apache Kafka                | Exactly-once delivery, replay capability      |
| ORM                | Prisma 5                    | Type-safe queries, multi-schema support       |
| Cache / Rate limit | Redis 7                     | Rate limiting, session store                  |
| Identity           | Keycloak (OIDC)             | JWT issuance, multi-tenant claims             |
| Secrets            | HashiCorp Vault             | Agent injection at pod startup                |
| Container runtime  | Kubernetes 1.28             | HPA, topology spread, Cilium CNI              |
| GitOps             | ArgoCD                      | Auto-sync to staging, 2-approver prod gate    |
| Observability      | Prometheus + Grafana        | 11 alert rules, pre-built dashboards          |
| Tracing            | Jaeger (via OTLP)           | Distributed trace for cross-service calls     |
| Logging            | Pino → Elasticsearch        | Structured JSON, ELK stack                    |
| Frontend           | Next.js 15 + Tailwind       | App Router, real-time WebSocket               |
| Build system       | Turborepo                   | Parallel builds, task caching                 |
| Package manager    | pnpm 9                      | Strict hoisting, workspace links              |

---

## Multi-Tenancy Model

NexusTreasury is a **multi-tenant platform**. Each bank or business unit gets its own
`tenantId`. The `tenantId` is:

1. Issued in the JWT by Keycloak at login
2. Extracted from the JWT in every Fastify route handler
3. Applied as a `WHERE tenantId = ?` clause on every database query
4. Included in every Kafka event payload

There is no data model shared between tenants — isolation is enforced at the application
layer on every read and write. A future enhancement will add PostgreSQL Row Level Security
policies as a second defence layer.

---

## Regulatory Scope

NexusTreasury is designed to support compliance with:

| Standard               | Coverage                               |
| ---------------------- | -------------------------------------- |
| Basel IV / FRTB SA/IMA | Market risk capital                    |
| BCBS 368 (IRRBB)       | Interest rate risk in the banking book |
| BCBS 238 (LCR)         | Liquidity Coverage Ratio               |
| BCBS 295 (NSFR)        | Net Stable Funding Ratio               |
| EMIR / Dodd-Frank      | Trade reporting, clearing obligations  |
| IFRS 9 / Multi-GAAP    | Fair value accounting                  |
| SOC 2 Type II          | Security and availability controls     |

See [Regulatory Compliance](./Regulatory-Compliance.md) for detailed coverage maps.
