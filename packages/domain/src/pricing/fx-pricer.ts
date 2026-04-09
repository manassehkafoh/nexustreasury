/**
 * @module FXPricer
 * @description FX Spot, Forward, NDF, and MTM pricing for NexusTreasury.
 *
 * ## Covered Interest Rate Parity (CIP)
 *
 * The fundamental no-arbitrage relationship for FX forwards:
 *
 *   F = S × exp((r_d - r_f) × T)
 *
 * where:
 *   F   = forward rate (domestic per 1 unit of foreign)
 *   S   = spot rate (same convention)
 *   r_d = domestic continuously-compounded zero rate at maturity T
 *   r_f = foreign continuously-compounded zero rate at maturity T
 *   T   = time to value date in years (ACT/365 day count)
 *
 * ## Quoting Convention
 *
 * NexusTreasury uses the market convention:
 *   - EURUSD: USD per 1 EUR (EUR = base, USD = term) → spot ~1.0842
 *   - USDGHS: GHS per 1 USD (USD = base, GHS = term) → spot ~14.82
 *
 * The `domesticCurve` is always the TERM currency (what you pay).
 * The `foreignCurve`  is always the BASE currency (what you receive).
 *
 * ## Forward Points
 *
 * Forward points = (F - S) × pip_factor
 * For 4dp pairs (EUR/USD): pip_factor = 10,000
 * For 2dp pairs (USD/JPY): pip_factor = 100
 *
 * @see {@link https://www.bis.org/publ/work915.pdf} — BIS CIP deviation research
 */

import type { YieldCurve } from './yield-curve.js';
import { Money } from '../shared/value-objects.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Input for pricing a deliverable FX forward. */
export interface FXForwardInput {
  /** Spot rate: domestic per 1 foreign (e.g. 1.0842 for EURUSD) */
  readonly spotRate: number;
  /** Time to value date in years (0 = spot, 0.5 = 6M, 1.0 = 1Y) */
  readonly tenorYears: number;
  /** Discount/funding curve for the DOMESTIC (term) currency */
  readonly domesticCurve: YieldCurve;
  /** Discount/funding curve for the FOREIGN (base) currency */
  readonly foreignCurve: YieldCurve;
  /** Notional in base currency */
  readonly notional: Money;
  /** ISO 4217 code for the base (foreign) currency, e.g. 'EUR' */
  readonly baseCurrency: string;
  /** ISO 4217 code for the term (domestic) currency, e.g. 'USD' */
  readonly termCurrency: string;
}

/** Input for pricing a Non-Deliverable Forward (NDF). */
export interface NDFInput extends FXForwardInput {
  /** Currency in which the NDF cash settles (typically USD) */
  readonly settlementCurrency: string;
}

/** MTM mark-to-market input for an existing open FX forward position. */
export interface FXMTMInput {
  /** The rate at which the position was originally booked */
  readonly bookedForwardRate: number;
  /** The current market forward rate for the same residual tenor */
  readonly currentForwardRate: number;
  /** Notional of the existing position */
  readonly notional: Money;
  /** 'BUY' = bought base currency; 'SELL' = sold base currency */
  readonly direction: 'BUY' | 'SELL';
  /** Discount curve for the domestic (term) currency (for PV of settlement) */
  readonly domesticCurve: YieldCurve;
  /** Remaining time to value date in years */
  readonly tenorYears: number;
}

/** Result from FX forward pricing. */
export interface FXForwardResult {
  /** The all-in forward rate (F) */
  readonly forwardRate: number;
  /** Forward points = (F - S) × pip_factor */
  readonly forwardPoints: number;
  /** Domestic discount factor at value date */
  readonly domesticDF: number;
  /** Foreign discount factor at value date */
  readonly foreignDF: number;
  /** The base notional */
  readonly notional: Money;
  /** The term notional (= base notional × forwardRate) */
  readonly termNotional: Money;
}

/** Result from NDF pricing. */
export interface NDFResult extends FXForwardResult {
  readonly ndfRate: number;
  readonly settlementCurrency: string;
}

/** Result from FX MTM calculation. */
export interface FXMTMResult {
  /** Unrealised P&L in the domestic (term) currency */
  readonly unrealisedPnL: Money;
  /** The present value of the P&L (discounted to today) */
  readonly pvPnL: Money;
  /** FX delta in units of notional */
  readonly fxDelta: number;
}

