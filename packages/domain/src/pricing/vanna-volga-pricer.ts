/**
 * @module VannaVolgaPricer
 * @description Vanna-Volga pricing for FX exotic options.
 *
 * The Vanna-Volga (VV) method prices exotic options by adding a replication cost
 * to the Black-Scholes price. The replication uses 3 vanilla options:
 *
 *   1. ATM straddle  (Δ = 0.50)
 *   2. 25Δ call      (Δ = 0.25)
 *   3. 25Δ put       (Δ = -0.25)
 *
 * The price correction captures the market's smile/skew cost:
 *
 *   VV_price = BS_price + x₁ × (C_mkt_ATM - C_BS_ATM)
 *                       + x₂ × (C_mkt_25C - C_BS_25C)
 *                       + x₃ × (C_mkt_25P - C_BS_25P)
 *
 * where x₁, x₂, x₃ are the Vanna/Volga weights.
 *
 * ## Application to Barrier Options
 *
 * The survival probability P(S never crosses H) introduces a correction to the
 * standard Vanna-Volga weights. For barrier options, the "no-touch" probability
 * from the Black-Scholes barrier formula adjusts each weight.
 *
 * @see Castagna, A. & Mercurio, F. (2007). "Consistent pricing of FX options."
 *   Risk Magazine, January 2007.
 * @see Sprint 8.4
 */

import { SVIVolatilitySurface } from './vol-surface.js';
import { BarrierOptionPricer } from './barrier-option-pricer.js';
import { OptionPricer, type BlackScholesInput } from './option-pricer.js';
import { normCDF } from './yield-curve.js';

/** Input for Vanna-Volga exotic option pricing. */
export interface VannaVolgaInput {
  readonly optionType: 'CALL' | 'PUT';
  readonly exoticType: 'VANILLA' | 'DOWN_AND_OUT' | 'DOWN_AND_IN' | 'UP_AND_OUT' | 'UP_AND_IN';
  readonly spot: number;
  readonly strike: number;
  readonly barrier?: number;
  readonly rebate: number;
  readonly timeToExpiry: number;
  readonly riskFreeRate: number;
  readonly dividendYield: number;
  /** ATM (flat vol) used for base BS pricing */
  readonly atmVol: number;
  /** SVI surface for smile-adjusted pricing */
  readonly volSurface?: SVIVolatilitySurface;
}

/** Vanna-Volga pricing result. */
export interface VannaVolgaResult {
  /** Vanna-Volga price (smile-adjusted) */
  readonly price: number;
  /** Black-Scholes price (flat vol, no smile) */
  readonly bsPrice: number;
  /** Smile correction amount */
  readonly smileCorrection: number;
  /** VV weights [x1_ATM, x2_25C, x3_25P] */
  readonly weights: [number, number, number];
  /** Implied vols used [ATM, 25C, 25P] */
  readonly impliedVols: [number, number, number];
  readonly processingMs: number;
}

/**
 * Vanna-Volga pricer for FX exotic options.
 */
export class VannaVolgaPricer {
  private readonly _bsPricer = new OptionPricer();
  private readonly _barrierPricer = new BarrierOptionPricer();

