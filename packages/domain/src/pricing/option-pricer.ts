/**
 * @module OptionPricer
 * @description Black-Scholes option pricing engine for NexusTreasury.
 *
 * Implements the Garman-Kohlhagen extension of Black-Scholes for FX options,
 * which is identical to the standard model but replaces the domestic dividend
 * yield `q` with the foreign interest rate `r_f`.
 *
 * ## Formulae
 *
 * For a European call option:
 *   C = S × e^(-q×T) × N(d₁) - K × e^(-r×T) × N(d₂)
 *
 * For a European put option:
 *   P = K × e^(-r×T) × N(-d₂) - S × e^(-q×T) × N(-d₁)
 *
 * where:
 *   d₁ = [ln(S/K) + (r - q + σ²/2) × T] / (σ × √T)
 *   d₂ = d₁ - σ × √T
 *   N() = standard normal CDF
 *
 * ## Greeks (First and Second Order)
 *
 * | Greek | Meaning | Formula |
 * |-------|---------|---------|
 * | Δ (Delta) | Price sensitivity to spot move | ∂V/∂S |
 * | Γ (Gamma) | Rate of delta change | ∂²V/∂S² |
 * | ν (Vega) | Price sensitivity to vol move | ∂V/∂σ |
 * | Θ (Theta) | Time decay | ∂V/∂t (per day) |
 * | ρ (Rho) | Interest rate sensitivity | ∂V/∂r |
 *
 * ## Implied Volatility
 *
 * Implied vol is solved numerically using Newton-Raphson iteration:
 *   σ_{n+1} = σ_n - (BS(σ_n) - marketPrice) / Vega(σ_n)
 *
 * Convergence is guaranteed because vega is always positive for European options.
 *
 * @see {@link https://www.risk.net/derivatives/1510552} — Garman-Kohlhagen (1983)
 */

import { normCDF, normPDF } from './yield-curve.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Option type discriminator. */
export const OptionType = {
  CALL: 'CALL',
  PUT: 'PUT',
} as const;
export type OptionType = (typeof OptionType)[keyof typeof OptionType];

/** Complete input specification for Black-Scholes pricing. */
export interface BlackScholesInput {
  /** CALL or PUT */
  readonly optionType: OptionType;
  /** Current spot price of the underlying (S) */
  readonly spot: number;
  /** Strike price (K) */
  readonly strike: number;
  /** Time to expiry in years (T > 0) */
  readonly timeToExpiry: number;
  /** Domestic continuously-compounded risk-free rate (r) */
  readonly riskFreeRate: number;
  /** Foreign rate or continuous dividend yield (q). Use 0 for equity without dividends. */
  readonly dividendYield: number;
  /** Annualised implied volatility, e.g. 0.15 = 15% (σ > 0) */
  readonly volatility: number;
}

/** Implied volatility inversion input (all inputs except volatility). */
export interface ImpliedVolInput extends Omit<BlackScholesInput, 'volatility'> {
  readonly marketPrice: number;
}

/** Complete pricing result including premium and all first/second-order Greeks. */
export interface BlackScholesResult {
  /** Option fair value (premium) */
  readonly price: number;
  /** d₁ intermediate value (useful for debugging) */
  readonly d1: number;
  /** d₂ = d₁ - σ√T intermediate value */
  readonly d2: number;
  /** Delta (Δ): ∂V/∂S — range [0,1] for calls, [-1,0] for puts */
  readonly delta: number;
  /** Gamma (Γ): ∂²V/∂S² — always positive */
  readonly gamma: number;
  /** Vega (ν): ∂V/∂σ per 1% vol move — always positive */
  readonly vega: number;
  /** Theta (Θ): ∂V/∂t per calendar day — usually negative */
  readonly theta: number;
  /** Rho (ρ): ∂V/∂r per 1% rate move */
  readonly rho: number;
}

// ── OptionPricer Implementation ───────────────────────────────────────────────

/**
 * Black-Scholes / Garman-Kohlhagen option pricer.
 *
 * This class is stateless and thread-safe. All inputs are passed per-call.
 * AI/ML integration point: this pricer can be augmented with a neural-network
 * vol surface interpolator (e.g. trained on SABR surfaces) by replacing the
 * `volatility` input with a `getVolatility(strike, tenor): number` callback.
 */
