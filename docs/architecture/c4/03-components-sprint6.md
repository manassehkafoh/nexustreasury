# C4 Level 3 — Sprint 6: Collateral, NMD Modelling & Regulatory Reporting

> **Sprint**: Sprint 6 (P1 completion + P2 regulatory) | **Last Updated**: 2026-04-09

---

## Collateral Service Component Diagram

```mermaid
flowchart TB
  subgraph CS["collateral-service (port 4010)"]
    direction TB

    subgraph DOM["Domain"]
      CA["CollateralAgreement\n(Aggregate)\n\nAgreement types:\nISDA CSA (OTC derivatives)\nGMRA (repos)\nGMSLA (sec lending)\n\nPer-CSA configuration:\nThreshold / MTA\nIndependent Amount\nEligibility schedule\n(type, haircut, min rating)"]

      MC["MarginCall\n(Value Object)\n\nWE_CALL vs THEY_CALL:\nDirected by sign of netMTM.\ncallAmount = max(0,\n|netMTM|−threshold\n−currentCollateral)\nOnly if ≥ MTA.\nValueDate = callDate + T+1"]
    end

    subgraph APP["Application"]
      CALC["MarginCalculator\n\ncomputeMarginCall():\n  Call if excess ≥ MTA.\nGreedy CTD allocation:\n  First eligible inventory item.\nAI hook: CTDOptimiser\n  (cheapest-to-deliver\n   from inventory pool)"]
    end
  end

  subgraph AI["AI/ML"]
    CTD["CTDOptimiser\n\nSelects optimal collateral\nto meet call amount.\nMinimises funding cost\n(yield of pledged assets).\nRespects eligibility schedule\n(type, rating, haircut)."]
  end

  CALC -.-> CTD
  CA --> MC
  CALC --> CA & MC

  classDef d fill:#1a3a5c,stroke:#4a90d9,color:#e8f4ff
  classDef a fill:#1a4a2a,stroke:#4a9d5a,color:#e8ffe8
  classDef ai fill:#5c1a5c,stroke:#d94ad9,color:#ffe8ff
  class CA,MC d
  class CALC a
  class CTD ai
```

---

## NMD Behavioural Modelling — Data Flow

```mermaid
flowchart LR
  subgraph IN["Inputs"]
    BAL["NMD Balances\nby product type"]
    OVR["Tenant Overrides\n(Basel III defaults\n+ bank-specific assumptions)"]
    SHOCK["Rate Shock\n(parallel ±200bp)"]
  end

  subgraph NMD["NMDModellingService"]
    SPLIT["Core / Non-Core Split\ncoreRate per product type"]
    LCR["LCR 30-day Outflow\n= balance × runoffRate\n(Basel III Table 2)"]
    NSFR["NSFR RSF\n= balance × rsfFactor"]
    NII["NII Impact\n= balance × (repricedRate − currentRate)\nRepricedRate = currentRate + β × shock\nclamped to [floor, cap]"]
    EVE["EVE Impact\n= −(coreBalance × coreDuration\n × shock × beta)"]
  end

  subgraph AI["AI/ML"]
    CAL["BehaviouralCalibrationModel\n\nCalibrates core rate and\nrepricing beta from historical\nbalance time series.\nAdjusts for rate environment:\nLOW/RISING/HIGH/FALLING."]
  end

  BAL & OVR & SHOCK --> SPLIT
  SPLIT --> LCR & NSFR & NII & EVE
  CAL -.->|"async calibration"| SPLIT

  classDef in fill:#2a1a4a,stroke:#6a4a9d,color:#f0e8ff
  classDef svc fill:#1a3a5c,stroke:#4a90d9,color:#e8f4ff
  classDef ai fill:#5c1a5c,stroke:#d94ad9,color:#ffe8ff
  class BAL,OVR,SHOCK in
  class SPLIT,LCR,NSFR,NII,EVE svc
  class CAL ai
```

---

## Regulatory Reporting Service

