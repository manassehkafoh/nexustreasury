/**
 * @module IExoticPricer
 * @description Injectable interface for exotic instrument pricing (ADR-008).
 *
 * This interface is the ADR-008 injection point for exotic pricing.
 * The default implementation (`TsExoticPricer`) uses pure TypeScript
 * analytical and Monte Carlo formulas. The production implementation
 * (`WasmExoticPricerPool`) wraps QuantLib compiled to WebAssembly.
 *
 * ## Supported Instruments
 *
 * | Instrument         | Method              | Algorithm                          |
 * |--------------------|---------------------|------------------------------------|
 * | Barrier Option     | `priceBarrier`      | Rubinstein-Reiner (1991) analytical |
 * | Look-Back Option   | `priceLookback`     | Conze-Viswanathan (1991) analytical |
 * | Bermudan Swaption  | `priceBermudanSwaption` | Longstaff-Schwartz LSM MC       |
 *
 * ## Injection Pattern (ADR-008)
 *
 * ```typescript
 * // Risk service: inject QuantLib WASM pool in production
 * const engine = new PricingEngine({
 *   exoticPricer: new WasmExoticPricerPool({ poolSize: 4 }),
 * });
 *
 * // Tests: inject deterministic stub
 * const engine = new PricingEngine({
 *   exoticPricer: new TsExoticPricer(),
 * });
 * ```
 *
 * @see ADR-008 — Exotic Pricing Engine Architecture
 * @see ROADMAP.md Sprint 7.4
 */

// ── Barrier Option Types ───────────────────────────────────────────────────

/** Barrier type discriminator following ISDA 2021 definitions. */
export const BarrierType = {
  DOWN_AND_OUT: 'DOWN_AND_OUT',
  DOWN_AND_IN: 'DOWN_AND_IN',
  UP_AND_OUT: 'UP_AND_OUT',
  UP_AND_IN: 'UP_AND_IN',
} as const;
export type BarrierType = (typeof BarrierType)[keyof typeof BarrierType];

/** Option type (CALL or PUT). */
export const ExoticOptionType = {
  CALL: 'CALL',
  PUT: 'PUT',
} as const;
export type ExoticOptionType = (typeof ExoticOptionType)[keyof typeof ExoticOptionType];

/** Input for barrier option pricing (Rubinstein-Reiner 1991). */
export interface BarrierOptionInput {
  readonly optionType: ExoticOptionType;
  readonly barrierType: BarrierType;
  /** Current spot price (S > 0) */
  readonly spot: number;
  /** Strike price (K > 0) */
  readonly strike: number;
  /** Barrier level (H > 0) */
  readonly barrier: number;
  /** Cash rebate paid if option is knocked out (default 0) */
  readonly rebate: number;
  /** Time to expiry in years (T > 0) */
  readonly timeToExpiry: number;
  /** Domestic continuously-compounded risk-free rate */
  readonly riskFreeRate: number;
  /** Foreign rate or continuous dividend yield */
  readonly dividendYield: number;
  /** Annualised implied volatility (σ > 0) */
  readonly volatility: number;
}

/** Barrier option pricing result. */
export interface BarrierOptionResult {
  /** Option fair value */
  readonly price: number;
  /** Delta (∂V/∂S) */
  readonly delta: number;
  /** Gamma (∂²V/∂S²) */
  readonly gamma: number;
  /** Vega (∂V/∂σ per 1% move) */
  readonly vega: number;
  /** Whether the option is currently knocked in */
  readonly isKnockedIn: boolean;
  /** Whether the option is currently knocked out */
  readonly isKnockedOut: boolean;
  /** Pricing algorithm used */
  readonly algorithm: string;
  /** Processing time in milliseconds */
  readonly processingMs: number;
}

// ── Look-Back Option Types ─────────────────────────────────────────────────

/** Input for look-back option pricing (Conze-Viswanathan 1991). */
export interface LookbackOptionInput {
  readonly optionType: ExoticOptionType;
  /** Floating or fixed look-back */
  readonly lookbackType: 'FLOATING' | 'FIXED';
  readonly spot: number;
  /** For FIXED look-back: the fixed strike */
  readonly strike?: number;
  /** Running minimum (for floating call) or maximum (for floating put) observed so far */
  readonly runningExtreme: number;
  readonly timeToExpiry: number;
  readonly riskFreeRate: number;
  readonly dividendYield: number;
  readonly volatility: number;
}

/** Look-back option pricing result. */
export interface LookbackOptionResult {
  readonly price: number;
  readonly delta: number;
  readonly algorithm: string;
  readonly processingMs: number;
}

// ── Bermudan Swaption Types ────────────────────────────────────────────────

/** A single exercise date for a Bermudan swaption. */
export interface ExerciseDate {
  /** Time to exercise in years from today */
  readonly timeToExercise: number;
  /** Remaining swap tenor at exercise date in years */
  readonly remainingTenor: number;
}

/** Input for Bermudan swaption pricing (Longstaff-Schwartz LSM). */
export interface BermudanSwaptionInput {
  /** Payer or receiver swaption */
  readonly swaptionType: 'PAYER' | 'RECEIVER';
  /** Notional of the underlying swap */
  readonly notional: number;
  /** Fixed coupon rate of the underlying swap */
  readonly fixedRate: number;
  /** Current fair (par) swap rate */
  readonly currentSwapRate: number;
  /** Ordered list of exercise dates (earliest first) */
  readonly exerciseDates: ExerciseDate[];
  /** Annualised swaption implied volatility */
  readonly swaptionVol: number;
  /** Risk-free discount rate */
  readonly discountRate: number;
  /** Number of Monte Carlo paths for LSM (default: 10_000) */
  readonly numPaths?: number;
}

/** Bermudan swaption pricing result. */
export interface BermudanSwaptionResult {
  /** Swaption NPV in currency units */
  readonly price: number;
  /** DV01 — price sensitivity to 1bp rate move */
  readonly dv01: number;
  /** Optimal exercise probability at each exercise date */
  readonly exerciseProbs: number[];
  /** Earliest exercise date where continuation < intrinsic (Bermudan exercise boundary) */
  readonly exerciseBoundary: number;
  /** Algorithm and configuration used */
  readonly algorithm: string;
  readonly processingMs: number;
}

// ── Pool Status Types ──────────────────────────────────────────────────────

/** Status of an instance in the pricer pool. */
export interface PricerPoolStatus {
  readonly poolSize: number;
  readonly availableInstances: number;
  readonly busyInstances: number;
  readonly implementationType: 'WASM' | 'TYPESCRIPT';
  readonly warmUpComplete: boolean;
}

// ── IExoticPricer Interface ────────────────────────────────────────────────

/**
 * Injectable interface for exotic instrument pricing.
 *
 * Implementations:
 * - `TsExoticPricer`        — TypeScript analytical/MC fallback (default)
 * - `WasmExoticPricerPool`  — QuantLib WASM pool (production)
 *
 * @see ADR-008
 */
export interface IExoticPricer {
  /** Price a barrier option using Rubinstein-Reiner (1991) formulas. */
  priceBarrier(input: BarrierOptionInput): BarrierOptionResult;

  /** Price a look-back option using Conze-Viswanathan (1991) formulas. */
  priceLookback(input: LookbackOptionInput): LookbackOptionResult;

  /** Price a Bermudan swaption using Longstaff-Schwartz LSM Monte Carlo. */
  priceBermudanSwaption(input: BermudanSwaptionInput): BermudanSwaptionResult;

  /** Return pool health and instance availability. */
  getPoolStatus(): PricerPoolStatus;
}
