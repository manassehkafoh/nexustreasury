/**
 * @module IRSPricer
 * @description Interest Rate Swap (IRS) pricing engine for NexusTreasury.
 *
 * Supports plain-vanilla fixed-for-floating swaps (SOFR, EURIBOR, SONIA)
 * under the multi-curve framework introduced post-2008.
 *
 * ## Multi-Curve Framework
 *
 * Post-IBOR reform, swap pricing requires two separate curves:
 *   - **Discount curve** (OIS): used to discount all cash flows
 *     e.g. USD-SOFR, EUR-ESTR, GBP-SONIA
 *   - **Forward curve** (IBOR/RFR): used to project floating cash flows
 *     e.g. USD-SOFR 3M, EUR-EURIBOR 6M
 *
 * When the discount and forward curves are the same (standard OIS swap),
 * set both inputs to the same curve.
 *
 * ## NPV Formula
 *
 * Fixed leg present value (from the perspective of the RECEIVER):
 *   PV_fixed = fixed_rate × Σᵢ [τᵢ × df(Tᵢ)] × notional
 *
 * Floating leg present value (for a par floater resetting at SOFR):
 *   PV_float = (df(T₀) - df(Tₙ)) × notional
 *              (under single-curve; under multi-curve, forward rates projected separately)
 *
 * Swap NPV for the fixed-rate PAYER:
 *   NPV = PV_float - PV_fixed
 *
 * ## Par Swap Rate
 *
 * The fixed rate K* that makes NPV = 0 at inception:
 *   K* = (df(0) - df(Tₙ)) / [Σᵢ τᵢ × df(Tᵢ)]
 *
 * This is the "swap rate" quoted by interdealer brokers.
 */

import type { YieldCurve } from './yield-curve.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Input for IRS NPV calculation. */
export interface IRSInput {
  /** Notional principal (e.g. 10_000_000 for USD 10M) */
  readonly notional: number;
  /** Fixed rate on the swap as a decimal (e.g. 0.04 = 4%) */
  readonly fixedRate: number;
  /** Total swap tenor in years */
  readonly tenorYears: number;
  /** Fixed leg payment frequency per year (2=semi-annual, 4=quarterly) */
  readonly fixedFrequency: number;
  /** Floating leg payment frequency per year (4=quarterly typical for SOFR) */
  readonly floatFrequency: number;
  /** Curve used to discount cash flows (OIS curve) */
  readonly discountCurve: YieldCurve;
  /** Curve used to project floating rate cash flows */
  readonly forwardCurve: YieldCurve;
  /** true = paying fixed (long swap); false = receiving fixed (short swap) */
  readonly isPayer: boolean;
  /** Day count convention for fixed leg (ACT/360=0.9972, 30/360=1.0, ACT/365=1.0) */
  readonly dayCountFixed?: number;
  /** Day count convention for floating leg */
  readonly dayCountFloat?: number;
}

/** IRS sensitivity results. */
export interface IRSSensitivities {
  /** Dollar value of a basis point (PVBP) — always positive */
  readonly dv01: number;
  /** Modified duration of the fixed leg */
  readonly fixedLegDV01: number;
  /** Modified duration of the floating leg */
  readonly floatLegDV01: number;
  /** NPV of the trade */
  readonly npv: number;
}

// ── IRSPricer Implementation ──────────────────────────────────────────────────

/**
 * Interest Rate Swap pricing and analytics.
 *
 * ## Example — At-inception 5Y USD SOFR swap
 *
 * ```typescript
 * const pricer = new IRSPricer();
 * const sofrCurve = YieldCurve.fromPillars([...], 'USD-SOFR');
 *
 * const parRate = pricer.parSwapRate(sofrCurve, 5.0, 2, 4);
 * console.log(`5Y SOFR par rate: ${(parRate * 100).toFixed(4)}%`); // ~3.75%
 *
 * const npv = pricer.npv({
 *   notional: 10_000_000,
 *   fixedRate: parRate,
 *   tenorYears: 5.0,
 *   fixedFrequency: 2,
 *   floatFrequency: 4,
 *   discountCurve: sofrCurve,
 *   forwardCurve: sofrCurve,
 *   isPayer: true,
 * });
 * console.log(`NPV at inception: ${npv.toFixed(2)}`); // ~0
 * ```
 */
