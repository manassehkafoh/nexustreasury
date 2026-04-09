# C4 Level 3 — Accounting Bounded Context Component Diagram

> **Sprint**: Sprint 2 (P1 — Accounting Service)
> **Last Updated**: 2026-04-09

---

## Component Overview

```mermaid
flowchart TB
  subgraph AC["accounting-service (port 4007)"]
    direction TB

    subgraph DOM["Domain Layer"]
      JE["JournalEntry\n(Aggregate Root)\n\nImmutable once POSTED.\nPer-currency double-entry\nbalance enforced.\nReversals only — no edits.\nDomain events: Posted, Reversed"]
      COA["ChartOfAccounts\n\nStandard banking CoA\n(1000–8999 codes).\nTenant overrides applied\nat provisioning time.\nIFRS9 category tags."]
      IFRS9["IFRS9Classifier\n\nStep 1: SPPI test\nStep 2: Business model\nDecision: AMC/FVOCI/FVPL\nTenant override support.\nML hook: InstrumentTextClassifier"]
      VO["Value Objects\n\nIFRS9Category, ECLStage\nHedgeType, AccountType\nEntryDirection, BusinessModel\nBranded IDs: JournalEntryId\nAccountId, SchemaId"]
    end

    subgraph APP["Application Layer"]
      TBH["TradeBookedHandler\n\nConsumes TradeBookedEvent.\nClassifies instrument (IFRS9).\nGenerates journal entries\nper asset class:\nBond / MM / Repo / IRS / FX.\nAI hook: NarrativeGenerator"]
      ECL["ECLCalculator\n\nIFRS9 Stage 1/2/3 ECL.\nECL = PD × LGD × EAD × DF\nSICR triggers: DPD, notches,\nwatch-list, credit-impaired.\nConfigurable thresholds.\nML hook: PDModelAdapter\n(macro scenario overlay)"]
      HAS["HedgeAccountingService\n\nEffectiveness test:\nDollar-offset (IAS 39.88)\nRegression (R² ≥ 0.80)\nJE generation: FVH/CFH/NIH\nEffective → OCI\nIneffective → P&L\nML hook: EffectivenessMLModel"]
    end

    subgraph INFRA["Infrastructure Layer"]
      KC["AccountingKafkaConsumer\n\nTopics:\nnexus.trading.trades.booked\nIdempotency: Redis TTL 7d\nRetry: 3 attempts\nDLQ: nexus.accounting.dlq"]
      REPO["JournalEntryRepository\n(interface)\n\nPrisma implementation:\nPostgreSQL with RLS\n(tenant isolation)"]
    end

    subgraph API["API Layer (Fastify)"]
      RT["AccountingRoutes\n\nPOST /journal-entries\nGET  /journal-entries/by-trade\nPOST /ecl\nPOST /hedge/effectiveness-test\nGET  /chart-of-accounts\nJWT auth + rate limit"]
    end
  end

  subgraph EXT["External — Kafka"]
    K1["nexus.trading.trades.booked"]
    K2["nexus.accounting.journal-entries"]
    K3["nexus.accounting.dlq"]
  end

  subgraph DS["Data Store"]
    PG["PostgreSQL\njournal_entries table\njournal_entry_lines table\nRow Level Security (RLS)"]
  end

  K1 --> KC --> TBH
  TBH --> JE
  TBH --> IFRS9
  TBH --> COA
  JE --> REPO --> PG
  JE -->|"JournalEntryPostedEvent"| K2
  KC -->|"on failure"| K3

  RT --> TBH
  RT --> ECL
  RT --> HAS
  RT --> REPO
  RT --> COA

  classDef domain  fill:#1a3a5c,stroke:#4a90d9,color:#e8f4ff
  classDef app     fill:#1a4a2a,stroke:#4a9d5a,color:#e8ffe8
  classDef infra   fill:#4a2a1a,stroke:#9d5a2a,color:#ffe8e0
  classDef api     fill:#3a3a1a,stroke:#9d9d2a,color:#fffff0
  classDef ext     fill:#2a1a4a,stroke:#6a4a9d,color:#f0e8ff
  classDef store   fill:#1a3a3a,stroke:#2a9d9d,color:#e8ffff

  class JE,COA,IFRS9,VO domain
  class TBH,ECL,HAS app
  class KC,REPO infra
  class RT api
  class K1,K2,K3 ext
  class PG store
```

---

## IFRS9 Classification Decision Tree

