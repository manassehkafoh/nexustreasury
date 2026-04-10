# C4 Level 3 — Component Diagrams: Sprints 9 & 10

## Sprint 9 — Islamic Finance, Financial Planning, RAROC

### 9.1–9.2 Domain — Islamic Finance Pricing

```
[domain / pricing]
  ├── SukukPricer                    [Sprint 9.1]
  │     ├── IjaraCashFlowEngine      Periodic rental (ujrah) PV calculation
  │     ├── MurabahaProfitEngine     Simple profit pricing (no compounding, AAOIFI SS-17)
  │     ├── YieldSolver              Newton-Raphson profit-rate solver
  │     ├── DurationCalculator       Macaulay + Modified duration
  │     └── IFSB7RiskWeightMapper    IG=20%, Sub-IG=150%, Unrated=50%
  │
  └── MurabahaLifecycleEngine        [Sprint 9.2]
        ├── LMECommodityPricer       Spot price lookup (Copper/Aluminium/Gold/etc.)
        ├── ScheduleBuilder          BULLET / INSTALMENT / BALLOON repayment
        ├── TawarruqProcessor        Reverse Murabaha: 0.5% broker fee deduction
        └── AAOIFISS30Validator      Sharia compliance checks (actual ownership, etc.)
```

### 9.3 Accounting Service — Islamic IFRS9 Extension

```
[accounting-service]
  └── IslamicIFRS9Extension          [Sprint 9.3]
        ├── InstrumentClassifier     Murabaha/Ijara → AC; Sukuk → FVOCI; Mudaraba → FVPL
        ├── DPPStageAssigner         DPP (Days Past Profit) → IFRS9 Stage 1/2/3
        └── ECLCalculator            PD × LGD × EAD with stage-appropriate PD horizon
```

### 9-A Planning Service (NEW SERVICE — port 4012)

```
[planning-service]
  └── BudgetEngine                   [Sprint 9-A, FIS BSM gap]
        ├── PlanRepository           In-memory plan store (tenantId + fiscalYear + scenario)
        ├── ReforecastWorkflow       Version-bumped RFC plan creation
        ├── ApprovalGateway          DRAFT → SUBMITTED → APPROVED state machine
        ├── ReportAggregator         Σ NII, OPEX, RWA per BU → cost-to-income, ROE, RAROC
        ├── MismatchAnalyser         ±100bp NII sensitivity (60% rate-sensitive assumption)
        └── FTPAssessor              Pro-forma FTP charge/credit/net margin
```

### 9-B Reporting Service — RAROC Engine

```
[reporting-service]
  └── RAROCEngine                    [Sprint 9-B, FIS BSM gap]
        ├── EconomicCapitalModel     EC = RWA × 8% × (1 + stressBuffer)
        ├── NetContributionCalculator Revenue − costs − EL (FTP-adjusted)
        ├── HurdleRateClassifier     RAROC vs 10% hurdle → isAboveHurdle
        ├── EVACalculator            EVA bps = (RAROC − costOfCapital) × 10,000
        └── PortfolioAggregator      Portfolio-level RAROC + top/under performer ranking
```

---

## Sprint 10 — Capital Stress, FX Hedging, COREP/FINREP, SWIFT ISO 20022

### 10-A Risk Service — Capital Stress Tester

```
[risk-service]
  └── CapitalStressTester            [Sprint 10-A, FIS BSM gap]
        ├── ScenarioLibrary          5 EBA scenarios (BASELINE→COMBINED) with macro shocks
        ├── ProvisionCalculator      GDP shock → PD multiplier → additional provisions
        ├── RWAInflator              Credit/market expansion: GDP shock + credit spread multiplier
        ├── StressedRatioCalculator  CET1 / T1 / Total Capital + Leverage ratios
        └── SurvivalHorizonEngine    Days until floor = headroom / daily capital burn rate
```

### 10-B Trade Service — FX Auto-Hedger

```
[trade-service]
  └── FXAutoHedger                   [Sprint 10-B, FIS FX Portal gap]
        ├── DealingLimitValidator    Single deal + daily cumulative utilisation check
        ├── SpreadEngine             Currency-pair spread matrix (bps) → locked-in profit
        ├── HedgeStrategyRouter      FULL_COVER / THRESHOLD / SCHEDULED / NET_POSITION
        ├── PortfolioTracker         Net exposure per currency pair
        └── STPRefGenerator          HLDG-NNNNN hedge instruction reference
```

### 10.1–10.2 Reporting Service — COREP + FINREP

```
[reporting-service]
  ├── COREPEngine                    [Sprint 10.1]
  │     ├── CreditRiskSACalculator   (Gross − CRM) × risk weight per exposure class
  │     ├── MarketRiskFRTBCalculator Sensitivity × risk weight × 12.5 scalar
  │     ├── OpRiskSMACalculator      BIC component + loss component × 12.5
  │     └── CapitalBufferAggregator  Conservation + CCyB + G-SIB + SREP → combined buffer
  │
  └── FINREPEngine                   [Sprint 10.2]
        ├── BalanceSheetAggregator   Assets (AMC/FVOCI/FVPL) + liabilities + equity
        ├── PLConstructor            NII → provisions (ECL) → tax → net profit
        └── KPICalculator            NPL ratio, ROA, ROE, cost-to-income
```

### 10.3 BO Service — SWIFT ISO 20022 Migrator

```
[bo-service]
  └── SWIFTISO20022Migrator          [Sprint 10.3]
        ├── MT103Parser              Extracts Field 20, 32A, 50K, 59, 70, 26T
        ├── Pacs008Builder           MT103 → pacs.008.001.09 with UETR + LEI
        ├── MT202Parser              Extracts Field 20, 32A, 52A, 56A, 58A
        ├── Pacs009Builder           MT202 → pacs.009.001.09 with UETR preservation
        ├── CBPRPlusValidator        IBAN / purpose code completeness checks
        └── DualRunCoordinator       Emits both MT and MX simultaneously during transition
```

### 10.4 Reporting Service — Regulatory Submission

```
[reporting-service]
  └── RegulatorySubmissionEngine     [Sprint 10.4]
        ├── SubmissionLifecycle      DRAFT → SUBMITTED → ACKNOWLEDGED / REJECTED
        ├── RegulatorRegistry        EBA_COREP / EBA_FINREP / CBUTT_ALMA / BOG_ANNUAL / CBN_MONTHLY
        └── AcknowledgementTracker   Tracks submittedAt, acknowledgedAt, rejectionReason
```