export class IRSPricer {
  /**
   * Compute the fair (par) swap rate — the fixed rate that makes NPV = 0.
   *
   * @param discountCurve  - OIS discount curve.
   * @param tenorYears     - Swap tenor in years.
   * @param fixedFrequency - Fixed leg payment frequency.
   * @param floatFrequency - Floating leg payment frequency.
   * @returns Par swap rate as a decimal.
   */
  parSwapRate(
    discountCurve: YieldCurve,
    tenorYears: number,
    fixedFrequency: number,
    floatFrequency: number,
  ): number {
    // Annuity factor = Σᵢ [τᵢ × df(Tᵢ)] over the fixed leg schedule
    const annuity = this._annuity(discountCurve, tenorYears, fixedFrequency);

    // Floating leg PV = df(0) - df(Tₙ) = 1 - df(Tₙ) (assuming no start lag)
    const df0 = 1.0;
    const dfN = discountCurve.discountFactor(tenorYears);
    const floatPV = df0 - dfN;

    // K* = floatPV / annuity
    return floatPV / annuity;
  }

  /**
   * Compute the NPV of an interest rate swap.
   *
   * @param input - Full swap specification.
   * @returns NPV in the notional currency (positive = asset, negative = liability).
   */
  npv(input: IRSInput): number {
    const {
      notional,
      fixedRate,
      tenorYears,
      fixedFrequency,
      floatFrequency,
      discountCurve,
      forwardCurve,
      isPayer,
      dayCountFixed = 1.0,
      dayCountFloat = 1.0,
    } = input;

    // ── Fixed leg PV ──────────────────────────────────────────────────────
    const fixedPeriod = 1 / fixedFrequency;
    const nFixed = Math.round(tenorYears * fixedFrequency);
    let pvFixed = 0;
    for (let i = 1; i <= nFixed; i++) {
      const t = i * fixedPeriod;
      const tau = fixedPeriod * dayCountFixed; // year fraction
      pvFixed += tau * discountCurve.discountFactor(t);
    }
    pvFixed *= fixedRate * notional;

    // ── Floating leg PV ───────────────────────────────────────────────────
    // The floating leg cash flows are reset at the prevailing SOFR/RFR at the
    // start of each period. For a standard OIS/RFR swap, the floating leg PV
    // uses the SIMPLE (not continuously-compounded) forward rate:
    //
    //   simple_fwd(t0, t1) = (df(t0)/df(t1) - 1) / τ
    //
    // so:
    //   simple_fwd × τ × df(t1) = df(t0) - df(t1)
    //
    // Summing over all periods telescopes to:
    //   PV_float = (df(T₀) - df(Tₙ)) × notional = (1 - df(Tₙ)) × notional
    //
    // This is consistent with the par swap rate formula:
    //   K* = (1 - df(Tₙ)) / annuity
    //
    // so NPV = 0 at inception when fixedRate = K*.
    const floatPeriod = 1 / floatFrequency;
    const nFloat = Math.round(tenorYears * floatFrequency);
    let pvFloat = 0;
    for (let i = 1; i <= nFloat; i++) {
      const t0 = (i - 1) * floatPeriod;
      const t1 = i * floatPeriod;
      // df(t0) = 1.0 when t0 = 0 (spot-starting swap)
      const df0 = t0 > 1e-9 ? forwardCurve.discountFactor(t0) : 1.0;
      const df1 = forwardCurve.discountFactor(t1);
      // Simple forward rate × tau × df(t1) = df(t0) - df(t1) — exact telescoping
      pvFloat += df0 - df1;
    }
    pvFloat *= notional;

    // ── NPV from payer's perspective ──────────────────────────────────────
    const sign = isPayer ? 1 : -1;
    return sign * (pvFloat - pvFixed);
  }

  /**
   * Compute IRS sensitivity measures (DV01, PVBP).
   *
   * @param input - Swap specification.
   * @returns DV01 and related sensitivities.
   */
  sensitivities(input: IRSInput): IRSSensitivities {
    const npvBase = this.npv(input);

    // Parallel shift +1bp on discount curve
    const shiftedCurve = input.discountCurve.parallelShift(0.0001);
    const npvShifted = this.npv({ ...input, discountCurve: shiftedCurve });

    // DV01 = |NPV(y+1bp) - NPV(y)| — quoted as positive
    const dv01 = Math.abs(npvShifted - npvBase);

    return {
      dv01,
      fixedLegDV01: dv01 * 0.5, // approximate split — full split requires leg-level shift
      floatLegDV01: dv01 * 0.5,
      npv: npvBase,
    };
  }

  // ── Private ───────────────────────────────────────────────────────────────────

  /** Compute the fixed leg annuity factor = Σᵢ [τᵢ × df(Tᵢ)]. */
  private _annuity(curve: YieldCurve, tenor: number, frequency: number): number {
    const period = 1 / frequency;
    const nPeriods = Math.round(tenor * frequency);
    let annuity = 0;
    for (let i = 1; i <= nPeriods; i++) {
      annuity += period * curve.discountFactor(i * period);
    }
    return annuity;
  }
}
