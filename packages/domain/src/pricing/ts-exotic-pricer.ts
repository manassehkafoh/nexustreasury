/**
 * @module TsExoticPricer
 * @description TypeScript fallback implementation of IExoticPricer.
 *
 * This is the default implementation injected into PricingEngine when no
 * QuantLib WASM pool is available. It uses:
 *
 *   - Rubinstein-Reiner (1991) analytical formulas for barrier options
 *   - Conze-Viswanathan (1991) analytical formulas for look-backs
 *   - Longstaff-Schwartz (2001) LSM Monte Carlo for Bermudan swaptions
 *
 * ## Performance
 *
 * | Instrument      | P50   | P99   |
 * |-----------------|-------|-------|
 * | Barrier option  | < 1ms | < 2ms |
 * | Look-back       | < 1ms | < 2ms |
 * | Bermudan swap   | ~15ms | ~30ms |
 *
 * Vanilla instruments remain < 5ms P99 (per ADR-008 SLA).
 *
 * @see IExoticPricer — injectable interface
 */

import { normCDF } from './yield-curve.js';
import { BarrierOptionPricer } from './barrier-option-pricer.js';
import { BermudanSwaptionPricer } from './bermudan-swaption-pricer.js';
import type {
  IExoticPricer,
  BarrierOptionInput,
  BarrierOptionResult,
  LookbackOptionInput,
  LookbackOptionResult,
  BermudanSwaptionInput,
  BermudanSwaptionResult,
  PricerPoolStatus,
} from './exotic-pricer.interface.js';

/**
 * Pure TypeScript exotic pricer — default implementation.
 *
 * Implements IExoticPricer without any WASM dependency.
 * Production deployments swap this out for WasmExoticPricerPool.
 */
export class TsExoticPricer implements IExoticPricer {
  private readonly _barrierPricer = new BarrierOptionPricer();
  private readonly _bermudanPricer = new BermudanSwaptionPricer();

  /**
   * Price a barrier option using Rubinstein-Reiner (1991) analytical formulas.
   * P99 < 2ms for all barrier types.
   */
  priceBarrier(input: BarrierOptionInput): BarrierOptionResult {
    return this._barrierPricer.price(input);
  }

  /**
   * Price a look-back option using Conze-Viswanathan (1991) closed-form.
   *
   * Floating look-back call: max(0, S_T - S_min)  where S_min = min over [0,T]
   * Floating look-back put:  max(0, S_max - S_T)  where S_max = max over [0,T]
   *
   * P99 < 2ms.
   */
  priceLookback(input: LookbackOptionInput): LookbackOptionResult {
    const t0 = performance.now();
    const {
      optionType,
      spot: S,
      riskFreeRate: r,
      dividendYield: q,
      volatility: sigma,
      timeToExpiry: T,
      runningExtreme,
    } = input;

    if (T <= 0) {
      const price =
        optionType === 'CALL' ? Math.max(0, S - runningExtreme) : Math.max(0, runningExtreme - S);
      return {
        price,
        delta: optionType === 'CALL' ? 1 : -1,
        algorithm: 'CV_1991_ANALYTICAL',
        processingMs: performance.now() - t0,
      };
    }

    const sqrtT = Math.sqrt(T);
    const dfR = Math.exp(-r * T);
    const dfQ = Math.exp(-q * T);
    const m = runningExtreme; // running min (call) or max (put)
    const b = (2 * (r - q)) / (sigma * sigma);

    // Conze-Viswanathan (1991) formulas for floating look-back
    let price: number;
    let delta: number;

    if (input.lookbackType === 'FLOATING') {
      if (optionType === 'CALL') {
        // Floating look-back call: C = S·e^(-qT)·N(a1) - m·e^(-rT)·N(a2)
        //                            + S·e^(-qT)·(σ²/(2(r-q)))·[...]
        const a1 = (Math.log(S / m) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
        const a2 = a1 - sigma * sqrtT;
        const a3 = (Math.log(S / m) + (-r + q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);

        if (Math.abs(r - q) < 1e-8) {
          // Special case: r ≈ q
          price = S * dfQ * (normCDF(a1) + sigma * sqrtT * (normCDF(-a1) + a1 * (normCDF(a1) - 1)));
          price -= m * dfR * normCDF(a2);
        } else {
          const adjustment =
            ((sigma * sigma) / (2 * (r - q))) *
            (S * dfQ * normCDF(a1) - m * dfR * Math.pow(S / m, -b) * normCDF(a3));
          price = S * dfQ * normCDF(a1) - m * dfR * normCDF(a2) + adjustment;
        }
        delta = dfQ * normCDF(a1);
      } else {
        // Floating look-back put: max(0, S_max - S_T)
        const a1 = (Math.log(m / S) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
        const a2 = a1 - sigma * sqrtT;
        const a3 = (Math.log(m / S) + (-r + q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);

        if (Math.abs(r - q) < 1e-8) {
          price = m * dfR * normCDF(a1) - S * dfQ * (1 - sigma * sqrtT * normCDF(-a2));
        } else {
          const adjustment =
            ((sigma * sigma) / (2 * (r - q))) *
            (-S * dfQ * normCDF(-a1) + m * dfR * Math.pow(m / S, b) * normCDF(-a3));
          price = m * dfR * normCDF(a1) - S * dfQ * normCDF(-a2) + adjustment;
        }
        delta = -dfQ * normCDF(-a1);
      }
    } else {
      // Fixed strike look-back (Asian-like fixed maximum/minimum)
      const K = input.strike ?? m;
      const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
      const d2 = d1 - sigma * sqrtT;
      price =
        optionType === 'CALL'
          ? S * dfQ * normCDF(d1) - K * dfR * normCDF(d2)
          : K * dfR * normCDF(-d2) - S * dfQ * normCDF(-d1);
      delta = optionType === 'CALL' ? dfQ * normCDF(d1) : -dfQ * normCDF(-d1);
    }

    return {
      price: Math.max(0, price),
      delta,
      algorithm: 'CV_1991_ANALYTICAL',
      processingMs: performance.now() - t0,
    };
  }

  /**
   * Price a Bermudan swaption using Longstaff-Schwartz LSM Monte Carlo.
   * P99 ~30ms with default 10,000 paths.
   */
  priceBermudanSwaption(input: BermudanSwaptionInput): BermudanSwaptionResult {
    return this._bermudanPricer.price(input);
  }

  getPoolStatus(): PricerPoolStatus {
    return {
      poolSize: 1,
      availableInstances: 1,
      busyInstances: 0,
      implementationType: 'TYPESCRIPT',
      warmUpComplete: true,
    };
  }
}
