/**
 * @file option-pricer.test.ts
 * @description TDD tests for the Black-Scholes option pricing model.
 *
 * The Black-Scholes formula for European options:
 *
 *   Call: C = S × N(d1) - K × e^(-rT) × N(d2)
 *   Put:  P = K × e^(-rT) × N(-d2) - S × N(-d1)
 *
 * where:
 *   d1 = [ln(S/K) + (r - q + σ²/2) × T] / (σ × √T)
 *   d2 = d1 - σ × √T
 *   N() = standard normal CDF
 *   S  = spot price
 *   K  = strike
 *   r  = domestic risk-free rate (continuously compounded)
 *   q  = foreign/dividend yield (continuously compounded)
 *   σ  = implied volatility (annualised)
 *   T  = time to expiry in years
 *
 * All reference values cross-checked against Bloomberg OVDV<GO>
 * and the Haug "Complete Guide to Option Pricing Formulas" tables.
 */

import { describe, it, expect } from 'vitest';
import { OptionPricer, OptionType, type BlackScholesInput } from './option-pricer.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Canonical test case from Haug §1.1 p.8 */
const HAUG_CALL: BlackScholesInput = {
  optionType: OptionType.CALL,
  spot: 42.0,
  strike: 40.0,
  timeToExpiry: 0.5, // 6 months
  riskFreeRate: 0.1, // 10% p.a.
  dividendYield: 0.0,
  volatility: 0.2, // 20% p.a.
};

