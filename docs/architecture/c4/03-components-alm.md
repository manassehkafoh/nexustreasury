# C4 Level 3 — ALM Service Components

Internal architecture of the **ALM Service** (`packages/alm-service`).
Covers liquidity gap, LCR/NSFR (Basel III), IRRBB (BCBS 368), and FTP.

## Diagram

```mermaid
flowchart TB
  subgraph almSvc["ALM Service  :4004"]
    routes["ALM Routes
Fastify / OpenAPI 3
GET /alm/liquidity-gap, /lcr, /nsfr, /irrbb, /ftp"]
    gapCalc["LiquidityGapCalculator
Domain Service
Cash ladder by tenor bucket O/N to 5Y+"]
    lcrCalc["LCRCalculator
Regulatory Domain Service
LCR = HQLA / Net 30-day Outflows (BCBS 238)"]
    nsfrCalc["NSFRCalculator
Regulatory Domain Service
NSFR = ASF / RSF (BCBS 295)"]
    irrbbEngine["IRRBBEngine
Regulatory Domain Service
EVE & NII under 6 BCBS 368 shock scenarios"]
    ftpEngine["FTPEngine
Domain Service
Funds Transfer Pricing by tenor/currency"]
    stressEngine["StressEngine
Domain Service
Bank-specific + market-wide stress, survival days"]
    gapAgg["LiquidityGapAggregate
DDD Aggregate Root
Immutable report per legalEntity + date"]
    gapRepo["GapReportRepository
Repository — Prisma
Persists gap reports, LCR/NSFR results"]
    posConsumer["PositionEventConsumer
Kafka Consumer
nexus.positions.updated"]
    cfConsumer["CashFlowConsumer
Kafka Consumer
nexus.alm.cashflow-updated"]
    rateConsumer["RateEventConsumer
Kafka Consumer
nexus.marketdata.curves"]
  end

  subgraph external["External"]
    kafka[("Apache Kafka")]
    pg[("PostgreSQL")]
    webApp[("Web App")]
  end

  kafka       -->|"nexus.positions.updated"| posConsumer
  kafka       -->|"nexus.alm.cashflow-updated"| cfConsumer
  kafka       -->|"nexus.marketdata.curves"| rateConsumer
  posConsumer -->|"refreshGap(legalEntityId)"| gapCalc
  cfConsumer  -->|"updateCashFlow(flow)"| gapCalc
  rateConsumer -->|"updateCurves(curves)"| irrbbEngine
  gapCalc     -->|"computeLCR(hqla, outflows)"| lcrCalc
  gapCalc     -->|"computeNSFR(asf, rsf)"| nsfrCalc
  gapCalc     -->|"runStress(scenario)"| stressEngine
  gapCalc     -->|"buildReport()"| gapAgg
  gapAgg      -->|"save(report)"| gapRepo
  gapRepo     -->|"INSERT gap_reports"| pg
  routes      -->|"GET /alm/liquidity-gap"| gapCalc
  routes      -->|"GET /alm/lcr"| lcrCalc
  routes      -->|"GET /alm/nsfr"| nsfrCalc
  routes      -->|"GET /alm/irrbb"| irrbbEngine
  routes      -->|"GET /alm/ftp"| ftpEngine
```

## LCR Calculation Flow

```mermaid
flowchart TD
  A[Cash Flows<br/>by Currency] --> B[Classify HQLA<br/>Level 1 / 2A / 2B]
  B --> C{Apply Haircuts}
  C -->|Level 1: 0%| D[HQLA Component]
  C -->|Level 2A: 15%| D
  C -->|Level 2B: 25-50%| D
  D --> E[Total HQLA<br/>after haircuts and caps]
  A --> F[30-Day Outflows<br/>by category]
  F --> G[Apply Run-off Rates<br/>Retail/Wholesale/ABCP]
  G --> H[Net Cash Outflows]
  E --> I[LCR = HQLA / Net Outflows]
  H --> I
  I -->|>= 100%| J[✅ Compliant]
  I -->|< 100%| K[❌ Breach — Alert]
```

## Regulatory References

| Metric          | Regulation              | Minimum             | Calculation Frequency    |
| --------------- | ----------------------- | ------------------- | ------------------------ |
| LCR             | BCBS 238 / CRR2 Art 412 | ≥ 100%              | Daily                    |
| NSFR            | BCBS 295 / CRR2 Art 428 | ≥ 100%              | Monthly (Daily internal) |
| IRRBB EVE       | BCBS 368                | Outlier < 15% CET1  | Quarterly                |
| IRRBB NII       | BCBS 368                | Outlier < 5% Tier 1 | Quarterly                |
| Survival Period | Internal / ILAAP        | ≥ 30 days           | Daily                    |
