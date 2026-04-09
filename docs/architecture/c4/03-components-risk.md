# C4 Level 3 — Risk Service Components

Internal architecture of the **Risk Service** (`packages/risk-service`).
Covers VaR, FRTB SA/IMA, XVA, and counterparty limit management.

## Diagram

```mermaid
flowchart TB
  subgraph riskSvc["Risk Service  :4003"]
    routes["Risk Routes
Fastify / OpenAPI 3
GET /risk/var, /risk/limits, /risk/xva, /risk/frtb"]
    varCalc["VaR Calculator
Domain Service
Historical 250-day + Monte Carlo 10k paths · 99% CI"]
    frtbEngine["FRTB SA/IMA Engine
Regulatory Domain Service
Basel IV capital calculation"]
    xvaEngine["XVA Engine
Domain Service
CVA, DVA, FVA, MVA per counterparty"]
    limitMgr["LimitManager
Domain Service
Pre-deal orchestrator — FX, credit, DV01, VaR"]
    limitAgg["Limit Aggregate
DDD Aggregate Root
Type, amount, utilised, status"]
    limitRepo["LimitRepository
Repository — Prisma
Optimistic locking, tenant scope"]
    posConsumer["PositionEventConsumer
Kafka Consumer
nexus.positions.updated"]
    rateConsumer["RateEventConsumer
Kafka Consumer
nexus.marketdata.rates"]
    limitPub["LimitBreachPublisher
Kafka Producer
nexus.risk.limit-breach"]
    varPub["VaRResultPublisher
Kafka Producer
nexus.risk.var-calculated"]
    otelTrace["OTel Tracer
Observability
VaR duration, limit check latency"]
  end

  subgraph external["External"]
    kafka[("Apache Kafka")]
    pg[("PostgreSQL")]
    notifSvc[("Notification Svc")]
    webApp[("Web App")]
  end

  kafka        -->|"nexus.positions.updated"| posConsumer
  kafka        -->|"nexus.marketdata.rates"| rateConsumer
  posConsumer  -->|"checkLimits(position)"| limitMgr
  posConsumer  -->|"recalculate(bookId)"| varCalc
  rateConsumer -->|"updateRiskFactors(rates)"| varCalc
  limitMgr     -->|"evaluate(utilisation)"| limitAgg
  limitMgr     -->|"publish(LimitBreachEvent)"| limitPub
  varCalc      -->|"computeCapital(positions)"| frtbEngine
  varCalc      -->|"publish(VaRResultEvent)"| varPub
  limitAgg     -->|"save(limit)"| limitRepo
  limitRepo    -->|"SELECT/UPDATE limits"| pg
  limitPub     -->|"nexus.risk.limit-breach"| kafka
  varPub       -->|"nexus.risk.var-calculated"| kafka
  kafka        -->|"nexus.risk.limit-breach"| notifSvc
  routes       -->|"GET /risk/var"| varCalc
  routes       -->|"GET/POST /risk/limits"| limitMgr
  routes       -->|"GET /risk/xva"| xvaEngine
  routes       -->|"GET /risk/frtb"| frtbEngine
```

## Limit Types Supported

| Limit Type           | Scope               | Unit             | Basel Reference         |
| -------------------- | ------------------- | ---------------- | ----------------------- |
| FX Net Open Position | Book                | Notional (CCY)   | Basel II Pillar 1       |
| Counterparty Credit  | Counterparty        | Notional (CCY)   | EMIR/CRR2               |
| DV01 (Interest Rate) | Book                | USD per bp       | FRTB SB-DRC             |
| VaR                  | Book / Portfolio    | USD (99%, 1-day) | Basel III / FRTB IMA    |
| CVA                  | Counterparty        | USD              | Basel III CVA framework |
| FRTB SA Capital      | Desk / Legal Entity | USD              | Basel IV FRTB SA        |

## VaR Calculation Methods

```mermaid
flowchart LR
  A[Position Snapshot] --> B{Method?}
  B -->|Historical| C[250-Day Window<br/>P&L Series]
  B -->|Monte Carlo| D[10,000 Paths<br/>Correlated RF]
  C --> E[Sort Returns<br/>1st Percentile]
  D --> F[Expected Shortfall<br/>CVaR 97.5%]
  E --> G[1-Day VaR<br/>99% CI]
  F --> H[Scaled to<br/>10-Day VaR]
  G --> I[VaR Result Store]
  H --> I
  I --> J[FRTB Capital<br/>Calculation]
```
