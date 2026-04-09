# 📚 VaR, Stressed VaR & FRTB — Learning Wiki

> **Module**: `@nexustreasury/risk-service` (Sprint 4)
> **Audience**: Risk Managers, Quantitative Analysts, Developers

---

## Table of Contents

1. [What is Value at Risk?](#1-what-is-value-at-risk)
2. [Historical Simulation VaR](#2-historical-simulation-var)
3. [Stressed VaR (Basel III)](#3-stressed-var-basel-iii)
4. [Monte Carlo VaR](#4-monte-carlo-var)
5. [Expected Shortfall (ES)](#5-expected-shortfall-es)
6. [FRTB Standardised Approach](#6-frtb-standardised-approach)
7. [FRTB Risk Classes & Risk Weights](#7-frtb-risk-classes--risk-weights)
8. [AI/ML Integration](#8-aiml-integration)
9. [Common Questions](#9-common-questions)

---

## 1. What is Value at Risk?

**VaR** answers: _"What is the maximum loss I can expect, with X% confidence, over the next N days?"_

```
99% 1-day VaR = $1,000,000

Means: On a typical trading day, there is a 99% probability that the
       portfolio will NOT lose more than $1M. Equivalently, there is
       a 1% chance of losing MORE than $1M.
```

**Limitations:**

- VaR says nothing about the SIZE of losses in the 1% tail
- VaR can be gamed by accumulating options premium
- For these reasons, FRTB replaces VaR with Expected Shortfall

---

## 2. Historical Simulation VaR

The simplest and most widely used method in banking.

**Algorithm:**

```
1. Collect last 250 trading days of portfolio P&L
2. Sort P&L ascending: [-$3M, -$2.5M, -$2M, ..., +$1.5M, +$2M]
3. 99% VaR = loss at the 1st percentile
   For 250 observations: 1% × 250 = 2.5 → take the 2nd or 3rd worst loss
4. 10-day VaR = 1-day VaR × √10  (Basel III scaling)
```

**Code example:**

```typescript
const varCalc = new VaRCalculator();

const result = await varCalc.historicalVaR(
  portfolioPnLHistory, // last 500 days of P&L observations
  0.99, // 99% confidence
  'USD',
);

console.log(`1-day VaR: $${result.var1Day.toLocaleString()}`);
console.log(`10-day VaR: $${result.var10Day.toLocaleString()}`);
console.log(`ES (tail avg): $${result.expectedShortfall.toLocaleString()}`);
```

**Why 250 days?** Basel III (BCBS 352 §183) requires at least 250 trading
days of observation. Approximately 1 calendar year.

---

## 3. Stressed VaR (Basel III)

Basel 2.5 (2009) added a Stressed VaR requirement following the GFC:

> _"Banks must calculate a stressed value-at-risk measure... The stressed
> input data is based on a 12-month period of significant financial stress."_

**NexusTreasury stress period:** 2007-07-01 → 2008-12-31 (Global Financial Crisis)

```typescript
const sVaR = await varCalc.stressedVaR(
  replicatedStressPnL, // P&L from re-pricing current portfolio through GFC returns
  0.99,
  'USD',
);
```

**Capital requirement (Basel III):**

```
Market Risk Capital = max(VaRₜ₋₁, mₒ × VaR̄₆₀) + max(sVaRₜ₋₁, mₛ × sVaR̄₆₀)

mₒ, mₛ ≥ 3 (set by national regulator; can be increased for backtesting failures)
VaR̄₆₀ = 60-day average VaR
```

---

## 4. Monte Carlo VaR

Best for books with significant optionality (caps, floors, swaptions).

**Core concept:** Simulate N random market scenarios, reprice the portfolio,
pick the VaR percentile from the P&L distribution.

**Cholesky decomposition:** To generate _correlated_ random shocks:

```
Σ = L × Lᵀ  (Cholesky factorisation of covariance matrix)
z = L × ε   (correlated shock vector, ε = iid standard normals)

Portfolio P&L = Σᵢ sensitivity_i × z_i
```

**Example:** Portfolio with USD IR DV01 and EUR/USD delta:

```typescript
const result = varCalc.monteCarloVaR(
  [
    { positionId: 'swap-01', riskFactorId: 'USD_IR_5Y', sensitivity: -5_000 },
    { positionId: 'fx-01', riskFactorId: 'EURUSD_FX', sensitivity: 1_000_000 },
  ],
  historicalRFReturns, // daily returns for each risk factor
  0.99,
  'USD',
);
```

---

## 5. Expected Shortfall (ES)

ES (also called CVaR or ETL) answers: _"Given that I am in the worst 1% of scenarios, what is my average loss?"_

```
ES₉₉% = E[Loss | Loss > VaR₉₉%]
       = average of the worst 1% of P&L outcomes
```

**Why ES is better than VaR:**

- ES is a _coherent_ risk measure (satisfies sub-additivity: diversification always reduces risk)
- VaR is not coherent — two concentrated positions can show lower VaR than the combined portfolio
- FRTB IMA (Basel IV) uses ES at 97.5%, not VaR at 99%

**Relationship:** For normally distributed P&L: ES₉₉% ≈ 1.16 × VaR₉₉%

---

## 6. FRTB Standardised Approach

The **Fundamental Review of the Trading Book** (BCBS 457, January 2019)
is Basel IV's replacement for the Basel III market risk capital framework.

**SA Capital = Delta + Vega + Curvature** (per risk class, then aggregated)

### Delta Capital — Sensitivity-Based Method

For each risk class, delta capital aggregates _weighted sensitivities_ using prescribed correlations:

```
Within each bucket b:
  WS_i = RW_i × s_i          (weighted sensitivity)
  Kb = √[ Σᵢ WS_i² + Σᵢ Σⱼ ρᵢⱼ × WS_i × WS_j ]
  Sb = clamp(Σᵢ WS_i, −Kb, Kb)

Across buckets:
  Capital_rc = √[ Σ_b Kb² + Σ_b Σ_c γ_bc × Sb × Sc ]
```

**Diversification benefit:** Opposing sensitivities (long 5Y, short 10Y) reduce capital
because the correlation term is positive but less than perfect.

---

## 7. FRTB Risk Classes & Risk Weights

### GIRR (General Interest Rate Risk)

| Tenor      | Risk Weight (Basel IV) |
| ---------- | ---------------------- |
| 0.25Y–0.5Y | 1.7%                   |
| 1Y         | 1.6%                   |
| 2Y–3Y      | 1.2–1.3%               |
| 5Y–30Y     | 1.1%                   |

Intra-bucket correlation: `ρ = exp(−0.03 × |T_i − T_j| / min(T_i, T_j))`

### FX Risk

Single risk weight: **15%** applied to the net FX delta sensitivity in each currency pair.

### Equity Risk

| Bucket | Description       | Risk Weight |
| ------ | ----------------- | ----------- |
| 1      | EM large-cap      | 55%         |
| 5–7    | Developed markets | 30–40%      |
| 11     | Equity index      | 20%         |
| 12     | Other             | 70%         |

---

## 8. AI/ML Integration

### Scenario Augmenter (Historical VaR)

```typescript
// Add synthetic tail scenarios not in the 250-day history
const calcWithGAN = new VaRCalculator({
  augment: async (history) => {
    const syntheticTails = await ganModel.generateAdversarial({
      history,
      targetPercentile: 0.001, // generate extreme 0.1% scenarios
      count: 50,
    });
    return syntheticTails;
  },
});
```

### Sensitivity Predictor (FRTB SA)

```typescript
// Predict FRTB sensitivities for illiquid NGN/GHS instruments
const frtbWithML = new FRTBSAEngine({
  predict: async ({ riskClass, instrumentType, notional, currency, maturityYears }) => {
    return mlModel.predictSensitivities({
      riskClass,
      instrumentType,
      notional,
      currency,
      maturityYears,
    });
  },
});
```

---

## 9. Common Questions

**Q: Why use √10 scaling instead of re-computing 10-day VaR directly?**
A: Basel III §183(c) permits the square-root-of-time scaling as a simplification.
Full 10-day VaR requires overlapping 10-day P&L windows (Kupiec test complications).
For normally distributed returns: 10-day σ = 1-day σ × √10. This approximation is
conservative for fat-tailed distributions.

**Q: Why does the Monte Carlo result vary each run?**
A: MC uses pseudo-random numbers. For reproducible results, seed the random number
generator (not done by default to allow for independent runs). For production, use
the same seed for intraday runs and reseed at EOD.

**Q: What is the FRTB multiplier for backtesting failures?**
A: If a bank has > 4 VaR exceptions in 250 trading days, regulators apply a
multiplier add-on (k) from a prescribed table:
4 exceptions → k = 0 (no add-on)
5 → k = 0.4; 6 → k = 0.5; ... 10+ → k = 1.0 (doubling the multiplier)

**Q: How does curvature capital work in practice?**
A: Full curvature requires re-pricing each position at ±RW shock. NexusTreasury uses
the 5% proxy (5% of delta capital) until the full repricing infrastructure (connecting
to the PricingEngine) is wired in Sprint 5. This is intentionally conservative.