```mermaid
flowchart TD
  A["New Financial Instrument"] --> OV{Tenant Override?}
  OV -->|Yes| OVC["Apply override category"]
  OV -->|No| FVO{FVO Election?}
  FVO -->|Yes| FVPL["FVPL\n(§4.1.5 FVO)"]
  FVO -->|No| EQ{Equity\nInstrument?}
  EQ -->|Yes + FVOCI desig.| FVOCI_E["FVOCI Equity\n(§4.1.4)"]
  EQ -->|Yes, no desig.| FVPL_M1["FVPL Mandatory\n(equity default)"]
  EQ -->|No| DERIV{Derivative?}
  DERIV -->|Yes| FVPL_M2["FVPL Mandatory\n(leveraged CFs)"]
  DERIV -->|No| SPPI{SPPI Test\nPass?}
  SPPI -->|Fail| FVPL_M3["FVPL Mandatory\n(non-SPPI)"]
  SPPI -->|Pass| BM{Business\nModel}
  BM -->|HTC| AMC["Amortised Cost\n(§4.1.2)"]
  BM -->|HTC+Sell| FVOCI_B["FVOCI\n(§4.1.2A)"]
  BM -->|Other| FVPL_M4["FVPL Mandatory\n(trading)"]

  classDef cat fill:#1a4a2a,stroke:#4a9d5a,color:#e8ffe8
  class AMC,FVOCI_B,FVOCI_E,FVPL,FVPL_M1,FVPL_M2,FVPL_M3,FVPL_M4,OVC cat
```

---

## Journal Entry Generation — Asset Class Matrix

| Asset Class      | Direction     | DR Account                | CR Account         | IFRS9          |
| ---------------- | ------------- | ------------------------- | ------------------ | -------------- |
| Fixed Income     | BUY           | 1300/1310/1320 (category) | 8100 (clearing)    | AMC/FVOCI/FVPL |
| Fixed Income     | SELL          | 8100 (clearing)           | 1300/1310/1320     | AMC/FVOCI/FVPL |
| Money Market     | Placement     | 1500 (MM asset)           | 1100 (nostro)      | AMC            |
| Money Market     | Borrowing     | 1100 (nostro)             | 2300 (MM liab)     | AMC            |
| Repo             | SELL (repo)   | 1100 (cash in)            | 2900 (liability)   | AMC            |
| Repo             | BUY (reverse) | 1600 (securities)         | 1100 (cash out)    | AMC            |
| FX Spot          | BUY base      | 1100 (base nostro)        | 8100 (base clear)  | FVPL           |
| FX Spot          | BUY base      | 8100 (term clear)         | 1100 (term nostro) | FVPL           |
| IRS at-market    | —             | _no entry (NPV=0)_        |                    | FVPL           |
| IRS with premium | Payer         | 1400 (IRS asset)          | 1100 (nostro)      | FVPL           |

---

## ECL Staging (IFRS 9 §5.5)

```mermaid
stateDiagram-v2
  [*] --> Stage1: Origination
  Stage1: Stage 1 — Performing\n12-month ECL
  Stage2: Stage 2 — Underperforming\nLifetime ECL (SICR)
  Stage3: Stage 3 — Non-Performing\nLifetime ECL (credit-impaired)

  Stage1 --> Stage2: SICR triggered\n(DPD≥30, rating −2 notches,\nwatch-list)
  Stage2 --> Stage1: SICR cured
  Stage2 --> Stage3: Credit-impaired\n(DPD≥90, default, D-rating)
  Stage3 --> Stage2: Cure (rare)
```

---

## AI/ML Configuration Points

| Hook                | Interface                      | Default             | Production Example                       |
| ------------------- | ------------------------------ | ------------------- | ---------------------------------------- |
| IFRS9 classifier    | `InstrumentTextClassifier`     | Rule-based          | Fine-tuned LLM on term sheets            |
| ECL PD model        | `PDModelAdapter`               | Rating lookup table | XGBoost with macro overlays              |
| Hedge effectiveness | `HedgeEffectivenessMLModel`    | Dollar-offset       | Regression + volatility regime detection |
| JE narrative        | `AccountingNarrativeGenerator` | None                | LLM audit narrative (IFRS 9 disclosures) |

---

## Test Coverage

| Module                     | Tests  | Coverage Areas                                |
| -------------------------- | ------ | --------------------------------------------- |
| `JournalEntry` (aggregate) | 19     | Double-entry, state machine, reversal, events |
| `IFRS9Classifier`          | 13     | All 5 categories, FVO, override, Islamic      |
| `ECLCalculator`            | 15     | Stage 1/2/3, ECL formula, configurable SICR   |
| `TradeBookedHandler`       | 11     | Bond BUY/SELL, MM, IRS at-par, FX Spot, Repo  |
| `HedgeAccountingService`   | 6      | Dollar-offset, regression, FVH/CFH JEs        |
| **Total**                  | **64** |                                               |
