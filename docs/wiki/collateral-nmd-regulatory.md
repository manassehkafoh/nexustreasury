# 📚 Collateral, NMD & Regulatory Reporting — Learning Wiki

> **Sprint 6** | **Audience**: Risk Officers, ALM Managers, Compliance, Developers

---

## Table of Contents

1. [Collateral Management (ISDA CSA / GMRA)](#1-collateral-management)
2. [NMD Behavioural Modelling](#2-nmd-behavioural-modelling)
3. [Regulatory Reporting — LCR](#3-regulatory-reporting--lcr)
4. [Regulatory Reporting — NSFR](#4-regulatory-reporting--nsfr)
5. [Regulatory Reporting — IRRBB Outlier Test](#5-regulatory-reporting--irrbb-outlier-test)
6. [AI/ML Integration](#6-aiml-integration)

---

## 1. Collateral Management

### Why collateral management?

When two banks trade an OTC derivative (e.g. a 5-year USD IRS), the trade
has a positive MTM value for one party and an equal negative value for the other.
The party with the negative MTM owes money — but it might not pay if it defaults.

Collateral management mitigates this credit risk: the party owing posts cash or
securities equal to the current MTM exposure. This is governed by an ISDA Credit
Support Annex (CSA).

### Key terms

| Term          | Definition                                                             |
| ------------- | ---------------------------------------------------------------------- |
| **Threshold** | MTM below this level → no margin call. Often 0 for cleared swaps.      |
| **MTA**       | Minimum Transfer Amount. Only call if amount ≥ MTA (avoids $1 calls).  |
| **VM**        | Variation Margin — covers current MTM. Called daily.                   |
| **IM**        | Initial Margin — covers potential future exposure. Required under UMR. |
| **WE_CALL**   | We are owed collateral (our MTM is positive)                           |
| **THEY_CALL** | We owe collateral (our MTM is negative)                                |

### Margin call formula

```
callAmount = max(0, |netMTM| − threshold − currentCollateral)
Issue call only if callAmount ≥ MTA
```

```typescript
const call = calc.computeMarginCall(
  csaAgreement,
  netMTMExposure:   1_500_000,  // we are owed $1.5M
  currentCollateral:  500_000,  // they've already posted $500K
  callDate: new Date(),
);
// callAmount = 1.5M − 500K (threshold) − 500K (already posted) = 500K
// direction = WE_CALL
```

### Cheapest-To-Deliver (CTD) Collateral

When settling a margin call, the posting party wants to deliver collateral with:

- The lowest yield (opportunity cost)
- Subject to eligibility (type, minimum credit rating, haircut)

Without ML: greedy first-fit allocation from inventory.
With CTD ML model: optimisation across the entire inventory pool.

### ISDA vs GMRA

| Agreement    | Used for                               | Margining                   |
| ------------ | -------------------------------------- | --------------------------- |
| **ISDA CSA** | OTC derivatives (IRS, FX options, CDS) | Daily VM + IM (UMR)         |
| **GMRA**     | Repo / reverse repo                    | Daily haircut-based margin  |
| **GMSLA**    | Securities lending                     | Daily mark-to-market margin |

---

## 2. NMD Behavioural Modelling

### What is an NMD?

A Non-Maturity Deposit (NMD) has no fixed maturity — current accounts, savings
accounts, call deposits. The depositor can withdraw at any time. But empirically:

- A **core** portion is sticky — it stays for years
- A **non-core** portion may leave within 30 days

This distinction is critical for:

- **LCR**: outflow rates differ (3% stable retail vs 40% corporate non-operational)
- **NSFR**: stable funding factors differ (90% retail vs 0% corporate non-op)
- **IRRBB**: core deposits have a duration that creates EVE sensitivity

### The Basel III standard assumptions

NexusTreasury ships these as defaults; banks override with their own data:

```typescript
// Retail current account (stable customer, rarely switches banks)
{
  coreRate:          0.70,   // 70% considered stable
  coreMaturityYears: 4.5,    // average behavioural maturity
  repricingBeta:     0.10,   // NMD rate moves 10% of each rate change
  lcrRunoffRate:     0.03,   // 3% leaves in 30-day stress (Basel III)
  nsfrRSFFactor:     0.90,   // 90% counts as stable funding
}
```

### Repricing beta (β)

NMD rates don't move 1:1 with market rates. A bank with a 4.0% EURIBOR environment
might only pay 1.0% on savings — this "stickiness" is measured by β:

```
repricedNMDRate = currentRate + β × rateShock
```

A β of 0.10 means: if market rates rise 200bp, the savings rate rises only 20bp.
This creates NII income (bank earns more on assets, pays less on deposits → gain).

### NII and EVE impact

```typescript
// +200bp shock on $100M retail current account portfolio
const projection = svc.project(
  {
    productType: NMDProductType.RETAIL_CURRENT_ACCOUNT,
    balance: 100_000_000,
    currency: 'USD',
    currentRate: 0.005, // currently paying 0.5%
  },
  0.02,
); // +200bp shock

// NII impact: 100M × (0.005 + 0.10×0.02 − 0.005) = 100M × 0.002 = $200K
// (Bank pays slightly more in deposits, small NII cost)

// EVE impact: −(coreBalance × coreDuration × shock × β)
//           = −(70M × 4.5 × 0.02 × 0.10) = −$630K
```

---

## 3. Regulatory Reporting — LCR

### What is the LCR?

The Liquidity Coverage Ratio ensures a bank can survive a 30-day stress:

```
LCR = HQLA / Net Cash Outflows ≥ 100%
```

**HQLA (High Quality Liquid Assets):**

- Level 1: Government bonds, central bank reserves — 0% haircut
- Level 2A: Agency bonds, corporate ≥ AA− — 15% haircut
- Level 2B: RMBS, corporate ≥ BBB− — 25–50% haircut

**HQLA caps:**

- Level 2 (2A + 2B) ≤ 40% of total HQLA → L2 ≤ (2/3) × L1
- Level 2B ≤ 15% of total HQLA → L2B ≤ (15/85) × (L1 + L2A)

**Inflow cap:** Total inflows may not offset more than 75% of outflows.

```typescript
const lcrReport = await reportingService.buildLCRReport({
  tenantId: 'bank-001', reportDate: new Date(), currency: 'USD',
  hqlaItems: [...],       // Level 1/2A/2B with haircuts applied
  outflowItems: [...],    // runoff rates × balance
  inflowItems: [...],     // max 75% of outflows
});
console.log(`LCR: ${(lcrReport.lcrRatio * 100).toFixed(1)}%`);  // e.g. 145.3%
console.log(`Compliant: ${lcrReport.isCompliant}`);              // true
```

---

## 4. Regulatory Reporting — NSFR

### What is the NSFR?

The Net Stable Funding Ratio ensures that long-term assets are funded by stable
(long-term) sources:

```
NSFR = Available Stable Funding (ASF) / Required Stable Funding (RSF) ≥ 100%
```

| Source                | ASF Factor | Example                  |
| --------------------- | ---------- | ------------------------ |
| Tier 1 Capital        | 100%       | All equity               |
| Retail deposits (>1Y) | 95%        | Term deposits            |
| Retail NMDs           | 90%        | Current/savings accounts |
| SME NMDs              | 50%        | SME current accounts     |
| Corporate non-op      | 0%         | Very short-term          |

| Asset                 | RSF Factor | Example               |
| --------------------- | ---------- | --------------------- |
| HQLA Level 1          | 5%         | Government bonds      |
| Performing loans ≥ 1Y | 65%        | Corporate loans       |
| Non-HQLA securities   | 50%        | IG corporate bonds    |
| Unencumbered cash     | 0%         | Central bank reserves |

---

## 5. Regulatory Reporting — IRRBB Outlier Test

### What is the IRRBB outlier test?

BCBS 368 §12: banks are classified as "outlier banks" if their EVE (Economic Value
of Equity) declines by more than 15% of Tier 1 capital under any of the 6 standard
rate shock scenarios.

```
EVE outlier threshold: |ΔEVE / Tier 1 Capital| > 15%
```

Banks that breach this threshold face:

- Enhanced supervisory scrutiny
- Potential additional capital requirements
- Publication in annual IRRBB disclosure (BCBS 368 §14)

```typescript
const irrbbReport = reportingService.buildIRRBBReport({
  tenantId: 'bank-001',
  tier1Capital: 500_000_000,
  eveDeltas: {
    PARALLEL_UP: -80_000_000, // EVE falls $80M
    PARALLEL_DOWN: +20_000_000, // EVE rises $20M
    // ... 4 more scenarios
  },
  niiSensitivity200Up: -25_000_000,
  niiSensitivity200Down: +15_000_000,
});
// PARALLEL_UP: |−80M / 500M| = 16% > 15% → OUTLIER
console.log(irrbbReport.scenarios[0].isOutlier); // true
console.log(irrbbReport.hasOutlierBank); // true
```

---

## 6. AI/ML Integration

### CTD Optimiser (Collateral)

```typescript
const collateralService = new MarginCalculator({
  optimise: async ({ callAmount, eligibilitySchedule, inventory }) => {
    // Use portfolio optimisation model to select cheapest collateral
    return mlOptimiser.selectCTD({
      required: callAmount,
      inventory,
      objective: 'minimise_funding_cost',
      constraints: eligibilitySchedule,
    });
  },
});
```

### Behavioural Calibration Model (NMD)

```typescript
const almService = new NMDModellingService(undefined, {
  calibrate: async ({ productType, historicalBalances, rateEnvironment }) => {
    // Train on historical deposit outflows during rate changes
    const calibrated = await depositModel.fit({
      balanceSeries: historicalBalances,
      environment: rateEnvironment,
    });
    return {
      coreRate: calibrated.stableShare,
      repricingBeta: calibrated.ratePassThrough,
    };
  },
});
```

### Regulatory Report Narrative Generator

```typescript
const reportingService = new RegulatoryReportingService({
  generate: async ({ reportType, currentRatio, previousRatio, materialChanges }) => {
    return await anthropicClient.messages
      .create({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: `Generate a concise regulatory narrative for a ${reportType} report.
          Current ratio: ${(currentRatio! * 100).toFixed(1)}%.
          Previous period: ${(previousRatio! * 100).toFixed(1)}%.
          Material changes: ${materialChanges.join('; ')}.
          Keep to 3 sentences. Use formal regulatory language.`,
          },
        ],
      })
      .then((r) => (r.content[0]?.type === 'text' ? r.content[0].text : ''));
  },
});
```
