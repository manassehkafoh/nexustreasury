# 📚 Pricing Engine — Learning Wiki

> **Module**: `@nexustreasury/domain/pricing`
> **Sprint**: Sprint 1 (P1)
> **Audience**: Developers, Quant Analysts, Risk Officers

---

## Table of Contents

1. [What is a Pricing Engine?](#1-what-is-a-pricing-engine)
2. [Yield Curves — The Foundation](#2-yield-curves--the-foundation)
3. [FX Forward Pricing](#3-fx-forward-pricing)
4. [Bond Pricing](#4-bond-pricing)
5. [Interest Rate Swaps (IRS)](#5-interest-rate-swaps-irs)
6. [Option Pricing (Black-Scholes)](#6-option-pricing-black-scholes)
7. [Greeks — Sensitivities](#7-greeks--sensitivities)
8. [Configuration & AI/ML Hooks](#8-configuration--aiml-hooks)
9. [Common Mistakes & FAQ](#9-common-mistakes--faq)
10. [Reference Formulas Quick Sheet](#10-reference-formulas-quick-sheet)

---

## 1. What is a Pricing Engine?

A **pricing engine** computes the fair market value (price) of a financial instrument
given:

- **Market data**: spot rates, yield curves, volatility surfaces
- **Instrument terms**: notional, maturity, coupon, strike, etc.

NexusTreasury's pricing engine is a **pure domain module** — no database access,
no HTTP calls, no side effects. This makes it:

- ⚡ Fast (sub-millisecond for most calculations)
- 🧪 Easily testable (deterministic input → deterministic output)
- 🔒 Thread-safe (all value objects are immutable)

### The PricingEngine Dispatcher

```typescript
import { PricingEngine, YieldCurve } from '@nexustreasury/domain';

const engine = new PricingEngine();

// Price an FX forward
const fxResult = engine.priceFXForward({ spotRate: 1.0842, tenorYears: 1.0, ... });

// Price a bond
const bondResult = engine.priceBond({ faceValue: 100, couponRate: 0.05, ... });

// Price an IRS
const npv = engine.priceIRS({ notional: 10_000_000, fixedRate: 0.04, ... });

// Price an option + Greeks
const optResult = engine.priceOption({ spot: 42, strike: 40, volatility: 0.20, ... });
```

---

## 2. Yield Curves — The Foundation

### What is a yield curve?

A yield curve maps time (maturity) to interest rate. It tells you:

> "If I lend $1 today and want it back in T years, what interest rate will the
> market pay me?"

The fundamental quantity is the **discount factor** df(T) = e^(-r(T) × T).
This answers: "What is $1 received in T years worth today?"

### Creating a YieldCurve

```typescript
const sofrCurve = YieldCurve.fromPillars(
  [
    { tenorYears: 0.25, zeroRate: 0.043 }, // 3M: 4.3%
    { tenorYears: 0.5, zeroRate: 0.042 }, // 6M: 4.2%
    { tenorYears: 1.0, zeroRate: 0.04 }, // 1Y: 4.0%
    { tenorYears: 5.0, zeroRate: 0.038 }, // 5Y: 3.8%
  ],
  'USD-SOFR',
);

// Use it:
const df1Y = sofrCurve.discountFactor(1.0); // e^(-0.04 × 1) = 0.9608
const r6M = sofrCurve.zeroRate(0.5); // 0.042 (4.2%)
const fwd = sofrCurve.forwardRate(1.0, 2.0); // implied 1Y fwd rate starting 1Y
```

### Interpolation: Why LINEAR_LOG_DF?

Between pillar points, we interpolate. The default `LINEAR_LOG_DF` method
interpolates linearly on log(discount factor):

```
log(df(T)) = log(df(T₀)) + [T - T₀] / [T₁ - T₀] × [log(df(T₁)) - log(df(T₀))]
```

**Why not linear on zero rates?**
Linear zero rate interpolation can produce negative forward rates (which implies
arbitrage). LINEAR_LOG_DF guarantees positive forward rates because it's equivalent
to piecewise-constant forward rates.

### Stress Scenarios

```typescript
// +100bp parallel shift (IRRBB shock)
const shocked = curve.parallelShift(0.01);

// Steepener: short rates +100bp, long rates -50bp
const steepener = curve.twist(+0.01, -0.005);
```

---

## 3. FX Forward Pricing

### Covered Interest Rate Parity (CIP)

The no-arbitrage FX forward formula:

```
F = S × exp((r_domestic - r_foreign) × T)
```

**Intuition**: If USD rates are higher than EUR rates, you can earn more by holding
USD. The forward rate compensates by making USD more expensive in the future
(EUR trades at a forward premium).

### Example: EURUSD 1Y Forward

```typescript
const fxResult = engine.priceFXForward({
  spotRate: 1.0842, // EUR/USD spot
  tenorYears: 1.0,
  domesticCurve: usdCurve, // USD rates (term ccy)
  foreignCurve: eurCurve, // EUR rates (base ccy)
  notional: Money.of(10_000_000, 'USD'),
  baseCurrency: 'USD',
  termCurrency: 'EUR',
});

// F = 1.0842 × exp((0.040 - 0.030) × 1.0) = 1.0842 × 1.01005 = 1.0951
console.log(fxResult.forwardRate); // ~1.0951
console.log(fxResult.forwardPoints); // ~(1.0951 - 1.0842) × 10000 = +109 pips
```

### Quoting Convention

For **EURUSD**: EUR is base, USD is term. Spot = 1.0842 means 1 EUR buys 1.0842 USD.

- `domesticCurve` = USD curve (term = domestic from the rate-setter's perspective)
- `foreignCurve` = EUR curve

### NDFs (Non-Deliverable Forwards)

For restricted currencies (GHS, NGN, KES), the forward doesn't deliver the local
currency. Instead, P&L settles in USD at the fixing rate:

```typescript
const ndf = engine.priceFXNDF({
  ...fxForwardInput,
  settlementCurrency: 'USD',
});
```

---

## 4. Bond Pricing

### The Core Formula

```
P = Σᵢ [coupon × df(Tᵢ)] + faceValue × df(Tₙ)
```

In English: sum up the present value of every future cash flow.

### Example: 5% Semi-Annual Bond

```typescript
const result = engine.priceBond({
  faceValue: 100,
  couponRate: 0.05, // 5% annual
  frequency: 2, // semi-annual (most common for USD/EUR bonds)
  residualYears: 5.0,
  curve: usdCurve,
});

console.log(result.cleanPrice); // ~104.31 (above par: coupon > yield)
console.log(result.yieldToMaturity); // ~4.02% (slightly above market curve)
console.log(result.modifiedDuration); // ~4.5 years
console.log(result.dv01); // ~$0.046 per $100 face value per bp
```

### Key Bond Analytics

| Metric                | Formula                       | Meaning                          |
| --------------------- | ----------------------------- | -------------------------------- |
| **YTM**               | Solve P = Σ Cᵢ × df(tᵢ) for r | Single rate that prices the bond |
| **Modified Duration** | Macaulay Duration / (1 + y/f) | % price change per 1% yield move |
| **DV01**              | D_mod × P × face / 10000      | $ change per 1bp yield move      |
| **Convexity**         | Σ tᵢ² × Cᵢ × df(tᵢ) / P       | Curvature correction             |

### Price Approximation

For small yield changes Δy:

```
ΔP/P ≈ -D_mod × Δy + ½ × Convexity × Δy²
```

This is the "Taylor expansion" of the price-yield relationship.

### Par Coupon Rate

On a continuous compounding curve, the coupon that prices a bond at exactly
par (100) is NOT the same as the zero rate:

```typescript
const parCoupon = pricer.parCouponRate(curve, 5.0, 2);
// → ~4.04% for a flat 4% continuous curve (not 4.0% exactly)
```

The difference arises because continuous discounting ≠ semi-annual periodic
discounting. This is a 1–5bp effect for typical rates/tenors.

---

## 5. Interest Rate Swaps (IRS)

### What is an IRS?

A plain vanilla IRS exchanges:

- **Fixed leg**: you pay a fixed coupon every 6 months
- **Floating leg**: you receive SOFR (or EURIBOR) every quarter

### The Multi-Curve Framework

Since 2008, swaps are priced with **two curves**:

1. **Discount curve** (OIS): e.g., USD-SOFR — discounts all cash flows
2. **Forward curve** (RFR/IBOR): projects the floating rate

For OIS swaps (SOFR vs SOFR), both curves are the same.

### Par Swap Rate

The par swap rate K\* makes NPV = 0 at inception:

```
K* = (1 - df(Tₙ)) / Σᵢ [τᵢ × df(Tᵢ)]
```

This is what IDB brokers quote as "the 5-year SOFR swap rate" (e.g., 3.85%).

```typescript
const parRate = engine.parSwapRate(sofrCurve, 5.0, 2, 4);
// → ~3.85% for the current SOFR curve
```

### Why NPV = 0 at Inception?

The floating leg PV equals (1 - df(Tₙ)) × notional because:

- At t=0: borrow $1 at SOFR
- Each period: pay SOFR × τᵢ on the outstanding, receive the floating coupon
- At Tₙ: repay $1

This "telescopes" exactly to (1 - df(Tₙ)) when simple (not continuous) forward
rates are used. Our implementation correctly uses df(t₀) - df(t₁) per period.

---

## 6. Option Pricing (Black-Scholes)

### The Black-Scholes Formula

For a European **call** option (right to buy):

```
C = S × e^(-q×T) × N(d₁) - K × e^(-r×T) × N(d₂)
```

For a European **put** option (right to sell):

```
P = K × e^(-r×T) × N(-d₂) - S × e^(-q×T) × N(-d₁)
```

Where:

```
d₁ = [ln(S/K) + (r - q + σ²/2) × T] / (σ × √T)
d₂ = d₁ - σ × √T
N() = standard normal CDF
```

For **FX options** (Garman-Kohlhagen): q = foreign interest rate.
For **equity options**: q = dividend yield (0 if no dividends).

### Example: EURUSD 1Y ATM Call

```typescript
const result = engine.priceOption({
  optionType: OptionType.CALL,
  spot: 1.0842,
  strike: 1.0842, // ATM
  timeToExpiry: 1.0,
  riskFreeRate: 0.04, // USD OIS
  dividendYield: 0.03, // EUR OIS
  volatility: 0.075, // 7.5% EURUSD 1Y ATM
});

console.log(result.price); // ~0.034 (3.4 USD cents per EUR)
console.log(result.delta); // ~0.49 (near 0.5 for ATM)
console.log(result.vega); // positive (higher vol → more expensive)
console.log(result.theta); // negative (time decay)
```

### Implied Volatility

Given a market price, solve for vol (Newton-Raphson):

```typescript
const impliedVol = engine.impliedVolatility({
  marketPrice: 0.034,
  optionType: OptionType.CALL,
  spot: 1.0842,
  strike: 1.0842,
  timeToExpiry: 1.0,
  riskFreeRate: 0.04,
  dividendYield: 0.03,
});
// → ~0.075 (recovers original 7.5% vol)
```

### normCDF Implementation Note

The standard normal CDF is computed using the Abramowitz & Stegun §26.2.16
rational approximation (max error 7.5×10⁻⁸):

```
1 - N(x) ≈ φ(x) × P(k),   k = 1/(1 + γ|x|),   γ = 0.2316419
```

where φ(x) = exp(-x²/2)/√(2π) is the standard normal PDF. The five coefficients
(a1..a5) absorb the 1/√(2π) factor.

> ⚠️ **Common Bug**: An alternative formulation uses p = 0.3275911 with
> `exp(-x² / 2)` in the polynomial. These two forms have DIFFERENT coefficient sets
> and should NOT be mixed. NexusTreasury uses the verified A&S 26.2.16 form.

---

## 7. Greeks — Sensitivities

### What are Greeks?

Greeks measure how the option/instrument price changes when market inputs change.
They are used for:

- **Hedging**: neutralise delta by buying/selling spot; vega by trading options
- **Limit management**: e.g., "no desk can have |Δ| > $10M equivalent"
- **FRTB SA**: Greeks are the primary inputs for sensitivity-based method capital

| Greek     | Symbol | Meaning                      | Typical Use               |
| --------- | ------ | ---------------------------- | ------------------------- |
| **Delta** | Δ      | Price change per +1% spot    | FX hedging                |
| **Gamma** | Γ      | Delta change per +1% spot    | Convexity risk            |
| **Vega**  | ν      | Price change per +1% vol     | Vol hedging               |
| **Theta** | Θ      | Price change per day (decay) | Overnight PnL attribution |
| **Rho**   | ρ      | Price change per +1% rate    | Rate hedging              |
| **DV01**  | —      | Price change per +1bp rate   | IR hedging                |

### Book-Level Aggregation

```typescript
const bookGreeks = await calculator.calculateBook('fx-options-desk', positions);
console.log(`Net Delta: ${bookGreeks.netDelta.toFixed(0)} EUR`);
console.log(`Net Vega: ${bookGreeks.netVega.toFixed(0)} USD per 1%`);
console.log(`Net DV01: $${bookGreeks.netDV01.toFixed(0)}`);
```

---

## 8. Configuration & AI/ML Hooks

### Basic Configuration

```typescript
const engine = new PricingEngine({
  // Inject a custom FX pricer (e.g., for testing)
  fxPricer: new MockFXPricer(),
});
```

### AI/ML Vol Surface Predictor

Replace the flat vol input with a neural-network vol surface predictor:

```typescript
const mlEngine = new PricingEngine({
  volPredictor: {
    predict: (pair, strike, spot, tenor) => {
      // Call your ML model here
      const moneyness = strike / spot;
      return nnModel.infer({ pair, moneyness, tenor });
    },
  },
});
```

### AI/ML GreeksCalculator Scenario Override

Apply stress-test adjustments via the scenario override hook:

```typescript
const stressCalc = new GreeksCalculator(engine, {
  scenarioOverride: {
    apply: (standardGreeks, input) => {
      if (isCrisisRegime) {
        return {
          ...standardGreeks,
          vega: standardGreeks.vega * 2.0, // double vega in crisis
          gamma: standardGreeks.gamma * 1.5, // spike gamma
        };
      }
      return standardGreeks;
    },
  },
});
```

---

## 9. Common Mistakes & FAQ

**Q: My bond prices at 99.82, not 100.00 for a "par bond" (coupon = yield)**
A: This is expected with continuous compounding. The coupon rate that prices at par
is _not_ equal to the zero rate. Use `pricer.parCouponRate(curve, tenor, freq)` to
get the correct par coupon.

**Q: My IRS NPV at inception is not zero**
A: Make sure you compute the par swap rate with the same curve. Also ensure the
floating leg is computed using discount-factor differences (df(t₀) - df(t₁)),
not continuously-compounded forward rates.

**Q: My option price is wrong vs Bloomberg**
A: Check the dividendYield input. For FX options, this should be the FOREIGN
interest rate. For equity options with no dividends, set to 0.

**Q: How accurate is the normCDF?**
A: The A&S 26.2.16 approximation has max error 7.5×10⁻⁸. This is equivalent to
< 0.001 pip error on a EURUSD option price — more than sufficient for all
production use cases.

---

## 10. Reference Formulas Quick Sheet

| Formula           | Expression                                       |
| ----------------- | ------------------------------------------------ |
| Discount factor   | `df(T) = exp(-r(T) × T)`                         |
| FX forward        | `F = S × exp((r_d - r_f) × T)`                   |
| Bond price        | `P = Σ C_i × df(T_i) + M × df(T_n)`              |
| Par swap rate     | `K* = (1 - df(T_n)) / Σ τ_i × df(T_i)`           |
| BS call price     | `C = S×e^(-qT)×N(d1) - K×e^(-rT)×N(d2)`          |
| d1                | `[ln(S/K) + (r-q+σ²/2)×T] / (σ√T)`               |
| d2                | `d1 - σ√T`                                       |
| Delta (call)      | `e^(-qT) × N(d1)`                                |
| Gamma             | `e^(-qT) × N'(d1) / (S × σ × √T)`                |
| Vega              | `S × e^(-qT) × N'(d1) × √T`                      |
| Modified duration | `Macaulay Duration` (for continuous compounding) |
| DV01              | `D_mod × P_dirty × face / 10000`                 |

---

_For implementation questions, refer to the inline JSDoc in each `.ts` file._
_For benchmark values, see the test fixtures in the corresponding `.test.ts` files._