// ── FXPricer Implementation ───────────────────────────────────────────────────

/**
 * FX pricer supporting spot, forward, NDF, and MTM calculations.
 *
 * This class is stateless and immutable. All state is passed as input.
 *
 * ## AI/ML Integration Point
 *
 * The `priceForward` method can be augmented with a machine-learning
 * cross-currency basis spread predictor. Banks operating in markets with
 * CIP deviations (common for emerging market pairs like USDGHS, USDNGN)
 * can plug in an ML model that predicts the basis from macro factors:
 *
 * ```typescript
 * // Configurable ML basis override:
 * const basis = config.mlBasisPredictor?.predict(pair, tenor) ?? 0;
 * const forwardRate = spotRate * Math.exp(
 *   (rDomestic - rForeign + basis) * tenorYears
 * );
 * ```
 */
export class FXPricer {
  /**
   * Price a deliverable FX forward using covered interest rate parity.
   *
   * @param input - Forward specification including spot, tenor, and curves.
   * @returns Forward rate, points, DFs, and notionals.
   */
  priceForward(input: FXForwardInput): FXForwardResult {
    const { spotRate, tenorYears, domesticCurve, foreignCurve, notional, termCurrency } = input;

    if (tenorYears <= 0) {
      // Spot trade — return spot rate directly
      return {
        forwardRate: spotRate,
        forwardPoints: 0,
        domesticDF: 1.0,
        foreignDF: 1.0,
        notional,
        termNotional: Money.of(notional.toNumber() * spotRate, termCurrency),
      };
    }

    // ── CIP formula: F = S × exp((r_d - r_f) × T) ─────────────────────────
    const rDomestic = domesticCurve.zeroRate(tenorYears);
    const rForeign = foreignCurve.zeroRate(tenorYears);
    const domesticDF = domesticCurve.discountFactor(tenorYears);
    const foreignDF = foreignCurve.discountFactor(tenorYears);

    const forwardRate = spotRate * Math.exp((rDomestic - rForeign) * tenorYears);

    // ── Forward points (market quoting convention) ──────────────────────────
    // Using × 10000 as standard for 4dp currency pairs
    const forwardPoints = (forwardRate - spotRate) * 10000;

    const termNotional = Money.of(notional.toNumber() * forwardRate, termCurrency);

    return {
      forwardRate,
      forwardPoints,
      domesticDF,
      foreignDF,
      notional,
      termNotional,
    };
  }

  /**
   * Price a Non-Deliverable Forward (NDF).
   *
   * An NDF settles in a third currency (typically USD) rather than delivering
   * the exotic currency. The forward rate calculation is identical to a
   * deliverable forward — only the settlement mechanics differ.
   *
   * @param input - NDF specification including settlement currency.
   * @returns Forward rate and settlement currency.
   */
  priceNDF(input: NDFInput): NDFResult {
    const result = this.priceForward(input);
    return {
      ...result,
      ndfRate: result.forwardRate,
      settlementCurrency: input.settlementCurrency,
    };
  }

  /**
   * Mark-to-market an existing open FX forward position.
   *
   * The MTM P&L for a LONG base currency position is:
   *   MTM = (currentForwardRate - bookedForwardRate) × notional
   *
   * This is then discounted to today using the domestic discount factor.
   *
   * @param input - MTM specification with booked and current forward rates.
   * @returns Unrealised P&L (present-valued) and FX delta.
   */
  markToMarket(input: FXMTMInput): FXMTMResult {
    const {
      bookedForwardRate,
      currentForwardRate,
      notional,
      direction,
      domesticCurve,
      tenorYears,
    } = input;

    const sign = direction === 'BUY' ? 1 : -1;
    const rawPnL = sign * (currentForwardRate - bookedForwardRate) * notional.toNumber();

    // PV the P&L cash flow to today
    const df = tenorYears > 0 ? domesticCurve.discountFactor(tenorYears) : 1.0;
    const pvPnL = rawPnL * df;
    const currency = notional.currency;

    // FX delta = notional × domestic DF (the exposure to spot moves)
    const fxDelta = sign * notional.toNumber() * df;

    return {
      unrealisedPnL: Money.of(rawPnL, currency),
      pvPnL: Money.of(pvPnL, currency),
      fxDelta,
    };
  }
}
