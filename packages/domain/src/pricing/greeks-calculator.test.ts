/**
 * @file greeks-calculator.test.ts
 * @description TDD tests for the GreeksCalculator domain service.
 *
 * All reference values are cross-checked against:
 *   - Haug, "The Complete Guide to Option Pricing Formulas" (2nd ed.)
 *   - Black-Scholes-Merton (1973) analytical closed-form solutions
 *   - Bloomberg OVDV <GO> option analytics
 *
 * ## What Are Greeks?
 *
 *   Delta (Δ)  — sensitivity of option price to spot price move
 *   Gamma (Γ)  — sensitivity of Delta to spot price move (curvature)
 *   Vega  (ν)  — sensitivity to 1% move in implied volatility
 *   Theta (Θ)  — option value decay per calendar day
 *   Rho   (ρ)  — sensitivity to 1% move in risk-free rate
 *   DV01      — bond value change per 1bp parallel yield shift
 *   FX Delta  — base-currency notional delta for FX forwards
 *   CS01      — credit value change per 1bp CDS spread move
 */

import { describe, it, expect } from 'vitest';
import {
  GreeksCalculator,
  type OptionGreeksInput,
  type BondGreeksInput,
  type FXDeltaInput,
} from './greeks-calculator.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** ATM call: S=100, K=100, T=1Y, σ=20%, r=5%, q=0 */
const ATM_CALL: OptionGreeksInput = {
  spot: 100,
  strike: 100,
  timeToExpiry: 1.0,
  volatility: 0.2,
  riskFreeRate: 0.05,
  dividendYield: 0.0,
  optionType: 'CALL',
};

/** Deep ITM call: should behave like forward */
const ITM_CALL: OptionGreeksInput = {
  ...ATM_CALL,
  strike: 80,
};

/**
 * Deep OTM call: low delta, low gamma.
 * K=150 on S=100 (1Y, 20% vol): d₁≈-1.68 → Δ≈0.047 < 0.10.
 */
const OTM_CALL: OptionGreeksInput = {
  ...ATM_CALL,
  strike: 150,
};

/** ATM put (put-call parity reference) */
const ATM_PUT: OptionGreeksInput = {
  ...ATM_CALL,
  optionType: 'PUT',
};

const calc = new GreeksCalculator();

// ── Delta Tests ───────────────────────────────────────────────────────────────
describe('GreeksCalculator — Delta', () => {
  it('ATM call Delta is approximately 0.5 to 0.7 (standard range)', () => {
    const g = calc.compute(ATM_CALL);
    expect(g.delta).toBeGreaterThan(0.5);
    expect(g.delta).toBeLessThan(0.7);
  });

  it('ATM put Delta is approximately -0.5 to -0.3 (standard range)', () => {
    const g = calc.compute(ATM_PUT);
    expect(g.delta).toBeGreaterThan(-0.5);
    expect(g.delta).toBeLessThan(-0.3);
  });

  it('Call Delta minus Put Delta = 1 (put-call parity: Δcall - Δput = e^(-qT))', () => {
    // Put-call parity for Delta: Δcall - Δput = e^(-qT).
    // With q=0 (no dividend): Δcall - Δput = 1.
    // Note: Δput is negative, so Δcall - Δput = Δcall + |Δput|.
    const callDelta = calc.compute(ATM_CALL).delta;
    const putDelta = calc.compute(ATM_PUT).delta;
    expect(callDelta - putDelta).toBeCloseTo(1.0, 4);
  });

  it('Deep ITM call Delta approaches 1', () => {
    expect(calc.compute(ITM_CALL).delta).toBeGreaterThan(0.9);
  });

  it('Deep OTM call Delta approaches 0', () => {
    expect(calc.compute(OTM_CALL).delta).toBeLessThan(0.1);
  });

  it('Delta lies in [0, 1] for calls and [-1, 0] for puts', () => {
    for (const strike of [70, 80, 90, 100, 110, 120, 130]) {
      const callD = calc.compute({ ...ATM_CALL, strike }).delta;
      const putD = calc.compute({ ...ATM_PUT, strike }).delta;
      expect(callD).toBeGreaterThanOrEqual(0);
      expect(callD).toBeLessThanOrEqual(1);
      expect(putD).toBeGreaterThanOrEqual(-1);
      expect(putD).toBeLessThanOrEqual(0);
    }
  });
});

