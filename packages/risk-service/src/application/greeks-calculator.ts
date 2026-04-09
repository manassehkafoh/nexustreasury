/**
 * @module GreeksCalculator
 * @description Portfolio-level Greeks aggregation service for NexusTreasury.
 *
 * This service computes risk sensitivities (Delta, Gamma, Vega, Theta, Rho, DV01)
 * at the position and book level by delegating to the domain pricing engine.
 *
 * ## Architecture
 *
 * ```
 * GreeksCalculator (Application Service)
 *   ├── PricingEngine  (Domain — per-instrument pricing)
 *   ├── YieldCurve     (Domain — discount factors)
 *   └── Position       (Domain — aggregate of trade exposures)
 * ```
 *
 * ## Greeks Computed
 *
 * | Greek | Scope | Method |
 * |-------|-------|--------|
 * | Delta (Δ) | FX, Equity Options | Black-Scholes ∂V/∂S |
 * | FX Delta  | FX Forwards | Notional × df |
 * | Gamma (Γ) | Options | Black-Scholes ∂²V/∂S² |
 * | Vega (ν)  | Options | Black-Scholes ∂V/∂σ |
 * | Theta (Θ) | Options | Black-Scholes ∂V/∂t (per day) |
 * | Rho (ρ)   | Options | Black-Scholes ∂V/∂r |
 * | DV01      | IRS, Bonds | PVBP — ±1bp parallel shift |
 * | CS01      | Credit | CDS spread sensitivity ±1bp |
 *
 * ## AI/ML Integration Point
 *
 * The `GreeksCalculator` exposes a `scenarioOverride` configuration that allows
 * an AI/ML model to supply custom scenario shocks (stress-test deltas, vol surface
 * adjustments) instead of standard Black-Scholes sensitivities. This enables:
 *
 *   - **Machine-learning SABR vol surface**: predict smile/skew from macro factors
 *   - **Stressed scenario Greeks**: inject crisis-period correlation matrices
 *   - **Anomaly-triggered re-pricing**: AI detects regime change and scales Greeks
 *
 * See `GreeksConfig.scenarioOverride` for the injection interface.
 *
 * @see {@link PricingEngine} for per-instrument pricing
 * @see {@link VaRCalculator} for aggregated VaR from Greeks
 */

import {
  PricingEngine,
  OptionType,
  type BlackScholesInput,
  type YieldCurve,
  type IRSInput,
  type BondInput,
} from '@nexustreasury/domain';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * The asset class of a position, used to determine which pricing formula applies.
 */
export const AssetClass = {
  FX_FORWARD: 'FX_FORWARD',
  FX_OPTION: 'FX_OPTION',
  EQUITY_OPTION: 'EQUITY_OPTION',
  BOND: 'BOND',
  IRS: 'IRS',
  MONEY_MARKET: 'MONEY_MARKET',
} as const;
export type AssetClass = (typeof AssetClass)[keyof typeof AssetClass];

/** A single position requiring Greeks calculation. */
export interface GreeksInput {
  readonly positionId: string;
  readonly bookId: string;
  readonly assetClass: AssetClass;
  readonly notional: number;
  readonly currency: string;

  // FX / Option inputs
  readonly spot?: number;
  readonly strike?: number;
  readonly timeToExpiry?: number;
  readonly volatility?: number;
  readonly optionType?: 'CALL' | 'PUT';
  readonly isLong?: boolean; // +1 = long, -1 = short

  // Curve inputs (for IRS, bonds, FX forwards)
  readonly discountCurve?: YieldCurve;
  readonly foreignCurve?: YieldCurve;

  // IRS-specific
  readonly irsInput?: Omit<IRSInput, 'discountCurve' | 'forwardCurve'>;

  // Bond-specific
  readonly bondInput?: Omit<BondInput, 'curve'>;
}

/** Greeks for a single position. */
export interface PositionGreeks {
  readonly positionId: string;
  readonly bookId: string;
  readonly assetClass: AssetClass;
  /** Delta (Δ): price change per 1% spot move (for FX/equity) or per 1bp (for IR) */
  readonly delta: number;
  /** Gamma (Γ): rate of delta change per 1% spot move squared */
  readonly gamma: number;
  /** Vega (ν): price change per 1% vol move */
  readonly vega: number;
  /** Theta (Θ): price decay per calendar day */
  readonly theta: number;
  /** Rho (ρ): price change per 1% rate move */
  readonly rho: number;
  /** DV01: price change per 1 basis point parallel yield shift (IR instruments) */
  readonly dv01: number;
  /** FX Delta: notional exposure in domestic currency (for FX positions) */
  readonly fxDelta: number;
  /** Present value of the position */
  readonly presentValue: number;
  readonly calculatedAt: Date;
}

