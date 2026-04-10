# Day 1–2 — Architecture Primer

## The big picture: 3 architectural choices that shape everything

### 1. Domain-Driven Design (DDD)
Every business concept lives in one bounded context. You will never find a `LimitAggregate` in `accounting-service` — it belongs in `domain` and `risk-service`. When you need to add a feature, first ask: "Which bounded context owns this?"

### 2. Event-driven via Kafka
Services do not call each other over HTTP for state changes. Instead, they emit domain events to Kafka topics. This makes the system decoupled and resilient. Read `docs/architecture/c4/07-kafka-topology.md` before writing any service-to-service code.

### 3. Monorepo with pnpm workspaces
All 14 packages live in one repo under `packages/`. The `@nexustreasury/domain` package is the shared kernel — all services import from it. You never import from one service into another.

---

## Package map

```
packages/
  domain/                  ← shared kernel: pricing, risk, ALM, trading aggregates
  trade-service/    :4001  ← trade capture, pre-deal checks, FX auto-hedger
  risk-service/     :4003  ← VaR, FRTB, limits, capital stress
  alm-service/      :4004  ← LCR, NSFR, IRRBB, NMD modelling
  bo-service/       :4005  ← SWIFT matching, settlement, BERT recon, ISO 20022
  accounting-service/:4007 ← IFRS9 ECL, journals, XGBoost PD, Islamic IFRS9
  audit-service/    :4008  ← HMAC-anchored immutable audit log
  notification-svc/ :4009  ← SSE streaming, alerts, heartbeat
  collateral-svc/   :4010  ← ISDA CSA, GMRA, margin management
  reporting-svc/    :4011  ← COREP, FINREP, RAROC, AI assistant, reports
  planning-svc/     :4012  ← budgeting, FTP assessment, mismatch centre
  market-data-svc/         ← Bloomberg B-PIPE, adaptive failover
  position-service/        ← real-time P&L, MTM aggregation
  e2e/                     ← end-to-end test suite
  web/              :3000  ← Next.js React frontend
```

---

## Request lifecycle: trade booking

```
1. Dealer submits trade via React UI (HTTPS to web :3000)
2. Next.js API route → POST /api/v1/trades (trade-service :4001)
3. trade-service.PreDealCheckHandler:
     a. gRPC call to risk-service → check counterparty limit (< 5ms P99)
     b. If approved: save trade → emit nexus.trades.booked (Kafka)
4. Downstream consumers react asynchronously:
     - accounting-service: generate journal entries (IFRS9)
     - position-service:   update real-time P&L
     - risk-service:       recalculate VaR
     - notification-svc:   push SSE to UI → blotter updates in < 500ms
     - audit-service:      write HMAC-anchored audit event
5. Response to dealer: trade confirmed in < 100ms
```

---

## The domain package

`packages/domain/src/index.ts` is the single export point for all shared types. Before adding a type to a service, check whether it belongs here:

- **Put in domain**: Aggregates with business invariants (`LimitAggregate`, `LiquidityGapReport`), pricing engines (`PricingEngine`, `SukukPricer`), value objects (`Money`, `YieldCurve`, `Percentage`)
- **Keep in service**: Infrastructure adapters (`BloombergBPIPEAdapter`, `BERTBreakClassifier`), application use-case handlers, Fastify routes

---

## How to read the C4 diagrams

Start with `docs/architecture/c4/01-system-context.md` (why does NexusTreasury exist?), then `02-container.md` (the 14 services), then the `03-components-*.md` files for the specific service you're working on. `04-code-domain.md` shows the class-level design of the domain package.