// ── Gamma Tests ───────────────────────────────────────────────────────────────
describe('GreeksCalculator — Gamma', () => {
  it('Gamma is always positive (same for calls and puts)', () => {
    expect(calc.compute(ATM_CALL).gamma).toBeGreaterThan(0);
    expect(calc.compute(ATM_PUT).gamma).toBeGreaterThan(0);
  });

  it('ATM option has highest Gamma (peak at-the-money)', () => {
    const atmGamma = calc.compute(ATM_CALL).gamma;
    const itmGamma = calc.compute(ITM_CALL).gamma;
    const otmGamma = calc.compute(OTM_CALL).gamma;
    expect(atmGamma).toBeGreaterThan(itmGamma);
    expect(atmGamma).toBeGreaterThan(otmGamma);
  });

  it('Call and Put Gamma are equal (same underlying, same strike)', () => {
    const callGamma = calc.compute(ATM_CALL).gamma;
    const putGamma = calc.compute(ATM_PUT).gamma;
    expect(callGamma).toBeCloseTo(putGamma, 8);
  });

  it('Gamma decreases as time to expiry increases for ATM', () => {
    const nearGamma = calc.compute({ ...ATM_CALL, timeToExpiry: 0.1 }).gamma;
    const farGamma = calc.compute({ ...ATM_CALL, timeToExpiry: 2.0 }).gamma;
    expect(nearGamma).toBeGreaterThan(farGamma);
  });
});

// ── Vega Tests ────────────────────────────────────────────────────────────────
describe('GreeksCalculator — Vega', () => {
  it('Vega is always positive for long options', () => {
    expect(calc.compute(ATM_CALL).vega).toBeGreaterThan(0);
    expect(calc.compute(ATM_PUT).vega).toBeGreaterThan(0);
  });

  it('Call and Put Vega are equal (same underlying, same strike)', () => {
    expect(calc.compute(ATM_CALL).vega).toBeCloseTo(calc.compute(ATM_PUT).vega, 8);
  });

  it('Vega is largest ATM (peak sensitivity to volatility)', () => {
    const atmVega = calc.compute(ATM_CALL).vega;
    const itmVega = calc.compute(ITM_CALL).vega;
    const otmVega = calc.compute(OTM_CALL).vega;
    expect(atmVega).toBeGreaterThan(itmVega);
    expect(atmVega).toBeGreaterThan(otmVega);
  });

  it('Vega is reported per 1% vol move (scaled by 0.01)', () => {
    // Vega should be in price units per 1% vol, not per 100% vol
    const vega = calc.compute(ATM_CALL).vega;
    // For ATM 1Y, 20% vol, S=100: Vega ≈ 0.38 (per 1% vol move = 0.01 in vol)
    expect(vega).toBeGreaterThan(0.3);
    expect(vega).toBeLessThan(0.5);
  });
});

// ── Theta Tests ───────────────────────────────────────────────────────────────
describe('GreeksCalculator — Theta', () => {
  it('Theta is negative for long options (time decay hurts buyers)', () => {
    expect(calc.compute(ATM_CALL).theta).toBeLessThan(0);
    expect(calc.compute(ATM_PUT).theta).toBeLessThan(0);
  });

  it('Theta is reported per calendar day (small negative number)', () => {
    const theta = calc.compute(ATM_CALL).theta;
    // ATM 1Y at 20% vol: daily theta ≈ -0.015 to -0.03 (price units per day)
    expect(theta).toBeGreaterThan(-0.1);
    expect(theta).toBeLessThan(0);
  });

  it('Theta magnitude increases as expiry approaches (near options decay faster)', () => {
    const farTheta = calc.compute({ ...ATM_CALL, timeToExpiry: 1.0 }).theta;
    const nearTheta = calc.compute({ ...ATM_CALL, timeToExpiry: 0.1 }).theta;
    expect(Math.abs(nearTheta)).toBeGreaterThan(Math.abs(farTheta));
  });
});

// ── Rho Tests ─────────────────────────────────────────────────────────────────
describe('GreeksCalculator — Rho', () => {
  it('Call Rho is positive (higher rates → higher call value)', () => {
    expect(calc.compute(ATM_CALL).rho).toBeGreaterThan(0);
  });

  it('Put Rho is negative (higher rates → lower put value)', () => {
    expect(calc.compute(ATM_PUT).rho).toBeLessThan(0);
  });

  it('Rho is reported per 1% rate move (scaled by 0.01)', () => {
    const rho = calc.compute(ATM_CALL).rho;
    // ATM 1Y call: Rho ≈ 0.40 to 0.60 per 1% rate move
    expect(rho).toBeGreaterThan(0.3);
    expect(rho).toBeLessThan(0.7);
  });
});

