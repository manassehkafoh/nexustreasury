# C4 Level 3 — Market Risk Engine Component Diagram

> **Sprint**: Sprint 4 (P1 — VaR + Stressed VaR + FRTB SA Capital)
> **Last Updated**: 2026-04-09

---

## Component Overview

```mermaid
flowchart TB
  subgraph RS["risk-service (port 4003)"]
    direction TB

    subgraph VAR["VaR Module"]
      VC["VaRCalculator\n\nHistorical Simulation VaR:\n250-day window, 99% CI.\n√10 scaling for 10-day.\nStressed VaR (2007-2009).\nMonte Carlo: 10K paths,\nCholesky corr. shocks.\nES at 97.5% (FRTB IMA).\nAI hook: ScenarioAugmenter"]
    end

    subgraph FRTB["FRTB Module"]
      FSA["FRTBSAEngine\n\nSensitivity-Based Method:\nDelta + Vega + Curvature.\nRisk classes: GIRR, FX,\nEquity, Credit, Commodity.\nIntra-bucket correlation:\nGIRR tenor decay (α=0.03)\nEQ sector (25%) / index (80%)\nInter-bucket: GIRR 42%, EQ 15%\nAI hook: SensitivityPredictor"]
    end

    subgraph EXISTING["Existing (Sprint 1)"]
      GC["GreeksCalculator\n\nΔ Γ ν Θ ρ DV01 FXΔ\nper position and book.\nAI hook: ScenarioOverride"]
      PDC["PreDealCheckHandler\n\nLimit hierarchy check.\nP99 < 5ms target.\nCredit + market limits."]
    end

    subgraph ROUTES["API Layer"]
      RT["RiskRoutes\n\nPOST /var/historical\nPOST /var/stressed\nPOST /frtb/sa\nPOST /pre-deal-check\nGET  /greeks/:bookId\nJWT + rate limit"]
    end
  end

  subgraph KAFKA["Kafka"]
    K1["nexus.risk.greeks-calculated"]
    K2["nexus.market.rates-updated"]
    K3["nexus.risk.var-result"]
  end

  subgraph DOM["@nexustreasury/domain"]
    PE["PricingEngine\n(Sprint 1)"]
  end

  K2 -->|"market data"| GC
  GC --> PE
  GC -->|"book Greeks"| K1

  RT --> VC & FSA & PDC & GC
  VC -->|"VaR results"| K3

  classDef engine fill:#1a3a5c,stroke:#4a90d9,color:#e8f4ff
  classDef api    fill:#3a3a1a,stroke:#9d9d2a,color:#fffff0
  classDef kafka  fill:#2a1a4a,stroke:#6a4a9d,color:#f0e8ff
  classDef dom    fill:#1a4a2a,stroke:#4a9d5a,color:#e8ffe8

  class VC,FSA,GC,PDC engine
  class RT api
  class K1,K2,K3 kafka
  class PE dom
```

---

## VaR Method Comparison

| Method                    | Inputs                                | Pros                           | Cons                            | Used for                       |
| ------------------------- | ------------------------------------- | ------------------------------ | ------------------------------- | ------------------------------ |
| **Historical Simulation** | 250-day P&L history                   | Captures fat tails, real-world | Needs history; backward-looking | Basel III VaR, daily reporting |
| **Stressed VaR**          | P&L during 2007–2008                  | Captures crisis tail risk      | Fixed stress period             | Basel III additional capital   |
| **Monte Carlo**           | Position sensitivities, RF covariance | Handles options/non-linearity  | Computationally intensive       | FRTB IMA, complex books        |
| **Expected Shortfall**    | Same as HS or MC                      | Coherent risk measure          | More volatile than VaR          | FRTB IMA (replaces VaR)        |

---

## Basel III Capital Calculation

```mermaid
flowchart LR
  VaR["Daily VaR\n(99%, 1-day, 250-day)"]
  sVaR["Stressed VaR\n(99%, 1-day, stress period)"]
  MC["Multiplier\nm_c ≥ 3 (+ backtesting add-on)"]
  MS["Multiplier\nm_s ≥ 3"]
  CAP["Market Risk Capital\n= max(VaRₜ₋₁, mₒ×VaR̄) + max(sVaRₜ₋₁, mₛ×sVaR̄)"]

  VaR --> MC --> CAP
  sVaR --> MS --> CAP
```

---

## FRTB SA Capital Structure (BCBS 457)

```mermaid
flowchart TB
  TOTAL["Total FRTB SA Capital"]
  GIRR["GIRR Capital\nK_GIRR = √[Σ Kb² + Σ γ_bc × Sb × Sc]"]
  FX["FX Capital\nRW = 15% × |FX Delta|"]
  EQ["Equity Capital\nBucket-specific RW (20–70%)"]
  CREDIT["Credit Spread Capital\nIssuer/tenor buckets"]
  COMM["Commodity Capital\nRW = 30%"]

  TOTAL --> GIRR & FX & EQ & CREDIT & COMM

  subgraph SBM["Within each risk class: SBM"]
    DELTA["Delta Capital\nKb = √[Σ(RW_i×s_i)² + 2Σ ρᵢⱼ×WS_i×WS_j]"]
    VEGA["Vega Capital\n(same structure, vol sensitivities)"]
    CURV["Curvature Capital\nCVR_k ≈ −0.5×Γ_k×(RW_k)²"]
  end

  GIRR --> SBM
```

---

## GIRR Intra-Bucket Tenor Correlations

```
ρ(T_i, T_j) = exp(−0.03 × |T_i − T_j| / min(T_i, T_j))

Examples (BCBS 457 prescribed):
  0.25Y ↔ 0.5Y:  ρ ≈ exp(-0.03 × 0.25/0.25) = 0.970
  1Y    ↔ 5Y:    ρ ≈ exp(-0.03 × 4/1)        = 0.887
  1Y    ↔ 30Y:   ρ ≈ exp(-0.03 × 29/1)       = 0.419
```

---

## AI/ML Integration Points — Sprint 4

| Hook                   | Interface              | Activation                   | Use Case                                               |
| ---------------------- | ---------------------- | ---------------------------- | ------------------------------------------------------ |
| `ScenarioAugmenter`    | `augment(history[])`   | VaRCalculator constructor    | Add COVID/GFC synthetic scenarios to HS-VaR            |
| `SensitivityPredictor` | `predict(position)`    | FRTBSAEngine constructor     | Predict FRTB sensitivities for illiquid EM instruments |
| `ScenarioOverride`     | `apply(greeks, input)` | GreeksCalculator constructor | Stressed Greeks for limit checking                     |

---

## Test Coverage — Sprint 4

| Module                       | Tests    | Key Scenarios                                     |
| ---------------------------- | -------- | ------------------------------------------------- |
| `VaRCalculator` (HS)         | 8        | correct quantile, √10 scaling, window=250, ES≥VaR |
| `VaRCalculator` (MC)         | 5        | positive, method tag, path count, ES≥VaR          |
| `VaRCalculator` (sVaR)       | 4        | method, period filter, fallback                   |
| `VaRCalculator` (AI/ML)      | 1        | augmented VaR > base VaR                          |
| `FRTBSAEngine` (delta)       | 6        | RW application, diversification, GIRR/FX/EQ       |
| `FRTBSAEngine` (total)       | 5        | sum correctness, non-negative, risk class count   |
| `FRTBSAEngine` (correlation) | 1        | tenor correlation structure                       |
| **Sprint 4 Total**           | **30**   |                                                   |
| **Cumulative**               | **300+** | All packages                                      |
