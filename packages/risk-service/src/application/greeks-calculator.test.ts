/**
 * @file greeks-calculator.test.ts
 * @description TDD tests for the GreeksCalculator application service.
 */

import { describe, it, expect } from 'vitest';
import { PricingEngine, YieldCurve } from '@nexustreasury/domain';
import { GreeksCalculator, AssetClass, type GreeksInput } from './greeks-calculator.js';

const engine = new PricingEngine();
const calc = new GreeksCalculator(engine);

const USD_CURVE = YieldCurve.fromPillars(
  [
    { tenorYears: 0.5, zeroRate: 0.042 },
    { tenorYears: 1.0, zeroRate: 0.04 },
  ],
  'USD-OIS',
);
const EUR_CURVE = YieldCurve.fromPillars(
  [
    { tenorYears: 0.5, zeroRate: 0.032 },
    { tenorYears: 1.0, zeroRate: 0.03 },
  ],
  'EUR-OIS',
);

describe('GreeksCalculator', () => {
  describe('FX option Greeks', () => {
    const fxOption: GreeksInput = {
      positionId: 'pos-001',
      bookId: 'fx-desk',
      assetClass: AssetClass.FX_OPTION,
      notional: 10_000_000,
      currency: 'USD',
      spot: 1.0842,
      strike: 1.0842, // ATM
      timeToExpiry: 1.0,
      volatility: 0.075,
      optionType: 'CALL',
      isLong: true,
      discountCurve: USD_CURVE,
      foreignCurve: EUR_CURVE,
    };

    it('computes positive delta for long ATM call', async () => {
      const greeks = await calc.calculatePosition(fxOption);
      expect(greeks.delta).toBeGreaterThan(0);
    });

    it('computes positive gamma', async () => {
      const greeks = await calc.calculatePosition(fxOption);
      expect(greeks.gamma).toBeGreaterThan(0);
    });

    it('computes positive vega', async () => {
      const greeks = await calc.calculatePosition(fxOption);
      expect(greeks.vega).toBeGreaterThan(0);
    });

    it('computes negative theta (time decay)', async () => {
      const greeks = await calc.calculatePosition(fxOption);
      expect(greeks.theta).toBeLessThan(0);
    });

    it('long and short have opposite delta signs', async () => {
      const longGreeks = await calc.calculatePosition({ ...fxOption, isLong: true });
      const shortGreeks = await calc.calculatePosition({ ...fxOption, isLong: false });
      expect(longGreeks.delta).toBeGreaterThan(0);
      expect(shortGreeks.delta).toBeLessThan(0);
    });
  });

  describe('FX Forward Greeks', () => {
    const fxForward: GreeksInput = {
      positionId: 'pos-002',
      bookId: 'fx-desk',
      assetClass: AssetClass.FX_FORWARD,
      notional: 10_000_000,
      currency: 'USD',
      spot: 1.0842,
      timeToExpiry: 1.0,
      discountCurve: USD_CURVE,
      isLong: true,
    };

    it('FX delta ≈ notional × df for a 1Y forward', async () => {
      const greeks = await calc.calculatePosition(fxForward);
      const expectedFxDelta = 10_000_000 * USD_CURVE.discountFactor(1.0);
      expect(greeks.fxDelta).toBeCloseTo(expectedFxDelta, -2); // within $100
    });

    it('DV01 is 0 (FX forward has no IR sensitivity in this simplified model)', async () => {
      const greeks = await calc.calculatePosition(fxForward);
      expect(greeks.dv01).toBe(0);
    });
  });

  describe('Book-level aggregation', () => {
    it('aggregates Greeks across multiple positions', async () => {
      const positions: GreeksInput[] = [
        {
          positionId: 'pos-003',
          bookId: 'book-01',
          assetClass: AssetClass.FX_OPTION,
          notional: 5_000_000,
          currency: 'USD',
          spot: 1.0842,
          strike: 1.0842,
          timeToExpiry: 0.5,
          volatility: 0.075,
          optionType: 'CALL',
          isLong: true,
          discountCurve: USD_CURVE,
          foreignCurve: EUR_CURVE,
        },
        {
          positionId: 'pos-004',
          bookId: 'book-01',
          assetClass: AssetClass.FX_OPTION,
          notional: 5_000_000,
          currency: 'USD',
          spot: 1.0842,
          strike: 1.0842,
          timeToExpiry: 0.5,
          volatility: 0.075,
          optionType: 'CALL',
          isLong: false, // short call = hedges the long
          discountCurve: USD_CURVE,
          foreignCurve: EUR_CURVE,
        },
      ];

      const bookGreeks = await calc.calculateBook('book-01', positions);
      // Long call + short call = flat book → net delta ≈ 0
      expect(Math.abs(bookGreeks.netDelta)).toBeLessThan(0.01);
      expect(bookGreeks.positions).toHaveLength(2);
    });
  });

  describe('AI/ML scenario override', () => {
    it('applies scenario override to computed Greeks', async () => {
      let overrideCalled = false;
      const calcWithOverride = new GreeksCalculator(engine, {
        scenarioOverride: {
          apply: (greeks) => {
            overrideCalled = true;
            return { ...greeks, vega: greeks.vega * 2 }; // doubles vega in stress
          },
        },
      });

      const fxOption: GreeksInput = {
        positionId: 'pos-005',
        bookId: 'test',
        assetClass: AssetClass.FX_OPTION,
        notional: 1_000_000,
        currency: 'USD',
        spot: 1.0842,
        strike: 1.0842,
        timeToExpiry: 1.0,
        volatility: 0.075,
        optionType: 'CALL',
        isLong: true,
        discountCurve: USD_CURVE,
        foreignCurve: EUR_CURVE,
      };

      const baseGreeks = await calc.calculatePosition(fxOption);
      const overrideGreeks = await calcWithOverride.calculatePosition(fxOption);

      expect(overrideCalled).toBe(true);
      expect(overrideGreeks.vega).toBeCloseTo(baseGreeks.vega * 2, 4);
    });
  });
});
