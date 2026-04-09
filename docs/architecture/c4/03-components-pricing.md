# C4 Level 3 — Pricing Bounded Context Component Diagram

> **Document**: NexusTreasury Architecture — Pricing Engine Components
> **Sprint**: Sprint 1 (P1 — Pricing Engine + Greeks)
> **Last Updated**: 2026-04-09

---

## Component Overview

The Pricing Engine is a pure domain module (`@nexustreasury/domain/pricing`) with
no infrastructure dependencies. It is used by:

- `risk-service` — pre-deal Greek limit checks, VaR, FRTB
- `position-service` — real-time MTM revaluation on market data events
- `alm-service` — HQLA yield calculations, EVE shocks
- `trade-service` — indicative pricing at trade capture

```mermaid
flowchart TB
  subgraph DS["@nexustreasury/domain — Pricing Module"]
    direction TB

    PE["PricingEngine\n(Dispatcher)\n\nRoutes pricing requests\nto specialist pricers.\nDependency-injectable.\nAI/ML hook points."]

    YC["YieldCurve\n(Value Object)\n\nImmutable curve:\nzero rates + DFs.\nInterpolation: LINEAR_LOG_DF.\nNSS parametric fit.\nParallel shift / twist."]

    FX["FXPricer\n\nCovered Interest Parity:\nF = S × exp((r_d - r_f) × T)\nFX Spot / Forward / NDF.\nMTM unrealised P&L.\nFX Delta calculation."]

    BP["BondPricer\n\nCash flow discounting.\nYTM (Newton-Raphson).\nMacaulay + Modified Duration.\nDV01 / Convexity.\nParCouponRate method."]

    IRS["IRSPricer\n\nFixed-float IRS NPV.\nPar swap rate K*.\nMulti-curve (OIS / RFR).\nSimple forward rates\n(exact telescoping)."]

    OP["OptionPricer\n\nBlack-Scholes / GK.\nAll Greeks: Δ Γ ν Θ ρ.\nNewton-Raphson\nimplied vol inversion.\nValidation guards."]

    NORM["normCDF / normPDF\n\nA&S 26.2.16 approx.\nMax error 7.5e-8.\nUsed by OptionPricer\nfor all N(x) calcs."]
  end

  subgraph RS["risk-service"]
    GC["GreeksCalculator\n(Application Service)\n\nDelegates to PricingEngine.\nAggregates per-book Greeks.\nAI/ML ScenarioOverride hook.\nΔ Γ ν Θ ρ DV01 FXDelta."]
    PDC["PreDealCheckHandler\n(existing)\n\nLimit hierarchy check.\nCredit / market limits.\nP99 &lt; 5ms target."]
  end

  subgraph PS["position-service"]
    PosAgg["PositionAggregate\n\nKafka consumer.\nReal-time MTM revalue\non MarketDataUpdated event."]
  end

  subgraph MS["market-data-service"]
    MDA["MockRateAdapter\n(→ Bloomberg adapter)\n\nPublishes\nnexus.market.rates-updated\nKafka events."]
  end

  PE --> FX
  PE --> BP
  PE --> IRS
  PE --> OP
  FX --> YC
  BP --> YC
  IRS --> YC
  OP --> NORM

  GC --> PE
  PosAgg --> PE
  PDC -.->|"future: Greeks\nlimit check"| GC

  MDA -->|"Kafka events"| PosAgg
  MDA -->|"Kafka events"| GC

  classDef domain   fill:#1a3a5c,stroke:#4a90d9,color:#e8f4ff
  classDef appSvc   fill:#1a4a2a,stroke:#4a9d5a,color:#e8ffe8
  classDef infra    fill:#4a2a1a,stroke:#9d5a2a,color:#ffe8e0
  classDef external fill:#3a1a5c,stroke:#7a4ad9,color:#f0e8ff

  class PE,YC,FX,BP,IRS,OP,NORM domain
  class GC,PDC,PosAgg appSvc
  class MDA infra
```

---

## AI/ML Hook Points

The pricing engine has two configurable AI/ML injection points:

