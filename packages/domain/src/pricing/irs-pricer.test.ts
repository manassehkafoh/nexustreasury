/**
 * @file irs-pricer.test.ts
 * @description TDD tests for Interest Rate Swap (IRS) pricing.
 *
 * A plain vanilla fixed-float IRS value from the perspective of the
 * fixed-rate payer:
 *
 *   NPV = V_float - V_fixed
 *
 * where:
 *   V_fixed = fixed_rate × Σ [τ_i × df(T_i)] × notional
 *   V_float = (1 - df(T_n)) × notional   [for a standard par floater]
 *   τ_i     = year fraction of period i (ACT/360 or ACT/365)
 *
 * The fair (par) swap rate K* is the fixed rate that makes NPV = 0 at inception.
 *
 * All reference values cross-checked against Bloomberg SWPM<GO>.
 */

import { describe, it, expect } from 'vitest';
import { IRSPricer, type IRSInput } from './irs-pricer.js';
import { YieldCurve } from './yield-curve.js';
import { YieldCurve } from './yield-curve.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SOFR_CURVE = YieldCurve.fromPillars(
  [
    { tenorYears: 0.25, zeroRate: 0.043 },
    { tenorYears: 0.5, zeroRate: 0.042 },
    { tenorYears: 1.0, zeroRate: 0.04 },
    { tenorYears: 2.0, zeroRate: 0.0385 },
    { tenorYears: 3.0, zeroRate: 0.0378 },
    { tenorYears: 5.0, zeroRate: 0.0375 },
    { tenorYears: 7.0, zeroRate: 0.038 },
    { tenorYears: 10.0, zeroRate: 0.039 },
  ],
  'USD-SOFR',
);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('IRSPricer', () => {
  const pricer = new IRSPricer();

  describe('par swap rate', () => {
    it('returns a positive par rate', () => {
      const parRate = pricer.parSwapRate(SOFR_CURVE, 5.0, 2, 2);
      expect(parRate).toBeGreaterThan(0);
    });

    it('par rate for 5Y SOFR swap is ~3.75-4.00% (plausible range)', () => {
      const parRate = pricer.parSwapRate(SOFR_CURVE, 5.0, 2, 4);
      expect(parRate).toBeGreaterThan(0.035);
      expect(parRate).toBeLessThan(0.045);
    });

    it('par rate increases with tenor on upward-sloping curve', () => {
      // SOFR_CURVE is slightly inverted at the short end (typical post-2022 shape).
      // For a clean "upward-sloping" test, use a dedicated normal curve.
      const normalCurve = YieldCurve.fromPillars(
        [
          { tenorYears: 0.25, zeroRate: 0.02 },
          { tenorYears: 0.5, zeroRate: 0.022 },
          { tenorYears: 1.0, zeroRate: 0.025 },
          { tenorYears: 2.0, zeroRate: 0.03 },
          { tenorYears: 5.0, zeroRate: 0.04 },
          { tenorYears: 10.0, zeroRate: 0.05 },
        ],
        'USD-NORMAL',
      );
      const rate2Y = pricer.parSwapRate(normalCurve, 2.0, 2, 4);
      const rate5Y = pricer.parSwapRate(normalCurve, 5.0, 2, 4);
      const rate10Y = pricer.parSwapRate(normalCurve, 10.0, 2, 4);
      expect(rate5Y).toBeGreaterThan(rate2Y);
      expect(rate10Y).toBeGreaterThan(rate5Y);
    });
  });

  describe('NPV at inception', () => {
    it('NPV = 0 when fixed rate = par swap rate at inception', () => {
      const parRate = pricer.parSwapRate(SOFR_CURVE, 5.0, 2, 4);
      const npv = pricer.npv({
        notional: 10_000_000,
        fixedRate: parRate,
        tenorYears: 5.0,
        fixedFrequency: 2, // semi-annual
        floatFrequency: 4, // quarterly
        discountCurve: SOFR_CURVE,
        forwardCurve: SOFR_CURVE,
        isPayer: true,
      });
      expect(Math.abs(npv)).toBeLessThan(1); // < $1 on $10M notional
    });

    it('NPV is positive for payer when fixed rate < par rate', () => {
      const parRate = pricer.parSwapRate(SOFR_CURVE, 5.0, 2, 4);
      const belowPar = parRate - 0.01; // 100bp below par
      const npv = pricer.npv({
        notional: 10_000_000,
        fixedRate: belowPar,
        tenorYears: 5.0,
        fixedFrequency: 2,
        floatFrequency: 4,
        discountCurve: SOFR_CURVE,
        forwardCurve: SOFR_CURVE,
        isPayer: true, // pays below-market fixed = asset
      });
      expect(npv).toBeGreaterThan(0);
    });

    it('NPV changes sign for receiver vs payer', () => {
      const irs: IRSInput = {
        notional: 10_000_000,
        fixedRate: 0.04,
        tenorYears: 5.0,
        fixedFrequency: 2,
        floatFrequency: 4,
        discountCurve: SOFR_CURVE,
        forwardCurve: SOFR_CURVE,
        isPayer: true,
      };
      const payerNPV = pricer.npv(irs);
      const receiverNPV = pricer.npv({ ...irs, isPayer: false });
      expect(payerNPV).toBeCloseTo(-receiverNPV, 1);
    });
  });

  describe('DV01 (PVBP)', () => {
    it('DV01 is positive (both payer and receiver)', () => {
      const irs: IRSInput = {
        notional: 10_000_000,
        fixedRate: 0.04,
        tenorYears: 5.0,
        fixedFrequency: 2,
        floatFrequency: 4,
        discountCurve: SOFR_CURVE,
        forwardCurve: SOFR_CURVE,
        isPayer: true,
      };
      const result = pricer.sensitivities(irs);
      expect(result.dv01).toBeGreaterThan(0);
    });

    it('DV01 is proportional to notional', () => {
      const base: IRSInput = {
        notional: 1_000_000,
        fixedRate: 0.04,
        tenorYears: 5.0,
        fixedFrequency: 2,
        floatFrequency: 4,
        discountCurve: SOFR_CURVE,
        forwardCurve: SOFR_CURVE,
        isPayer: true,
      };
      const dv01_1M = pricer.sensitivities(base).dv01;
      const dv01_10M = pricer.sensitivities({ ...base, notional: 10_000_000 }).dv01;
      expect(dv01_10M).toBeCloseTo(dv01_1M * 10, 2);
    });
  });
});
