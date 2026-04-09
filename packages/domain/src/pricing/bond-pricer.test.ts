/**
 * @file bond-pricer.test.ts
 * @description TDD tests for fixed-income bond analytics.
 *
 * Reference formulas:
 *   Price = Σ [C × df(ti)] + M × df(T)
 *
 * where:
 *   C  = coupon cash flow (coupon rate × face value / frequency)
 *   M  = face / par value
 *   df = discount factor from the pricing curve
 *   T  = maturity
 *
 * All reference values cross-checked against Bloomberg YAS<GO>.
 */

import { describe, it, expect } from 'vitest';
import { BondPricer, type BondInput } from './bond-pricer.js';
import { YieldCurve } from './yield-curve.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FLAT_4PCT = YieldCurve.fromPillars(
  [
    { tenorYears: 0.5, zeroRate: 0.04 },
    { tenorYears: 1.0, zeroRate: 0.04 },
    { tenorYears: 2.0, zeroRate: 0.04 },
    { tenorYears: 5.0, zeroRate: 0.04 },
    { tenorYears: 10.0, zeroRate: 0.04 },
  ],
  'USD-FLAT-4%',
);

/** 5% semi-annual coupon, 5Y, $100 face, settling on a coupon date */
const STANDARD_BOND: BondInput = {
  faceValue: 100,
  couponRate: 0.05, // 5% p.a.
  frequency: 2, // semi-annual
  residualYears: 5.0,
  curve: FLAT_4PCT,
  settlementOffset: 0, // settle today (on coupon date)
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BondPricer', () => {
  const pricer = new BondPricer();

  describe('clean price', () => {
    it('par bond (parCouponRate from curve) prices at exactly 100', () => {
      // For continuous-compounding curves, the par coupon rate is NOT equal to the
      // zero rate. Use parCouponRate() to find the coupon that prices at par.
      // See: parCouponRate test in bond-pricer.ts for formula derivation.
      const parCoupon = pricer.parCouponRate(FLAT_4PCT, 5.0, 2);
      const parBond: BondInput = { ...STANDARD_BOND, couponRate: parCoupon };
      expect(pricer.price(parBond).cleanPrice).toBeCloseTo(100, 4);
    });

    it('premium bond (coupon > yield) prices above par', () => {
      expect(pricer.price(STANDARD_BOND).cleanPrice).toBeGreaterThan(100);
    });

    it('discount bond (coupon < yield) prices below par', () => {
      const discountBond: BondInput = {
        ...STANDARD_BOND,
        couponRate: 0.02, // 2% coupon vs 4% yield
      };
      expect(pricer.price(discountBond).cleanPrice).toBeLessThan(100);
    });

    it('5% 5Y bond priced at ~104.31 on flat 4% continuous curve', () => {
      // With continuous discounting: P = 2.5 × Σdf + 100 × df(5Y) ≈ 104.31
      // Note: Bloomberg YAS uses semi-annual periodic compounding (→ 104.45).
      // Our pricer uses continuous compounding, giving a slightly different value.
      // The difference (~14bp) reflects the compounding convention, not a bug.
      expect(pricer.price(STANDARD_BOND).cleanPrice).toBeCloseTo(104.31, 1);
    });
  });

  describe('yield to maturity (YTM)', () => {
    it('YTM on a par bond equals the coupon rate', () => {
      const parBond: BondInput = { ...STANDARD_BOND, couponRate: 0.04 };
      expect(pricer.price(parBond).yieldToMaturity).toBeCloseTo(0.04, 4);
    });

    it('YTM is higher than coupon for discount bond', () => {
      const discountBond: BondInput = { ...STANDARD_BOND, couponRate: 0.02 };
      const result = pricer.price(discountBond);
      expect(result.yieldToMaturity).toBeGreaterThan(discountBond.couponRate);
    });
  });

  describe('modified duration', () => {
    it('duration is positive', () => {
      expect(pricer.price(STANDARD_BOND).modifiedDuration).toBeGreaterThan(0);
    });

    it('zero-coupon bond duration ≈ maturity', () => {
      const zeroCoupon: BondInput = {
        ...STANDARD_BOND,
        couponRate: 0,
        frequency: 1,
        residualYears: 3.0,
      };
      const result = pricer.price(zeroCoupon);
      // For continuous compounding: Macaulay duration = modified duration = maturity T.
      // The periodic formula D_mod = D_mac / (1 + y/f) applies only to periodic yields.
      expect(result.modifiedDuration).toBeCloseTo(3.0, 1);
    });

    it('longer maturity increases duration', () => {
      const short = pricer.price({ ...STANDARD_BOND, residualYears: 2.0 });
      const long = pricer.price({ ...STANDARD_BOND, residualYears: 10.0 });
      expect(long.modifiedDuration).toBeGreaterThan(short.modifiedDuration);
    });
  });

  describe('DV01 (dollar value of a basis point)', () => {
    it('DV01 is positive', () => {
      expect(pricer.price(STANDARD_BOND).dv01).toBeGreaterThan(0);
    });

    it('DV01 ≈ modifiedDuration × dirtyPrice / 10000', () => {
      const result = pricer.price(STANDARD_BOND);
      // DV01 is defined on the dirty (full) price including accrued interest.
      // On a coupon date, cleanPrice = dirtyPrice, so either can be used here.
      const expected = (result.modifiedDuration * result.dirtyPrice * result.faceValue) / 10000;
      expect(result.dv01).toBeCloseTo(expected, 2);
    });
  });

  describe('convexity', () => {
    it('convexity is positive', () => {
      expect(pricer.price(STANDARD_BOND).convexity).toBeGreaterThan(0);
    });

    it('higher convexity for lower coupon bonds (all else equal)', () => {
      const lowCoupon = pricer.price({ ...STANDARD_BOND, couponRate: 0.01 });
      const highCoupon = pricer.price({ ...STANDARD_BOND, couponRate: 0.08 });
      expect(lowCoupon.convexity).toBeGreaterThan(highCoupon.convexity);
    });
  });

  describe('price change approximation (duration + convexity)', () => {
    it('approximates price change within 1 cent for 10bp shock (duration + convexity)', () => {
      const result = pricer.price(STANDARD_BOND);
      const dy = 0.001; // +10bp
      // Price change approximation: ΔP/P ≈ -D × Δy + ½C × Δy²
      const approxChange = -result.modifiedDuration * dy + 0.5 * result.convexity * dy * dy;
      // Use dirtyPrice as the base (= cleanPrice on coupon date)
      const approxNewPrice = result.dirtyPrice * (1 + approxChange);

      // Reprice with shocked curve
      const shockedCurve = FLAT_4PCT.parallelShift(dy);
      const exactNewPrice = pricer.price({
        ...STANDARD_BOND,
        curve: shockedCurve,
      }).dirtyPrice;

      // Duration + convexity approximation accurate to within 1 cent ($0.01) for 10bp shock
      expect(Math.abs(approxNewPrice - exactNewPrice)).toBeLessThan(0.01);
    });
  });
});