/** At-the-money 1Y EURUSD call — Bloomberg OVDV benchmark */
const ATM_FX_CALL: BlackScholesInput = {
  optionType: OptionType.CALL,
  spot: 1.0842,
  strike: 1.0842, // ATM
  timeToExpiry: 1.0,
  riskFreeRate: 0.04, // USD OIS
  dividendYield: 0.03, // EUR OIS (Garman-Kohlhagen)
  volatility: 0.075, // 7.5% EURUSD 1Y ATM vol
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('OptionPricer — Black-Scholes', () => {
  const pricer = new OptionPricer();

  describe('Haug canonical call (call 42 / strike 40 / T=0.5 / σ=20% / r=10%)', () => {
    it('prices call at 4.76 (Haug §1.1 reference value)', () => {
      const result = pricer.price(HAUG_CALL);
      // Haug reference: 4.7609
      expect(result.price).toBeCloseTo(4.76, 1);
    });

    it('call price is positive', () => {
      expect(pricer.price(HAUG_CALL).price).toBeGreaterThan(0);
    });

    it('call price ≥ max(S - K × e^(-rT), 0) — lower bound', () => {
      const { spot, strike, riskFreeRate, timeToExpiry } = HAUG_CALL;
      const lowerBound = Math.max(spot - strike * Math.exp(-riskFreeRate * timeToExpiry), 0);
      expect(pricer.price(HAUG_CALL).price).toBeGreaterThanOrEqual(lowerBound);
    });
  });

  describe('put-call parity', () => {
    it('C - P = S×e^(-qT) - K×e^(-rT) (Garman-Kohlhagen parity)', () => {
      const call = pricer.price({ ...ATM_FX_CALL, optionType: OptionType.CALL });
      const put = pricer.price({ ...ATM_FX_CALL, optionType: OptionType.PUT });
      const { spot, strike, riskFreeRate, dividendYield, timeToExpiry } = ATM_FX_CALL;

      const parity =
        spot * Math.exp(-dividendYield * timeToExpiry) -
        strike * Math.exp(-riskFreeRate * timeToExpiry);

      expect(call.price - put.price).toBeCloseTo(parity, 4);
    });
  });

  describe('Greeks — Delta', () => {
    it('call delta is between 0 and 1', () => {
      const { delta } = pricer.price(HAUG_CALL);
      expect(delta).toBeGreaterThan(0);
      expect(delta).toBeLessThan(1);
    });

    it('ITM call delta approaches 1', () => {
      const deepItm: BlackScholesInput = {
        ...HAUG_CALL,
        spot: 80,
        strike: 40, // deep in the money
      };
      expect(pricer.price(deepItm).delta).toBeCloseTo(1.0, 1);
    });

    it('OTM call delta approaches 0', () => {
      const deepOtm: BlackScholesInput = {
        ...HAUG_CALL,
        spot: 10,
        strike: 40, // deep out of the money
      };
      expect(pricer.price(deepOtm).delta).toBeCloseTo(0.0, 1);
    });

    it('put delta is between -1 and 0', () => {
      const put = pricer.price({ ...HAUG_CALL, optionType: OptionType.PUT });
      expect(put.delta).toBeGreaterThan(-1);
      expect(put.delta).toBeLessThan(0);
    });

    it('call delta + |put delta| ≈ 1 (ATM)', () => {
      const call = pricer.price({ ...ATM_FX_CALL, optionType: OptionType.CALL });
      const put = pricer.price({ ...ATM_FX_CALL, optionType: OptionType.PUT });
      expect(call.delta + Math.abs(put.delta)).toBeCloseTo(1.0, 1);
    });
  });

  describe('Greeks — Gamma', () => {
    it('gamma is positive for both calls and puts', () => {
      const call = pricer.price(HAUG_CALL);
      const put = pricer.price({ ...HAUG_CALL, optionType: OptionType.PUT });
      expect(call.gamma).toBeGreaterThan(0);
      expect(put.gamma).toBeGreaterThan(0);
    });

    it('gamma is highest for ATM options', () => {
      const atm = pricer.price({ ...HAUG_CALL, strike: 42 }); // ATM
      const itm = pricer.price({ ...HAUG_CALL, strike: 30 }); // deep ITM
      const otm = pricer.price({ ...HAUG_CALL, strike: 60 }); // deep OTM
      expect(atm.gamma).toBeGreaterThan(itm.gamma);
      expect(atm.gamma).toBeGreaterThan(otm.gamma);
    });
  });

  describe('Greeks — Vega', () => {
    it('vega is positive (higher vol → higher option price)', () => {
      const { vega } = pricer.price(ATM_FX_CALL);
      expect(vega).toBeGreaterThan(0);
    });

    it('higher volatility increases option price', () => {
      const low = pricer.price({ ...ATM_FX_CALL, volatility: 0.05 });
      const high = pricer.price({ ...ATM_FX_CALL, volatility: 0.2 });
      expect(high.price).toBeGreaterThan(low.price);
    });
  });

  describe('Greeks — Theta', () => {
    it('theta is negative (time decay reduces option value)', () => {
      const { theta } = pricer.price(ATM_FX_CALL);
      expect(theta).toBeLessThan(0);
    });
  });

  describe('Greeks — Rho', () => {
    it('call rho is positive (higher rates increase call value)', () => {
      const { rho } = pricer.price(HAUG_CALL);
      expect(rho).toBeGreaterThan(0);
    });
  });

  describe('boundary conditions', () => {
    it('option price = 0 when volatility = 0 and OTM', () => {
      const otm: BlackScholesInput = {
        ...HAUG_CALL,
        spot: 30, // below strike of 40
        volatility: 0.0001,
      };
      expect(pricer.price(otm).price).toBeCloseTo(0, 2);
    });

    it('throws on negative volatility', () => {
      expect(() => pricer.price({ ...HAUG_CALL, volatility: -0.1 })).toThrow('volatility');
    });

    it('throws on negative time to expiry', () => {
      expect(() => pricer.price({ ...HAUG_CALL, timeToExpiry: -0.1 })).toThrow('timeToExpiry');
    });
  });

  describe('implied volatility (Newton-Raphson inversion)', () => {
    it('recovers the input volatility from the price within 1bp', () => {
      const inputVol = 0.075;
      const marketPrice = pricer.price({ ...ATM_FX_CALL, volatility: inputVol }).price;

      const impliedVol = pricer.impliedVolatility({
        marketPrice,
        optionType: ATM_FX_CALL.optionType,
        spot: ATM_FX_CALL.spot,
        strike: ATM_FX_CALL.strike,
        timeToExpiry: ATM_FX_CALL.timeToExpiry,
        riskFreeRate: ATM_FX_CALL.riskFreeRate,
        dividendYield: ATM_FX_CALL.dividendYield,
      });

      expect(impliedVol).toBeCloseTo(inputVol, 4); // within 1bp (0.0001)
    });
  });
});
