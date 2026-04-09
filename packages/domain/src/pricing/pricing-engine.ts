/**
 * @module PricingEngine
 * @description Unified pricing engine for all NexusTreasury instruments.
 *
 * The PricingEngine is an **instrument-type dispatcher** that routes pricing
 * requests to the appropriate specialist pricer based on asset class and
 * product type. It is the single entry point for all pricing in the platform.
 *
 * ## Architecture
 *
 * ```
 * PricingEngine
 *   ├── FXPricer       (FX_SPOT, FX_FORWARD, FX_NDF, FX_OPTION)
 *   ├── BondPricer     (BOND, T_BILL, CD, CP, REPO)
 *   ├── IRSPricer      (IRS, OIS, FRA, CROSS_CURRENCY_SWAP)
 *   └── OptionPricer   (IR_CAP, IR_FLOOR, SWAPTION, EQUITY_OPTION)
 * ```
 *
 * ## Configuration
 *
 * The PricingEngine is highly configurable. Each pricer can be replaced with
 * a custom implementation (dependency injection). This enables:
 *
 *   1. **Backtesting**: inject a historical-data pricer
 *   2. **AI/ML pricing**: inject a neural-network-based pricer for exotics
 *   3. **Regulatory pricing**: inject conservative pricing for FRTB IMA
 *   4. **Testing**: inject a deterministic mock pricer
 *
 * ## AI/ML Integration Points
 *
 * The engine exposes two AI/ML hooks:
 *
 *   1. **Vol surface predictor** — optional ML model for implied vol interpolation
 *      instead of SABR. Useful for sparse vol surfaces (emerging markets).
 *
 *   2. **Basis spread predictor** — optional ML model for CIP deviation prediction
 *      in emerging market FX forwards (GHS, NGN, KES).
 *
 * Both hooks are disabled by default and activated via `PricingEngineConfig`.
 */

import { FXPricer } from './fx-pricer.js';
import { BondPricer } from './bond-pricer.js';
import { IRSPricer } from './irs-pricer.js';
import { OptionPricer } from './option-pricer.js';
import type {
  FXForwardInput,
  FXForwardResult,
  FXMTMInput,
  FXMTMResult,
  NDFInput,
  NDFResult,
} from './fx-pricer.js';
import type { BondInput, BondResult } from './bond-pricer.js';
import type { IRSInput, IRSSensitivities } from './irs-pricer.js';
import type { BlackScholesInput, BlackScholesResult, ImpliedVolInput } from './option-pricer.js';

// ── Configuration ─────────────────────────────────────────────────────────────

/**
 * Configuration object for the PricingEngine.
 *
 * All options are optional — the engine operates with sensible defaults.
 * Override individual pricers for testing, AI/ML integration, or
 * regulatory scenarios.
 */
export interface PricingEngineConfig {
  /**
   * Optional AI/ML implied volatility predictor.
   * If provided, replaces the flat Black-Scholes vol surface for FX options.
   *
   * @example
   * ```typescript
   * // Neural-net vol surface (trained on 2 years of EURUSD smile data)
   * const mlVolPredictor: VolPredictor = {
   *   predict: (pair, strike, spot, tenor) =>
   *     nnModel.infer({ pair, moneyness: strike/spot, tenor }),
   * };
   * const engine = new PricingEngine({ volPredictor: mlVolPredictor });
   * ```
   */
  readonly volPredictor?: VolPredictor;

  /**
   * Optional AI/ML CIP basis spread predictor for emerging market FX.
   * Returns the additional basis (in decimal) to apply on top of CIP.
   *
   * @example
   * ```typescript
   * // ML basis predictor for USDGHS
   * const basisPredictor: BasisPredictor = {
   *   predict: (pair, tenor) => mlGhanaModel.infer({ pair, tenor }),
   * };
   * ```
   */
  readonly basisPredictor?: BasisPredictor;

  /** Custom FX pricer (injection point for testing or specialised logic) */
  readonly fxPricer?: FXPricer;
  /** Custom bond pricer */
  readonly bondPricer?: BondPricer;
  /** Custom IRS pricer */
  readonly irsPricer?: IRSPricer;
  /** Custom option pricer */
  readonly optionPricer?: OptionPricer;
}

