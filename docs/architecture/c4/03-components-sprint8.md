# C4 Level 3 — Component Diagrams: Sprint 8 AI/ML & Market Data

## Sprint 8 Component Overview

Sprint 8 adds four major component families across three services.

---

## 8.1 Market Data Service — Bloomberg B-PIPE Components

```
[market-data-service]
  ├── BloombergBPIPEAdapter          (infrastructure)
  │     ├── CircuitBreaker           CLOSED / OPEN / HALF_OPEN state machine
  │     ├── TickSimulator            In-proc mock of SAPI tick stream
  │     └── HeartbeatMonitor         Stale-tick detection, 5s interval
  │
  └── AdaptiveMarketDataAdapter      (infrastructure)
        ├── PrimaryAdapter           → BloombergBPIPEAdapter
        ├── FallbackAdapter          → RefinitivRDPAdapter (or MockRateAdapter)
        ├── CircuitProbe             1s polling interval
        └── FailoverEventLog         Circular buffer, last 100 events
```

**Circuit Breaker State Transitions:**

```
CLOSED ──(3 failures)──► OPEN ──(30s timeout)──► HALF_OPEN
  ▲                                                   │
  └──────────────(probe succeeds)─────────────────────┘
```

**Kafka topic published:** `nexus.market.rates-updated` (within 50ms of tick)

---

## 8.2 Accounting Service — ML ECL Components

```
[accounting-service]
  ├── ECLCalculator                  (application)
  │     ├── PDModelAdapter           Interface — injectable PD predictor
  │     ├── SICRClassifier           Stage assignment logic (BCBS 309)
  │     └── ECLAmountCalculator      PD × LGD × EAD formula
  │
  ├── XGBoostPDModelAdapter          (application) [Sprint 8.2]
  │     ├── TreeEnsemble             5-tree gradient boosting (raw ordinal features)
  │     ├── SHAPAttributor           TreeSHAP approximation, 9 features
  │     └── FeatureEncoder           Credit rating → ordinal, sector/region encodings
  │
  └── ModelDriftDetector             (application) [Sprint 8.2]
        ├── KolmogorovSmirnovTest    Two-sample KS statistic vs training baseline
        ├── PopulationStabilityIndex PSI across 10 probability bins
        └── AlertClassifier          STABLE / WARNING / ALERT / CRITICAL
```

---

## 8.3 Back-Office Service — BERT Break Classifier

```
[bo-service]
  └── NostroReconciliationService    (application)
        ├── SWIFTMatcher             MT940/950/camt.053 matching engine
        ├── BreakClassifierModel     Interface — injectable classifier
        │
        └── BERTBreakClassifier      (application) [Sprint 8.3]
              ├── InferenceClient    → TorchServe HTTP /v1/models/finbert-recon:predict
              ├── ConfidenceRouter   >0.92 → AUTO_RESOLVED, ≥0.70 → REVIEW_QUEUE
              ├── GPIEnricher        SWIFT gpi Tracker UETR lookup (MISSING_PAYMENT)
              └── RuleBasedFallback  Heuristic fallback when ML endpoint unavailable
```

---

## 8.4 Domain — Volatility Surface & Vanna-Volga

```
[domain / pricing]
  ├── SVIVolatilitySurface           [Sprint 8.4]
  │     ├── SliceCalibrator          ATM/RR/BF quotes → SVI parameters (Malz approx)
  │     ├── SliceInterpolator        Linear interpolation across expiry slices
  │     └── ArbitrageFreeChecker     Calendar-spread monotonicity validator
  │
  └── VannaVolgaPricer               [Sprint 8.4]
        ├── DeltaStrikeMapper        25Δ call/put strikes via Malz formula
        ├── SmileCorrection          VV weights × (mktVol - flatVol) per vanilla
        └── SurvivalProbAdjuster     Barrier survival probability modifier
```

**Mathematical references:**

- Gatheral (2004): `w(k,τ) = a + b[ρ(k−m) + √((k−m)²+σ²)]`
- Castagna-Mercurio (2007): `VV = BS + x₁(Vatm_mkt − Vatm_bs) + x₂(...) + x₃(...)`
