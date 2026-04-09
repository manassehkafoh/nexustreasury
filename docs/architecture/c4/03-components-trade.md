# C4 Level 3 — Trade Service Components

Internal architecture of the **Trade Service** (`packages/trade-service`).

## Diagram

```mermaid
C4Component
  title Trade Service — Component Diagram

  Container_Boundary(tradeSvc, "Trade Service  :4001") {

    Component(routes,     "Trade Routes",        "Fastify routes / OpenAPI 3",
      "HTTP endpoints: POST /trades, GET /trades/:id, PATCH /trades/:id, DELETE /trades/:id")
    Component(preDeal,    "PreDealCheckHandler", "Application Service",
      "Orchestrates pre-deal checks: limit availability, counterparty exposure, book capacity.")
    Component(bookCmd,    "BookTradeCommand",    "CQRS Command Handler",
      "Validates and executes trade booking. Enforces invariants on Trade aggregate.")
    Component(tradeAgg,   "Trade Aggregate",     "DDD Aggregate Root",
      "Trade entity with value objects (Money, BusinessDate, TradeId). Raises domain events.")
    Component(tradeRepo,  "TradeRepository",     "Repository (Prisma)",
      "Persistence adapter. Maps Trade aggregate ↔ database rows. Handles optimistic locking.")
    Component(kafkaPub,   "KafkaTradePublisher", "Infrastructure — Kafka Producer",
      "Publishes TradeCreatedEvent, TradeAmendedEvent, TradeCancelledEvent to Kafka topics.")
    Component(wsGateway,  "BlotterGateway",      "Infrastructure — WebSocket",
      "Pushes real-time blotter updates to connected trading desks via WebSocket.")
    Component(rateAdapter,"MockRateAdapter",     "Infrastructure — Market Data",
      "Fetches latest FX/MM rates from Redis cache (populated by Market Data Service).")
    Component(authGuard,  "JWT Auth Guard",      "Infrastructure — Security",
      "Validates Bearer JWT token on every request. Extracts tenantId, userId, roles.")
    Component(otelTrace,  "OTel Tracer",         "Infrastructure — Observability",
      "Instruments every request with distributed trace spans (OpenTelemetry SDK).")
  }

  Container(apiGW,    "API Gateway",        "Kong/Nginx", "Routes authenticated requests")
  Container(kafka,    "Apache Kafka",       "",           "Event bus")
  ContainerDb(pg,     "PostgreSQL",         "",           "Trades, books, counterparties")
  ContainerDb(redis,  "Redis",              "",           "Market data rate cache")
  Container(webApp,   "Next.js Web App",    "",           "Trading blotter")

  Rel(apiGW,       routes,      "POST/GET/PATCH/DELETE /trades", "HTTP/2")
  Rel(routes,      authGuard,   "Validate JWT + tenantId",       "in-process")
  Rel(routes,      preDeal,     "checkPreDeal(command)",         "in-process")
  Rel(routes,      bookCmd,     "execute(BookTradeCommand)",      "in-process")
  Rel(preDeal,     tradeAgg,    "Inspect aggregate state",       "in-process")
  Rel(bookCmd,     tradeAgg,    "Apply domain logic",            "in-process")
  Rel(bookCmd,     tradeRepo,   "save(trade)",                   "in-process")
  Rel(bookCmd,     kafkaPub,    "publish(TradeCreatedEvent)",     "in-process")
  Rel(bookCmd,     wsGateway,   "broadcast(blotter update)",      "in-process")
  Rel(preDeal,     rateAdapter, "getCurrentRate(pair)",           "in-process")
  Rel(tradeRepo,   pg,          "SELECT / INSERT / UPDATE",      "pg-wire/TLS")
  Rel(rateAdapter, redis,       "GET nexus:rate:{pair}",         "Redis protocol")
  Rel(kafkaPub,    kafka,       "nexus.trading.trades.created",  "SASL/PLAINTEXT")
  Rel(wsGateway,   webApp,      "Real-time blotter events",      "WSS")
  Rel(routes,      otelTrace,   "Trace span per request",        "in-process")
```

## Component Responsibilities

| Component             | Pattern            | Key Invariants                                                  |
| --------------------- | ------------------ | --------------------------------------------------------------- |
| `BookTradeCommand`    | CQRS Command       | Trade must pass pre-deal check; notional > 0; valid value date  |
| `PreDealCheckHandler` | Domain Service     | Limit utilisation ≤ 100%; counterparty not blocked; book active |
| `Trade Aggregate`     | DDD Aggregate Root | Immutable after CONFIRMED; cancel only before settlement        |
| `TradeRepository`     | Repository         | Optimistic locking via `updatedAt`; tenant isolation enforced   |
| `KafkaTradePublisher` | Event Publisher    | Idempotent via `tradeRef`; exactly-once via Kafka transactions  |
| `BlotterGateway`      | WebSocket          | Per-tenant room isolation; JWT-scoped subscriptions             |

## SLA Targets

| Metric                       | Target    |
| ---------------------------- | --------- |
| Trade booking P99 latency    | < 100ms   |
| Pre-deal check P99 latency   | < 5ms     |
| WebSocket blotter update lag | < 50ms    |
| Throughput                   | ≥ 500 TPS |
| Error rate                   | < 0.01%   |