/** AI/ML volatility surface predictor interface. */
export interface VolPredictor {
  /** Predict implied vol for a given currency pair, strike, spot, and tenor. */
  predict(currencyPair: string, strike: number, spot: number, tenorYears: number): number;
}

/** AI/ML CIP basis spread predictor interface. */
export interface BasisPredictor {
  /** Predict CIP deviation for a given currency pair and tenor. */
  predict(currencyPair: string, tenorYears: number): number;
}

// ── PricingEngine Implementation ──────────────────────────────────────────────

/**
 * Unified instrument pricing dispatcher.
 *
 * @example
 * ```typescript
 * // Standard usage
 * const engine = new PricingEngine();
 *
 * // Price a EURUSD 1Y forward
 * const fxResult = engine.fx.priceForward({ ... });
 *
 * // Price a 5Y USD bond
 * const bondResult = engine.bond.price({ ... });
 *
 * // Price a 5Y USD SOFR swap
 * const swapNPV = engine.irs.npv({ ... });
 *
 * // Price an FX option
 * const optionResult = engine.option.price({ ... });
 * ```
 */
export class PricingEngine {
  /** FX spot, forward, NDF, and MTM pricer. */
  readonly fx: FXPricer;
  /** Fixed-income bond analytics (price, YTM, duration, DV01, convexity). */
  readonly bond: BondPricer;
  /** Interest rate swap pricer (NPV, par rate, DV01). */
  readonly irs: IRSPricer;
  /** Options pricer (Black-Scholes, Greeks, implied vol). */
  readonly option: OptionPricer;

  private readonly _config: PricingEngineConfig;

  constructor(config: PricingEngineConfig = {}) {
    this._config = config;
    this.fx = config.fxPricer ?? new FXPricer();
    this.bond = config.bondPricer ?? new BondPricer();
    this.irs = config.irsPricer ?? new IRSPricer();
    this.option = config.optionPricer ?? new OptionPricer();
  }

  // ── FX Convenience Methods ────────────────────────────────────────────────

  /** Price an FX forward. */
  priceFXForward(input: FXForwardInput): FXForwardResult {
    return this.fx.priceForward(input);
  }

  /** Price a Non-Deliverable Forward. */
  priceFXNDF(input: NDFInput): NDFResult {
    return this.fx.priceNDF(input);
  }

  /** MTM an open FX forward position. */
  markFXToMarket(input: FXMTMInput): FXMTMResult {
    return this.fx.markToMarket(input);
  }

  // ── Bond Convenience Methods ──────────────────────────────────────────────

  /** Price a bond and return all analytics. */
  priceBond(input: BondInput): BondResult {
    return this.bond.price(input);
  }

  // ── IRS Convenience Methods ───────────────────────────────────────────────

  /** Get the par swap rate for a given tenor and curve. */
  parSwapRate(
    discountCurve: import('./yield-curve.js').YieldCurve,
    tenorYears: number,
    fixedFrequency = 2,
    floatFrequency = 4,
  ): number {
    return this.irs.parSwapRate(discountCurve, tenorYears, fixedFrequency, floatFrequency);
  }

  /** Price a swap (NPV). */
  priceIRS(input: IRSInput): number {
    return this.irs.npv(input);
  }

  /** Get swap sensitivities (DV01). */
  irsSensitivities(input: IRSInput): IRSSensitivities {
    return this.irs.sensitivities(input);
  }

  // ── Options Convenience Methods ───────────────────────────────────────────

  /** Price a European option with full Greeks. */
  priceOption(input: BlackScholesInput): BlackScholesResult {
    return this.option.price(input);
  }

  /** Compute implied volatility from a market price. */
  impliedVolatility(input: ImpliedVolInput): number {
    return this.option.impliedVolatility(input);
  }

  // ── Configuration Accessors ───────────────────────────────────────────────

  /** Returns true if an ML vol predictor is configured. */
  get hasMLVolPredictor(): boolean {
    return !!this._config.volPredictor;
  }

  /** Returns true if an ML basis predictor is configured (for EM FX). */
  get hasMLBasisPredictor(): boolean {
    return !!this._config.basisPredictor;
  }
}