// ── Bond DV01 ─────────────────────────────────────────────────────────────────
describe('GreeksCalculator — Bond DV01', () => {
  const BOND_INPUT: BondGreeksInput = {
    faceValue: 1_000_000, // $1M notional
    couponRate: 0.05, // 5% annual
    frequency: 2, // semi-annual
    residualYears: 5.0,
    yieldToMaturity: 0.04, // current YTM 4% (flat)
  };

  it('DV01 is positive (price rises when yield falls)', () => {
    expect(calc.bondDV01(BOND_INPUT)).toBeGreaterThan(0);
  });

  it('DV01 scales linearly with notional', () => {
    const dv01_1M = calc.bondDV01(BOND_INPUT);
    const dv01_10M = calc.bondDV01({ ...BOND_INPUT, faceValue: 10_000_000 });
    expect(dv01_10M).toBeCloseTo(dv01_1M * 10, 0);
  });

  it('DV01 increases with longer maturity (more rate sensitivity)', () => {
    const dv01_5Y = calc.bondDV01(BOND_INPUT);
    const dv01_10Y = calc.bondDV01({ ...BOND_INPUT, residualYears: 10 });
    expect(dv01_10Y).toBeGreaterThan(dv01_5Y);
  });

  it('DV01 for $1M face, 5Y, 4% yield is approximately $440', () => {
    // D_mod ≈ 4.4Y for 5Y 5% bond at 4% yield
    // DV01 = D_mod × P × notional / 10000
    // ≈ 4.4 × 1.04 × 1,000,000 / 10000 ≈ $458
    const dv01 = calc.bondDV01(BOND_INPUT);
    expect(dv01).toBeGreaterThan(400);
    expect(dv01).toBeLessThan(520);
  });
});

// ── FX Delta ──────────────────────────────────────────────────────────────────
describe('GreeksCalculator — FX Delta', () => {
  const FX_INPUT: FXDeltaInput = {
    notional: 10_000_000, // $10M USDGHS
    currencyPair: 'USDGHS',
    baseCurrency: 'USD',
    quoteCurrency: 'GHS',
    spotRate: 14.8, // 1 USD = 14.80 GHS
    direction: 'BUY', // long USD
  };

  it('FX Delta is positive for long base currency (BUY USD)', () => {
    expect(calc.fxDelta(FX_INPUT).deltaBaseCcy).toBeGreaterThan(0);
  });

  it('FX Delta is negative for short base currency (SELL USD)', () => {
    const sell = calc.fxDelta({ ...FX_INPUT, direction: 'SELL' });
    expect(sell.deltaBaseCcy).toBeLessThan(0);
  });

  it('FX Delta notional matches trade notional in base currency', () => {
    const result = calc.fxDelta(FX_INPUT);
    expect(Math.abs(result.deltaBaseCcy)).toBeCloseTo(FX_INPUT.notional, 0);
  });

  it('Quote currency delta = base delta × spot rate', () => {
    const result = calc.fxDelta(FX_INPUT);
    const expectedQuote = result.deltaBaseCcy * FX_INPUT.spotRate;
    expect(result.deltaQuoteCcy).toBeCloseTo(expectedQuote, 0);
  });
});

// ── AI Anomaly Score ──────────────────────────────────────────────────────────
describe('GreeksCalculator — AI Anomaly Detection', () => {
  it('anomaly score is 0 for normal market conditions (no anomaly)', () => {
    const g = calc.compute(ATM_CALL);
    // Under normal BSM conditions, anomaly score should be zero
    expect(g.aiAnomalyScore).toBe(0);
  });

  it('anomaly score is > 0 when market vol is inconsistent with model', () => {
    // vol = 999% is clearly anomalous
    const g = calc.compute({ ...ATM_CALL, volatility: 9.99 });
    expect(g.aiAnomalyScore).toBeGreaterThan(0);
  });

  it('anomaly reason is provided when score > 0', () => {
    const g = calc.compute({ ...ATM_CALL, volatility: 9.99 });
    expect(g.aiAnomalyReason).toBeTruthy();
  });
});