export class OptionPricer {
  /**
   * Price a European option and compute all first and second-order Greeks.
   *
   * @param input - Option specification.
   * @returns Price and Greeks.
   * @throws If volatility ≤ 0 or timeToExpiry < 0.
   */
  price(input: BlackScholesInput): BlackScholesResult {
    this._validate(input);

    const {
      optionType,
      spot: S,
      strike: K,
      timeToExpiry: T,
      riskFreeRate: r,
      dividendYield: q,
      volatility: sigma,
    } = input;

    // Handle expiry at zero — return intrinsic value only
    if (T <= 1e-9) {
      const intrinsic = optionType === OptionType.CALL ? Math.max(S - K, 0) : Math.max(K - S, 0);
      return {
        price: intrinsic,
        d1: 0,
        d2: 0,
        delta: optionType === OptionType.CALL ? (S > K ? 1 : 0) : S < K ? -1 : 0,
        gamma: 0,
        vega: 0,
        theta: 0,
        rho: 0,
      };
    }

    const sqrtT = Math.sqrt(T);

    // ── d₁, d₂ ────────────────────────────────────────────────────────────────
    const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
    const d2 = d1 - sigma * sqrtT;

    // ── Discount factors ──────────────────────────────────────────────────────
    const dfR = Math.exp(-r * T); // domestic discount factor
    const dfQ = Math.exp(-q * T); // foreign/dividend discount factor

    // ── Option premium ────────────────────────────────────────────────────────
    let price: number;
    let delta: number;

    if (optionType === OptionType.CALL) {
      price = S * dfQ * normCDF(d1) - K * dfR * normCDF(d2);
      delta = dfQ * normCDF(d1);
    } else {
      price = K * dfR * normCDF(-d2) - S * dfQ * normCDF(-d1);
      delta = -dfQ * normCDF(-d1);
    }

    // ── Gamma ─────────────────────────────────────────────────────────────────
    // Γ = e^(-q×T) × N'(d₁) / (S × σ × √T)  — same for calls and puts
    const gamma = (dfQ * normPDF(d1)) / (S * sigma * sqrtT);

    // ── Vega ──────────────────────────────────────────────────────────────────
    // ν = S × e^(-q×T) × N'(d₁) × √T  (per unit of vol, i.e. per 100%)
    // Divide by 100 to get vega per 1% move
    const vega = (S * dfQ * normPDF(d1) * sqrtT) / 100;

    // ── Theta ─────────────────────────────────────────────────────────────────
    // Θ = ∂V/∂t — quoted per calendar day (÷365)
    const thetaCommon = -(S * dfQ * normPDF(d1) * sigma) / (2 * sqrtT);
    let theta: number;
    if (optionType === OptionType.CALL) {
      theta = (thetaCommon - r * K * dfR * normCDF(d2) + q * S * dfQ * normCDF(d1)) / 365;
    } else {
      theta = (thetaCommon + r * K * dfR * normCDF(-d2) - q * S * dfQ * normCDF(-d1)) / 365;
    }

    // ── Rho ───────────────────────────────────────────────────────────────────
    // ρ = ∂V/∂r — quoted per 1% rate move (÷100)
    let rho: number;
    if (optionType === OptionType.CALL) {
      rho = (K * T * dfR * normCDF(d2)) / 100;
    } else {
      rho = (-K * T * dfR * normCDF(-d2)) / 100;
    }

    return { price, d1, d2, delta, gamma, vega, theta, rho };
  }

  /**
   * Compute implied volatility from a market price using Newton-Raphson.
   *
   * The algorithm inverts the Black-Scholes formula iteratively:
   *   σ_{n+1} = σ_n - (BS(σ_n) - marketPrice) / Vega(σ_n)
   *
   * @param input - Market price and option specification (no vol needed).
   * @param initialGuess - Starting vol estimate (default: 0.20 = 20%).
   * @param maxIterations - Max iterations before giving up (default: 100).
   * @param tolerance - Convergence criterion in price units (default: 1e-7).
   * @returns Implied volatility.
   * @throws If algorithm does not converge within maxIterations.
   */
  impliedVolatility(
    input: ImpliedVolInput,
    initialGuess = 0.2,
    maxIterations = 100,
    tolerance = 1e-7,
  ): number {
    let sigma = initialGuess;

    for (let i = 0; i < maxIterations; i++) {
      const result = this.price({ ...input, volatility: sigma });
      const diff = result.price - input.marketPrice;

      if (Math.abs(diff) < tolerance) return sigma;

      // Vega in original units (not per 1%) for Newton step
      const vegaRaw = result.vega * 100;
      if (Math.abs(vegaRaw) < 1e-12) {
        throw new Error(
          'Implied volatility: vega too small, cannot converge. Check option is not deep OTM.',
        );
      }

      sigma = sigma - diff / vegaRaw;

      // Keep vol in reasonable bounds [0.001, 10.0]
      sigma = Math.max(0.001, Math.min(10.0, sigma));
    }

    throw new Error(
      `Implied volatility did not converge after ${maxIterations} iterations. ` +
        `Market price: ${input.marketPrice}, last sigma: ${sigma}.`,
    );
  }

  // ── Private ───────────────────────────────────────────────────────────────────

  private _validate(input: BlackScholesInput): void {
    if (input.volatility <= 0) {
      throw new Error(`OptionPricer: volatility must be positive, got ${input.volatility}.`);
    }
    if (input.timeToExpiry < 0) {
      throw new Error(
        `OptionPricer: timeToExpiry must be non-negative, got ${input.timeToExpiry}.`,
      );
    }
    if (input.spot <= 0) {
      throw new Error(`OptionPricer: spot must be positive, got ${input.spot}.`);
    }
    if (input.strike <= 0) {
      throw new Error(`OptionPricer: strike must be positive, got ${input.strike}.`);
    }
  }
}
