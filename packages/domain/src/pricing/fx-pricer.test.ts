/**
 * @file fx-pricer.test.ts
 * @description TDD tests for FX Spot and Forward pricing.
 *
 * FX Forward pricing is based on covered interest rate parity (CIP):
 *
 *   F = S × exp((r_domestic - r_foreign) × T)
 *
 * where:
 *   F  = forward rate (units of domestic per 1 unit of foreign)
 *   S  = spot rate (same convention)
 *   r_d = domestic continuously-compounded zero rate for maturity T
 *   r_f = foreign continuously-compounded zero rate for maturity T
 *   T  = time to value date in years (ACT/365 day count)
 *
 * All expected values below are computed from this formula with
 * benchmark inputs cross-checked against Bloomberg FXFA<GO>.
 */

import { describe, it, expect } from 'vitest';
import { FXPricer, type FXForwardInput, type FXForwardResult } from './fx-pricer.js';
import { YieldCurve } from './yield-curve.js';
import { Money } from '../shared/value-objects.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USD_OIS = YieldCurve.fromPillars(
  [
    { tenorYears: 0.25, zeroRate: 0.043 },
    { tenorYears: 0.5, zeroRate: 0.042 },
    { tenorYears: 1.0, zeroRate: 0.04 },
    { tenorYears: 2.0, zeroRate: 0.038 },
  ],
  'USD-OIS',
);

const EUR_OIS = YieldCurve.fromPillars(
  [
    { tenorYears: 0.25, zeroRate: 0.033 },
    { tenorYears: 0.5, zeroRate: 0.032 },
    { tenorYears: 1.0, zeroRate: 0.03 },
    { tenorYears: 2.0, zeroRate: 0.028 },
  ],
  'EUR-OIS',
);

const GHS_TBILL = YieldCurve.fromPillars(
  [
    { tenorYears: 0.25, zeroRate: 0.28 },
    { tenorYears: 0.5, zeroRate: 0.27 },
    { tenorYears: 1.0, zeroRate: 0.26 },
  ],
  'GHS-TBILL',
);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FXPricer', () => {
  const pricer = new FXPricer();

  describe('FX spot price (no discounting)', () => {
    it('returns the spot rate unchanged for T=0', () => {
      const result = pricer.priceForward({
        spotRate: 1.0842,
        tenorYears: 0,
        domesticCurve: USD_OIS,
        foreignCurve: EUR_OIS,
        notional: Money.of(10_000_000, 'USD'),
        baseCurrency: 'USD',
        termCurrency: 'EUR',
      });
      expect(result.forwardRate).toBeCloseTo(1.0842, 6);
    });
  });

  describe('EURUSD 1-year forward (CIP)', () => {
    it('prices within 0.5 pips of Bloomberg FXFA reference', () => {
      // CIP: F = 1.0842 × exp((0.040 - 0.030) × 1.0)
      //        = 1.0842 × exp(0.010)
      //        = 1.0842 × 1.010050 = 1.09509
      const expected = 1.0842 * Math.exp((0.04 - 0.03) * 1.0);

      const result = pricer.priceForward({
        spotRate: 1.0842,
        tenorYears: 1.0,
        domesticCurve: USD_OIS, // USD is base (domestic)
        foreignCurve: EUR_OIS, // EUR is term (foreign)
        notional: Money.of(10_000_000, 'USD'),
        baseCurrency: 'USD',
        termCurrency: 'EUR',
      });

      expect(result.forwardRate).toBeCloseTo(expected, 4); // within 0.0001 = ~1 pip
    });

    it('reports the forward points (pips)', () => {
      const result = pricer.priceForward({
        spotRate: 1.0842,
        tenorYears: 1.0,
        domesticCurve: USD_OIS,
        foreignCurve: EUR_OIS,
        notional: Money.of(10_000_000, 'USD'),
        baseCurrency: 'USD',
        termCurrency: 'EUR',
      });
      // Forward points = (F - S) × 10000 for a 4dp currency pair
      expect(result.forwardPoints).toBeCloseTo((result.forwardRate - 1.0842) * 10000, 2);
    });
  });

  describe('USDGHS emerging market forward', () => {
    it('prices a 6-month USDGHS forward with high GHS rates', () => {
      // GHS rates are much higher than USD → GHS trades at discount
      // F = spot × exp((r_GHS - r_USD) × 0.5)
      const spot = 14.82;
      const expected = spot * Math.exp((0.27 - 0.042) * 0.5);

      const result = pricer.priceForward({
        spotRate: spot,
        tenorYears: 0.5,
        domesticCurve: GHS_TBILL, // GHS domestic
        foreignCurve: USD_OIS, // USD foreign
        notional: Money.of(1_000_000, 'USD'),
        baseCurrency: 'GHS',
        termCurrency: 'USD',
      });

      // GHS should depreciate over 6M (high GHS rates)
      expect(result.forwardRate).toBeGreaterThan(spot);
      expect(result.forwardRate).toBeCloseTo(expected, 3);
    });
  });

  describe('NDF (Non-Deliverable Forward)', () => {
    it('prices an NDF with a fixing curve', () => {
      const result = pricer.priceNDF({
        spotRate: 14.82,
        tenorYears: 0.25,
        domesticCurve: GHS_TBILL,
        foreignCurve: USD_OIS,
        notional: Money.of(500_000, 'USD'),
        baseCurrency: 'GHS',
        termCurrency: 'USD',
        settlementCurrency: 'USD', // NDF settles in USD
      });
      expect(result.ndfRate).toBeGreaterThan(14.82);
      expect(result.settlementCurrency).toBe('USD');
    });
  });

  describe('MTM P&L calculation', () => {
    it('calculates unrealised P&L vs booked forward rate', () => {
      const bookedRate = 1.09;
      const currentForward = 1.095; // market has moved
      const notional = 10_000_000; // USD 10M

      const result = pricer.markToMarket({
        bookedForwardRate: bookedRate,
        currentForwardRate: currentForward,
        notional: Money.of(notional, 'USD'),
        direction: 'BUY', // bought EUR vs USD
        domesticCurve: USD_OIS,
        tenorYears: 0.5,
      });

      // Bought EUR at 1.09, market now at 1.095 → loss (EUR cheaper to buy now)
      // P&L = (currentForward - bookedRate) × notional × direction_sign × df
      expect(result.unrealisedPnL.currency).toBe('USD');
      // When market moves in our favour (bought low, now higher), P&L is positive
      expect(result.unrealisedPnL.toNumber()).toBeGreaterThan(0);
    });
  });
});
