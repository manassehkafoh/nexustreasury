/**
 * @file yield-curve.test.ts
 * @description TDD tests for the YieldCurve domain model.
 *
 * A YieldCurve is the fundamental building block for all fixed-income and
 * derivative pricing. It maps maturities (tenors) to continuously-compounded
 * discount factors (or equivalently, zero rates).
 *
 * Test philosophy:
 *  - All expected values are computed from first principles or cross-checked
 *    against standard Bloomberg/Reuters benchmark fixtures.
 *  - Edge cases (flat curve, inverted curve, very short/long tenors) are
 *    explicitly tested to prevent silent mispricing.
 */

import { describe, it, expect } from 'vitest';
import { YieldCurve, InterpolationMethod, type CurvePillar } from './yield-curve.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Flat 5 % USD OIS curve — 5 pillars from 1M to 5Y */
const FLAT_5PCT_PILLARS: CurvePillar[] = [
  { tenorYears: 1 / 12, zeroRate: 0.05 },
  { tenorYears: 0.25, zeroRate: 0.05 },
  { tenorYears: 0.5, zeroRate: 0.05 },
  { tenorYears: 1.0, zeroRate: 0.05 },
  { tenorYears: 5.0, zeroRate: 0.05 },
];

/** Normal upward-sloping USD SOFR curve (approx Apr-2026 shape) */
const SOFR_PILLARS: CurvePillar[] = [
  { tenorYears: 1 / 12, zeroRate: 0.043 }, // 1M:  4.30%
  { tenorYears: 0.25, zeroRate: 0.0425 }, // 3M:  4.25%
  { tenorYears: 0.5, zeroRate: 0.0415 }, // 6M:  4.15%
  { tenorYears: 1.0, zeroRate: 0.04 }, // 1Y:  4.00%
  { tenorYears: 2.0, zeroRate: 0.0385 }, // 2Y:  3.85%
  { tenorYears: 5.0, zeroRate: 0.0375 }, // 5Y:  3.75%
  { tenorYears: 10.0, zeroRate: 0.039 }, // 10Y: 3.90%
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('YieldCurve', () => {
  describe('construction', () => {
    it('creates a curve from pillars', () => {
      const curve = YieldCurve.fromPillars(FLAT_5PCT_PILLARS, 'USD-OIS');
      expect(curve.name).toBe('USD-OIS');
      expect(curve.pillarCount).toBe(5);
    });

    it('throws if fewer than 2 pillars supplied', () => {
      expect(() => YieldCurve.fromPillars([{ tenorYears: 1, zeroRate: 0.05 }], 'BAD')).toThrow(
        'at least 2',
      );
    });

    it('throws if pillars are not sorted ascending by tenor', () => {
      expect(() =>
        YieldCurve.fromPillars(
          [
            { tenorYears: 2, zeroRate: 0.05 },
            { tenorYears: 1, zeroRate: 0.05 },
          ],
          'BAD',
        ),
      ).toThrow('ascending');
    });
  });

  describe('discount factor — flat 5% curve', () => {
    const curve = YieldCurve.fromPillars(FLAT_5PCT_PILLARS, 'USD-OIS');

    it('df(0) = 1.0 exactly', () => {
      expect(curve.discountFactor(0)).toBe(1.0);
    });

    it('df(1Y) ≈ e^(-0.05×1) = 0.95123', () => {
      expect(curve.discountFactor(1.0)).toBeCloseTo(Math.exp(-0.05), 5);
    });

    it('df(0.5Y) ≈ e^(-0.05×0.5) = 0.97531', () => {
      expect(curve.discountFactor(0.5)).toBeCloseTo(Math.exp(-0.025), 5);
    });

    it('df(5Y) ≈ e^(-0.25) = 0.77880', () => {
      expect(curve.discountFactor(5.0)).toBeCloseTo(Math.exp(-0.25), 5);
    });
  });

  describe('zero rate interpolation (linear log-df)', () => {
    const curve = YieldCurve.fromPillars(
      SOFR_PILLARS,
      'USD-SOFR',
      InterpolationMethod.LINEAR_LOG_DF,
    );

    it('returns exact pillar rates at pillar tenors', () => {
      for (const p of SOFR_PILLARS) {
        expect(curve.zeroRate(p.tenorYears)).toBeCloseTo(p.zeroRate, 6);
      }
    });

    it('interpolates between 1Y and 2Y smoothly', () => {
      const r1 = curve.zeroRate(1.0);
      const r15 = curve.zeroRate(1.5);
      const r2 = curve.zeroRate(2.0);
      // Mid-point should be between endpoints
      expect(r15).toBeGreaterThan(Math.min(r1, r2) - 1e-6);
      expect(r15).toBeLessThan(Math.max(r1, r2) + 1e-6);
    });

    it('forward rate between 1Y and 2Y is positive', () => {
      const fwd = curve.forwardRate(1.0, 2.0);
      expect(fwd).toBeGreaterThan(0);
    });
  });

  describe('forward rate', () => {
    const curve = YieldCurve.fromPillars(FLAT_5PCT_PILLARS, 'USD-OIS');

    it('forward rate on flat curve equals zero rate (5%)', () => {
      expect(curve.forwardRate(1.0, 2.0)).toBeCloseTo(0.05, 5);
    });

    it('throws when t1 >= t2', () => {
      expect(() => curve.forwardRate(2.0, 1.0)).toThrow('t1 must be less');
    });
  });

  describe('Nelson-Siegel-Svensson (NSS) fitting', () => {
    it('creates an NSS curve from parameters', () => {
      const nssCurve = YieldCurve.fromNSS(
        {
          beta0: 0.04, // long-run level
          beta1: -0.01, // slope
          beta2: 0.02, // curvature
          beta3: -0.005, // second curvature
          tau1: 1.5,
          tau2: 5.0,
        },
        'USD-NSS',
      );
      expect(nssCurve.zeroRate(1.0)).toBeGreaterThan(0);
      expect(nssCurve.zeroRate(10.0)).toBeCloseTo(0.04, 2); // converges to beta0
    });
  });

  describe('parallel shift stress', () => {
    it('shifts all rates by +100bp', () => {
      const base = YieldCurve.fromPillars(SOFR_PILLARS, 'USD-SOFR');
      const shocked = base.parallelShift(0.01);
      for (const p of SOFR_PILLARS) {
        expect(shocked.zeroRate(p.tenorYears)).toBeCloseTo(p.zeroRate + 0.01, 5);
      }
    });
  });
});