/** Book-level aggregated Greeks. */
export interface BookGreeks {
  readonly bookId: string;
  /** Net Delta (positive = long, negative = short) */
  readonly netDelta: number;
  /** Net Gamma */
  readonly netGamma: number;
  /** Net Vega */
  readonly netVega: number;
  /** Net Theta (daily time decay, usually negative) */
  readonly netTheta: number;
  /** Net DV01 across all IR-sensitive positions */
  readonly netDV01: number;
  /** Total FX delta by currency */
  readonly fxDeltaByCcy: Record<string, number>;
  /** All position-level Greeks */
  readonly positions: ReadonlyArray<PositionGreeks>;
  readonly calculatedAt: Date;
}

/**
 * Configuration for the GreeksCalculator.
 *
 * All settings are optional — reasonable defaults are applied.
 */
export interface GreeksConfig {
  /**
   * Configurable risk-free rates for rho calculation.
   * If not provided, the domestic curve rate at the position tenor is used.
   */
  readonly riskFreeRates?: Record<string, number>;

  /**
   * AI/ML scenario override hook.
   *
   * When provided, the GreeksCalculator calls this function AFTER computing
   * standard Black-Scholes Greeks and applies any adjustments returned.
   * This enables ML-augmented Greeks (e.g., SABR smile adjustments, stressed
   * correlation matrices, or neural-network vol predictions).
   *
   * @example
   * ```typescript
   * const config: GreeksConfig = {
   *   scenarioOverride: async (standard, input) => ({
   *     ...standard,
   *     vega: standard.vega * mlVolAdjustmentFactor(input),
   *   }),
   * };
   * ```
   */
  readonly scenarioOverride?: ScenarioOverride;
}

/** AI/ML scenario override interface for augmenting computed Greeks. */
export interface ScenarioOverride {
  apply(
    standardGreeks: PositionGreeks,
    input: GreeksInput,
  ): Promise<PositionGreeks> | PositionGreeks;
}

// ── GreeksCalculator Implementation ───────────────────────────────────────────

/**
 * Portfolio-level Greeks aggregation service.
 *
 * @example
 * ```typescript
 * const calculator = new GreeksCalculator(new PricingEngine());
 *
 * // Calculate Greeks for a EUR put option position
 * const greeks = await calculator.calculatePosition({
 *   positionId:  'pos-001',
 *   bookId:      'fx-options-desk',
 *   assetClass:  AssetClass.FX_OPTION,
 *   notional:    10_000_000,
 *   currency:    'USD',
 *   spot:        1.0842,
 *   strike:      1.0700,
 *   timeToExpiry: 0.5,
 *   volatility:  0.082,
 *   optionType:  'PUT',
 *   isLong:      true,
 * });
 * console.log(`Delta: ${greeks.delta.toFixed(4)}`);
 * console.log(`Vega:  ${greeks.vega.toFixed(0)} USD per 1% vol`);
 * ```
 */
export class GreeksCalculator {
  private readonly _engine: PricingEngine;
  private readonly _config: GreeksConfig;

  constructor(engine: PricingEngine, config: GreeksConfig = {}) {
    this._engine = engine;
    this._config = config;
  }

  /**
   * Calculate Greeks for a single position.
   *
   * @param input - Position specification.
   * @returns Position-level Greeks.
   */
  async calculatePosition(input: GreeksInput): Promise<PositionGreeks> {
    let greeks: PositionGreeks;

    switch (input.assetClass) {
      case AssetClass.FX_OPTION:
      case AssetClass.EQUITY_OPTION:
        greeks = this._optionGreeks(input);
        break;

      case AssetClass.FX_FORWARD:
        greeks = this._fxForwardGreeks(input);
        break;

      case AssetClass.BOND:
        greeks = this._bondGreeks(input);
        break;

      case AssetClass.IRS:
        greeks = this._irsGreeks(input);
        break;

      case AssetClass.MONEY_MARKET:
        greeks = this._mmGreeks(input);
        break;

      default:
        greeks = this._zeroGreeks(input);
    }

    // Apply AI/ML scenario override if configured
    if (this._config.scenarioOverride) {
      return this._config.scenarioOverride.apply(greeks, input);
    }

    return greeks;
  }

  /**
   * Calculate and aggregate Greeks for an entire book.
   *
   * @param bookId    - Book identifier.
   * @param positions - All positions in the book.
   * @returns Aggregated book-level Greeks.
   */
  async calculateBook(bookId: string, positions: GreeksInput[]): Promise<BookGreeks> {
    const positionGreeks = await Promise.all(positions.map((p) => this.calculatePosition(p)));

    const fxDeltaByCcy: Record<string, number> = {};

    const aggregate = positionGreeks.reduce(
      (acc, g) => {
        // Aggregate FX delta by currency
        if (g.fxDelta !== 0) {
          const ccy = positions.find((p) => p.positionId === g.positionId)?.currency ?? 'USD';
          fxDeltaByCcy[ccy] = (fxDeltaByCcy[ccy] ?? 0) + g.fxDelta;
        }
        return {
          netDelta: acc.netDelta + g.delta,
          netGamma: acc.netGamma + g.gamma,
          netVega: acc.netVega + g.vega,
          netTheta: acc.netTheta + g.theta,
          netDV01: acc.netDV01 + g.dv01,
        };
      },
      { netDelta: 0, netGamma: 0, netVega: 0, netTheta: 0, netDV01: 0 },
    );

    return {
      bookId,
      ...aggregate,
      fxDeltaByCcy,
      positions: positionGreeks,
      calculatedAt: new Date(),
    };
  }

