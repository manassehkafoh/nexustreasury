# C4 Level 3 — Trade Service Components

Internal architecture of the **Trade Service** (`packages/trade-service`).

## Diagram

```mermaid
flowchart TB
  subgraph tradeSvc["Trade Service  :4001"]
    routes["Trade Routes
Fastify / OpenAPI 3
POST/GET/PATCH/DELETE /trades"]
    authGuard["JWT Auth Guard
Validates Bearer JWT
Extracts tenantId, userId, roles"]
    preDeal["PreDealCheckHandler
Application Service
Limit check, exposure, book capacity"]
    bookCmd["BookTradeCommand
CQRS Command Handler
Apply domain invariants"]
    tradeAgg["Trade Aggregate
DDD Aggregate Root
Money, BusinessDate, TradeId"]
    tradeRepo["TradeRepository
Repository — Prisma
Optimistic locking, tenant scope"]
    kafkaPub["KafkaTradePublisher
Kafka Producer
TradeCreated/Amended/Cancelled"]
    wsGateway["BlotterGateway
WebSocket
Real-time blotter push"]
    rateAdapter["MockRateAdapter
Market Data
Reads from Redis rate cache"]
    otelTrace["OTel Tracer
Observability
Trace span per request"]
  end

  subgraph external["External"]
    apiGW[("API Gateway")]
    kafka[("Apache Kafka")]
    pg[("PostgreSQL")]
    redis[("Redis")]
    webApp[("Next.js Web App")]
  end

  apiGW    -->|"POST/GET/PATCH/DELETE /trades"| routes
  routes   -->|"Validate JWT + tenantId"| authGuard
  routes   -->|"checkPreDeal(command)"| preDeal
  routes   -->|"execute(BookTradeCommand)"| bookCmd
  preDeal  -->|"Inspect aggregate state"| tradeAgg
  bookCmd  -->|"Apply domain logic"| tradeAgg
  bookCmd  -->|"save(trade)"| tradeRepo
  bookCmd  -->|"publish(TradeCreatedEvent)"| kafkaPub
  bookCmd  -->|"broadcast(blotter update)"| wsGateway
  preDeal  -->|"getCurrentRate(pair)"| rateAdapter
  tradeRepo -->|"SELECT / INSERT / UPDATE"| pg
  rateAdapter -->|"GET nexus:rate:{pair}"| redis
  kafkaPub -->|"nexus.trading.trades.created"| kafka
  wsGateway -->|"Real-time blotter events"| webApp
  routes   -->|"Trace span per request"| otelTrace
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