```mermaid
flowchart LR
  subgraph Config["PricingEngineConfig (optional)"]
    VP["VolPredictor\n\nML interface:\npredict(pair, strike, spot, tenor)\n→ implied vol\n\nUse case: SABR smile\nfor EM option desks"]
    BP2["BasisPredictor\n\nML interface:\npredict(pair, tenor)\n→ CIP deviation\n\nUse case: USDGHS / USDNGN\nforwards with basis risk"]
  end

  subgraph Engine["PricingEngine"]
    FXP["FXPricer"]
    OPT["OptionPricer"]
  end

  VP -->|"injected vol"| OPT
  BP2 -->|"basis spread"| FXP

  classDef ai fill:#5c1a5c,stroke:#d94ad9,color:#ffe8ff
  class VP,BP2 ai
```

---

## Greeks Calculator Book-Level Flow

```mermaid
sequenceDiagram
  participant RS as risk-service
  participant GC as GreeksCalculator
  participant PE as PricingEngine
  participant Kafka as Kafka

  Kafka->>RS: nexus.market.rates-updated
  RS->>GC: calculateBook(bookId, positions[])
  loop for each position
    GC->>PE: priceOption / priceBond / priceIRS
    PE-->>GC: BlackScholesResult / BondResult / IRSSensitivities
    GC->>GC: apply ScenarioOverride (AI/ML hook)
  end
  GC-->>RS: BookGreeks { netDelta, netGamma, netVega, netDV01 }
  RS->>Kafka: publish nexus.risk.greeks-calculated
```

---

## Data Flow: Yield Curve Construction

```mermaid
flowchart LR
  MktData["Bloomberg BLPAPI\nor Internal Curve Builder"]
  Pillars["CurvePillar[]\n{ tenorYears, zeroRate }"]
  YC["YieldCurve.fromPillars()\nor YieldCurve.fromNSS()"]
  DF["discountFactor(T)\n= exp(-r(T) × T)"]
  ZR["zeroRate(T)\nLINEAR_LOG_DF interpolation"]
  FWD["forwardRate(t1, t2)\n= -log(df2/df1) / (t2-t1)"]
  SHOCK["parallelShift(Δr)\ntwist(Δshort, Δlong)"]

  MktData --> Pillars --> YC
  YC --> DF & ZR & FWD & SHOCK
  SHOCK -->|"stressed curve"| DF
```

---

## Interpolation Method Comparison

| Method          | Description                     | Pros                                                           | Cons                               |
| --------------- | ------------------------------- | -------------------------------------------------------------- | ---------------------------------- |
| `LINEAR_ZERO`   | Linear on zero rates            | Simple                                                         | Can produce negative forward rates |
| `LINEAR_LOG_DF` | Linear on log(df) ← **default** | Guarantees positive forwards; piecewise-constant forward rates | Slightly less smooth               |
| `CUBIC_SPLINE`  | Cubic spline on zero rates      | Smooth forward curve                                           | Potential oscillation at edges     |

---

## Test Coverage Matrix

| Component          | Test File                   | Tests  | Key Fixtures                              |
| ------------------ | --------------------------- | ------ | ----------------------------------------- |
| `YieldCurve`       | `yield-curve.test.ts`       | 14     | Flat 5%, SOFR (upward-sloping), NSS       |
| `OptionPricer`     | `option-pricer.test.ts`     | 19     | Haug §1.1 (S=42, K=40), EURUSD ATM        |
| `FXPricer`         | `fx-pricer.test.ts`         | 5      | EURUSD, USDGHS EM forward, NDF            |
| `BondPricer`       | `bond-pricer.test.ts`       | 11     | 5% 5Y bond, zero-coupon, par bond         |
| `IRSPricer`        | `irs-pricer.test.ts`        | 8      | 5Y SOFR swap, upward-sloping curve        |
| `GreeksCalculator` | `greeks-calculator.test.ts` | 8      | ATM FX call, FX forward, book aggregation |
| **Total**          |                             | **65** | Bloomberg / Haug / BIS reference values   |