```mermaid
flowchart TB
  subgraph RS["reporting-service (port 4011)"]
    direction LR

    LCR_B["buildLCRReport()\n\nHQLA inventory by L1/L2A/L2B.\nHaircuts: 0% / 15% / 25-50%.\nInflow cap: 75% of outflows.\nLCR = HQLA / netOutflows ≥ 100%.\nAlert: deficitAmount if <100%."]

    NSFR_B["buildNSFRReport()\n\nASF components (capital,\nretail deposits 90%, ST debt).\nRSF components (loans 65%,\nHQLA 5%, undrawn lines 5%).\nNSFR = ASF / RSF ≥ 100%."]

    IRRBB_B["buildIRRBBReport()\n\n6 prescribed rate scenarios\n(BCBS 368 Table 2).\nOutlier: |ΔEVE/Tier1| > 15%.\nNII sensitivity ±200bp.\nSupervisory outlier flag."]
  end

  subgraph AI["AI/ML"]
    NRG["ReportNarrativeGenerator\n\nLLM produces plain-language\nregulatory submission text.\nExplains material changes\nfrom previous period.\nFallback: no narrative."]
  end

  LCR_B & NSFR_B & IRRBB_B -.-> NRG

  classDef rpt fill:#1a4a2a,stroke:#4a9d5a,color:#e8ffe8
  classDef ai fill:#5c1a5c,stroke:#d94ad9,color:#ffe8ff
  class LCR_B,NSFR_B,IRRBB_B rpt
  class NRG ai
```

---

## Basel III NMD Runoff Rates by Product (LCR Table 2)

| Product Type              | Core Rate | Repricing β | LCR Runoff            | NSFR RSF |
| ------------------------- | --------- | ----------- | --------------------- | -------- |
| Retail Current Account    | 70%       | 10%         | **3%** (stable)       | 90%      |
| Retail Savings            | 60%       | 30%         | **10%** (less stable) | 90%      |
| SME Current               | 55%       | 20%         | **5%** (operational)  | 50%      |
| SME Savings               | 40%       | 40%         | **10%**               | 50%      |
| Corporate Operational     | 30%       | 50%         | **25%**               | 50%      |
| Corporate Non-Operational | 10%       | 70%         | **40%**               | 0%       |
| Private Banking           | 65%       | 25%         | **10%**               | 50%      |

---

## IRRBB Prescribed Scenarios (BCBS 368 Table 2)

| Scenario        | Short Rate | Long Rate | Outlier Threshold |
| --------------- | ---------- | --------- | ----------------- |
| PARALLEL_UP     | +200bp     | +200bp    | > 15% of Tier 1   |
| PARALLEL_DOWN   | −200bp     | −200bp    | > 15% of Tier 1   |
| STEEPENER       | −100bp     | +150bp    | > 15% of Tier 1   |
| FLATTENER       | +150bp     | −100bp    | > 15% of Tier 1   |
| SHORT_RATE_UP   | +300bp     | flat      | > 15% of Tier 1   |
| SHORT_RATE_DOWN | −300bp     | flat      | > 15% of Tier 1   |

---

## Sprint 6 Test Coverage

| Module                              | Tests   | Key Scenarios                                                      |
| ----------------------------------- | ------- | ------------------------------------------------------------------ |
| `MarginCalculator` computation      | 7       | WE_CALL, THEY_CALL, threshold, MTA, currentCollateral, T+1         |
| `MarginCalculator` allocation       | 3       | cash 0% haircut, bond 2% haircut, no eligible inventory            |
| `CTDOptimiser` ML hook              | 1       | uses optimiser output                                              |
| `InMemoryCollateralRepository`      | 2       | save/retrieve, status update                                       |
| `NMDModellingService` core/non-core | 3       | 70% retail, sum check, 10% corporate                               |
| `NMDModellingService` LCR           | 2       | 3% retail, 40% corporate                                           |
| `NMDModellingService` NSFR          | 2       | 90% retail, 0% corporate                                           |
| `NMDModellingService` NII           | 4       | zero shock, +200bp, floor clamp, cap clamp                         |
| `NMDModellingService` EVE           | 2       | zero shock, +200bp formula                                         |
| `NMDModellingService` aggregate     | 2       | sum outflow, array length                                          |
| `NMDModellingService` overrides     | 1       | tenant override 80% > default 70%                                  |
| `RegulatoryReportingService` LCR    | 7       | HQLA sum, outflows, 75% inflow cap, ratio, compliant/non-compliant |
| `RegulatoryReportingService` NSFR   | 2       | ratio formula, non-compliant                                       |
| `RegulatoryReportingService` IRRBB  | 5       | 6 scenarios, outlier flag, non-outlier, hasOutlier, NII            |
| **Sprint 6 Total**                  | **47**  |                                                                    |
| **CUMULATIVE**                      | **411** | **34 test files, 13 services, 0 failures**                         |