  // ── Private Pricers ───────────────────────────────────────────────────────────

  private _optionGreeks(input: GreeksInput): PositionGreeks {
    const {
      notional = 1,
      spot,
      strike,
      timeToExpiry,
      volatility,
      optionType,
      isLong = true,
      discountCurve,
      foreignCurve,
    } = input;

    if (!spot || !strike || timeToExpiry == null || !volatility) {
      return this._zeroGreeks(input);
    }

    const bsInput: BlackScholesInput = {
      optionType: optionType === 'PUT' ? OptionType.PUT : OptionType.CALL,
      spot,
      strike,
      timeToExpiry,
      volatility,
      riskFreeRate: discountCurve?.zeroRate(timeToExpiry) ?? 0.04,
      dividendYield: foreignCurve?.zeroRate(timeToExpiry) ?? 0,
    };

    const result = this._engine.priceOption(bsInput);
    const sign = isLong ? 1 : -1;
    const scaling = notional / spot; // options expressed per unit of notional

    return {
      positionId: input.positionId,
      bookId: input.bookId,
      assetClass: input.assetClass,
      delta: sign * result.delta * scaling,
      gamma: sign * result.gamma * scaling,
      vega: sign * result.vega * notional,
      theta: sign * result.theta * notional,
      rho: sign * result.rho * notional,
      dv01: 0,
      fxDelta: sign * result.delta * notional,
      presentValue: sign * result.price * scaling,
      calculatedAt: new Date(),
    };
  }

  private _fxForwardGreeks(input: GreeksInput): PositionGreeks {
    const { notional = 1, spot, timeToExpiry, discountCurve, isLong = true } = input;
    const sign = isLong ? 1 : -1;
    const df = discountCurve && timeToExpiry ? discountCurve.discountFactor(timeToExpiry) : 1.0;

    // FX forward: delta = df (the discounted notional exposure)
    const fxDelta = sign * notional * df;

    return {
      ...this._zeroGreeks(input),
      delta: sign * df,
      fxDelta,
      presentValue: sign * (spot ?? 0) * notional * df,
    };
  }

  private _bondGreeks(input: GreeksInput): PositionGreeks {
    const { notional = 1, bondInput, discountCurve, isLong = true } = input;
    if (!bondInput || !discountCurve) return this._zeroGreeks(input);

    const result = this._engine.priceBond({ ...bondInput, curve: discountCurve });
    const sign = isLong ? 1 : -1;
    const scaling = notional / (bondInput.faceValue ?? 100);

    return {
      ...this._zeroGreeks(input),
      delta: sign * result.modifiedDuration * scaling,
      dv01: sign * result.dv01 * scaling,
      presentValue: sign * result.dirtyPrice * scaling,
    };
  }

  private _irsGreeks(input: GreeksInput): PositionGreeks {
    const { irsInput, discountCurve } = input;
    if (!irsInput || !discountCurve) return this._zeroGreeks(input);

    const fullInput: IRSInput = {
      ...irsInput,
      discountCurve,
      forwardCurve: discountCurve,
    };
    const sensitivities = this._engine.irsSensitivities(fullInput);
    const sign = irsInput.isPayer ? 1 : -1;

    return {
      ...this._zeroGreeks(input),
      delta: sign * sensitivities.dv01 * 10000, // DV01 × 10000 = full rate delta
      dv01: sign * sensitivities.dv01,
      presentValue: sensitivities.npv,
    };
  }

  private _mmGreeks(input: GreeksInput): PositionGreeks {
    const { notional = 1, timeToExpiry, discountCurve, isLong = true } = input;
    const sign = isLong ? 1 : -1;
    const df = discountCurve && timeToExpiry ? discountCurve.discountFactor(timeToExpiry) : 1.0;
    const dv01 = (notional * (timeToExpiry ?? 0) * df) / 10000;

    return {
      ...this._zeroGreeks(input),
      dv01: sign * dv01,
      presentValue: sign * notional * df,
    };
  }

  /** Zero Greeks (unknown / unsupported asset class). */
  private _zeroGreeks(input: GreeksInput): PositionGreeks {
    return {
      positionId: input.positionId,
      bookId: input.bookId,
      assetClass: input.assetClass,
      delta: 0,
      gamma: 0,
      vega: 0,
      theta: 0,
      rho: 0,
      dv01: 0,
      fxDelta: 0,
      presentValue: 0,
      calculatedAt: new Date(),
    };
  }
}