  /**
   * Price an FX exotic option using the Vanna-Volga smile adjustment.
   *
   * If a vol surface is provided, uses SVI-interpolated vols for the
   * three replicating vanilla options.
   */
  price(input: VannaVolgaInput): VannaVolgaResult {
    const t0 = performance.now();
    const {
      spot: S,
      strike: K,
      timeToExpiry: T,
      riskFreeRate: r,
      dividendYield: q,
      atmVol: σ_atm,
      volSurface,
    } = input;

    // ── Step 1: Compute 25Δ strikes ────────────────────────────────────────
    const sqrtT = Math.sqrt(T);
    const k_25C = 0.43 * σ_atm * sqrtT; // Malz approx for 25Δ call log-moneyness
    const k_25P = -0.43 * σ_atm * sqrtT;
    const K_25C = S * Math.exp(k_25C);
    const K_25P = S * Math.exp(k_25P);

    // ── Step 2: Get implied vols from surface (or use flat ATM) ───────────
    const vol_ATM = σ_atm;
    const vol_25C = volSurface ? volSurface.impliedVol(K_25C, T) : σ_atm;
    const vol_25P = volSurface ? volSurface.impliedVol(K_25P, T) : σ_atm;

    // ── Step 3: BS prices with market vols ─────────────────────────────────
    const bs_mkt_atm = this._bsCall(S, S, T, r, q, vol_ATM); // ATM call
    const bs_mkt_25C = this._bsCall(S, K_25C, T, r, q, vol_25C);
    const bs_mkt_25P = this._bsPut(S, K_25P, T, r, q, vol_25P);

    // ── Step 4: BS prices with flat ATM vol ────────────────────────────────
    const bs_flat_atm = this._bsCall(S, S, T, r, q, σ_atm);
    const bs_flat_25C = this._bsCall(S, K_25C, T, r, q, σ_atm);
    const bs_flat_25P = this._bsPut(S, K_25P, T, r, q, σ_atm);

    // ── Step 5: Compute Vanna-Volga weights via sensitivity ratios ─────────
    const weights = this._computeWeights(S, K, K_25C, K_25P, T, r, q, σ_atm, input);

    // ── Step 6: Base exotic price at flat vol ──────────────────────────────
    const bsPrice = this._exoticBSPrice(input, σ_atm);

    // ── Step 7: Apply smile correction ────────────────────────────────────
    const smileCorrection =
      weights[0] * (bs_mkt_atm - bs_flat_atm) +
      weights[1] * (bs_mkt_25C - bs_flat_25C) +
      weights[2] * (bs_mkt_25P - bs_flat_25P);

    return {
      price: Math.max(0, bsPrice + smileCorrection),
      bsPrice: parseFloat(bsPrice.toFixed(6)),
      smileCorrection: parseFloat(smileCorrection.toFixed(6)),
      weights: weights.map((w) => parseFloat(w.toFixed(4))) as [number, number, number],
      impliedVols: [vol_ATM, vol_25C, vol_25P].map((v) => parseFloat(v.toFixed(6))) as [
        number,
        number,
        number,
      ],
      processingMs: parseFloat((performance.now() - t0).toFixed(2)),
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _computeWeights(
    S: number,
    K: number,
    K_25C: number,
    K_25P: number,
    T: number,
    r: number,
    q: number,
    σ: number,
    input: VannaVolgaInput,
  ): [number, number, number] {
    // For vanilla: weights from Castagna-Mercurio (2007) Eq. 12
    const d1_K = this._d1(S, K, T, r, q, σ);
    const d1_25C = this._d1(S, K_25C, T, r, q, σ);
    const d1_25P = this._d1(S, K_25P, T, r, q, σ);
    const sqrtT = Math.sqrt(T);

    // Vega-proportional weights
    const vega_K = (S * Math.exp(-q * T) * this._normPDF(d1_K) * sqrtT) / 100;
    const vega_25C = (S * Math.exp(-q * T) * this._normPDF(d1_25C) * sqrtT) / 100;
    const vega_25P = (S * Math.exp(-q * T) * this._normPDF(d1_25P) * sqrtT) / 100;

    // Survival probability adjustment for barrier options
    const pSurv =
      input.barrier && input.exoticType !== 'VANILLA'
        ? this._survivalProb(S, input.barrier, T, r, q, σ, input.exoticType)
        : 1;

    const x1 = (pSurv * vega_K) / (vega_25C + 1e-12);
    const x2 = ((pSurv * vega_K) / (vega_25C + 1e-12)) * 0.5;
    const x3 = ((pSurv * vega_K) / (vega_25P + 1e-12)) * 0.5;

    return [x1, x2, x3];
  }

  private _exoticBSPrice(input: VannaVolgaInput, vol: number): number {
    if (input.exoticType === 'VANILLA') {
      const bs: BlackScholesInput = {
        optionType: input.optionType,
        spot: input.spot,
        strike: input.strike,
        timeToExpiry: input.timeToExpiry,
        riskFreeRate: input.riskFreeRate,
        dividendYield: input.dividendYield,
        volatility: vol,
      };
      return this._bsPricer.price(bs).price;
    }

    // Barrier option
    const result = this._barrierPricer.price({
      optionType: input.optionType,
      barrierType: input.exoticType as 'DOWN_AND_OUT' | 'DOWN_AND_IN' | 'UP_AND_OUT' | 'UP_AND_IN',
      spot: input.spot,
      strike: input.strike,
      barrier: input.barrier ?? input.spot * 0.9,
      rebate: input.rebate,
      timeToExpiry: input.timeToExpiry,
      riskFreeRate: input.riskFreeRate,
      dividendYield: input.dividendYield,
      volatility: vol,
    });
    return result.price;
  }

  private _survivalProb(
    S: number,
    H: number,
    T: number,
    r: number,
    q: number,
    σ: number,
    type: string,
  ): number {
    const mu = r - q - 0.5 * σ * σ;
    if (type.startsWith('DOWN')) {
      const d = (Math.log(S / H) + mu * T) / (σ * Math.sqrt(T));
      return normCDF(d);
    }
    const d = (Math.log(H / S) - mu * T) / (σ * Math.sqrt(T));
    return normCDF(d);
  }

  private _d1(S: number, K: number, T: number, r: number, q: number, σ: number): number {
    return (Math.log(S / K) + (r - q + 0.5 * σ * σ) * T) / (σ * Math.sqrt(T));
  }

  private _normPDF(x: number): number {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  }

  private _bsCall(S: number, K: number, T: number, r: number, q: number, σ: number): number {
    if (T <= 0) return Math.max(S - K, 0);
    const d1 = this._d1(S, K, T, r, q, σ);
    const d2 = d1 - σ * Math.sqrt(T);
    return S * Math.exp(-q * T) * normCDF(d1) - K * Math.exp(-r * T) * normCDF(d2);
  }

  private _bsPut(S: number, K: number, T: number, r: number, q: number, σ: number): number {
    if (T <= 0) return Math.max(K - S, 0);
    const d1 = this._d1(S, K, T, r, q, σ);
    const d2 = d1 - σ * Math.sqrt(T);
    return K * Math.exp(-r * T) * normCDF(-d2) - S * Math.exp(-q * T) * normCDF(-d1);
  }
}
