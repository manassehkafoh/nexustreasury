/**
 * @module BondPricer
 * @description Fixed-income bond analytics for NexusTreasury.
 *
 * Supports government bonds, T-bills, corporate bonds, CDs, and any
 * instrument with fixed periodic coupon payments and a final principal.
 *
 * ## Price Formula
 *
 *   P = Σᵢ [C × df(Tᵢ)] + M × df(Tₙ)
 *
 * where:
 *   C   = periodic coupon = (couponRate × faceValue) / frequency
 *   M   = face value (par)
 *   Tᵢ  = time to the i-th coupon date in years
 *   Tₙ  = time to maturity
 *   df  = discount factor from the pricing curve
 *
 * ## Yield to Maturity (YTM)
 *
 * YTM is solved numerically (Newton-Raphson) from the price equation.
 *
 * ## Duration and Convexity
 *
 * Modified duration measures price sensitivity to parallel yield shifts:
 *   ΔP ≈ -D_mod × ΔY × P
 *
 * Convexity captures the curvature of the price-yield relationship:
 *   ΔP ≈ (-D_mod × ΔY + ½ × C × ΔY²) × P
 *
 * ## DV01 (Dollar Value of a Basis Point)
 *
 *   DV01 = D_mod × P × faceValue / 10000
 *
 * This represents the change in market value for a 1bp (0.01%) yield move.
 */

import type { YieldCurve } from './yield-curve.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Input specification for bond pricing. */
export interface BondInput {
  /** Par / face value (typically 100 for relative pricing, or actual notional) */
  readonly faceValue: number;
  /** Annual coupon rate as a decimal (e.g. 0.05 = 5%) */
  readonly couponRate: number;
  /** Coupon payments per year (1=annual, 2=semi-annual, 4=quarterly, 12=monthly) */
  readonly frequency: number;
  /** Remaining time to maturity in years */
  readonly residualYears: number;
  /** Discount curve for cash flow valuation */
  readonly curve: YieldCurve;
  /** Days from trade date to settlement date (default: 0 = same day) */
  readonly settlementOffset?: number;
}

/** Complete bond analytics result. */
export interface BondResult {
  /** Full (dirty) price = clean price + accrued interest */
  readonly dirtyPrice: number;
  /** Clean price (market-quoted, excluding accrued interest) */
  readonly cleanPrice: number;
  /** Accrued interest since last coupon */
  readonly accruedInterest: number;
  /** Yield to maturity (annualised, continuously compounded) */
  readonly yieldToMaturity: number;
  /** Dollar value of a basis point per faceValue unit of notional */
  readonly dv01: number;
  /** Modified duration in years */
  readonly modifiedDuration: number;
  /** Macaulay duration in years */
  readonly macaulayDuration: number;
  /** Convexity (second-order price sensitivity) */
  readonly convexity: number;
  /** Input face value (for reference) */
  readonly faceValue: number;
  /** All projected coupon cash flows (tenor, amount) */
  readonly cashFlows: ReadonlyArray<{ tenorYears: number; amount: number }>;
}

// ── BondPricer Implementation ─────────────────────────────────────────────────

/**
 * Fixed-income bond analytics engine.
 *
 * ## Usage
 *
 * ```typescript
 * const pricer = new BondPricer();
 * const result = pricer.price({
 *   faceValue:     100,
 *   couponRate:    0.05,    // 5% annual
 *   frequency:     2,       // semi-annual
 *   residualYears: 5.0,
 *   curve:         sofrCurve,
 * });
 * console.log(`Price: ${result.cleanPrice.toFixed(4)}`);  // e.g. 104.4518
 * console.log(`DV01:  ${result.dv01.toFixed(4)}`);        // e.g. 0.0452
 * ```
 */
export class BondPricer {
  /**
   * Compute full bond analytics: price, YTM, duration, convexity, DV01.
   *
   * @param input - Bond specification including curve.
   * @returns Complete analytics result.
   */
  price(input: BondInput): BondResult {
    const { faceValue, couponRate, frequency, residualYears, curve, settlementOffset = 0 } = input;

    // ── Build coupon schedule ──────────────────────────────────────────────
    const settleDelta = settlementOffset / 365;
    const couponPeriod = 1 / frequency;
    const couponAmount = (couponRate * faceValue) / frequency;

    // Number of full coupon periods remaining
    const nCoupons = Math.round(residualYears * frequency);

    // Build cash flow schedule: coupons + principal at maturity
    const cashFlows: Array<{ tenorYears: number; amount: number }> = [];
    for (let i = 1; i <= nCoupons; i++) {
      const tenor = i * couponPeriod + settleDelta;
      const isLast = i === nCoupons;
      cashFlows.push({
        tenorYears: tenor,
        amount: isLast ? couponAmount + faceValue : couponAmount,
      });
    }

    // ── Dirty price (full price from curve) ───────────────────────────────
    let dirtyPrice = 0;
    for (const cf of cashFlows) {
      dirtyPrice += cf.amount * curve.discountFactor(cf.tenorYears);
    }

    // ── Accrued interest ──────────────────────────────────────────────────
    // Accrued interest = coupon earned but not yet paid to the seller.
    //
    // Key cases:
    //  fractionalPeriod = 0  → settling ON a coupon date → accrued = 0
    //  fractionalPeriod < 0  → settling BETWEEN coupon dates
    //                          |fractionalPeriod| = fraction of next coupon period elapsed
    //  For full between-date support, integrate with a business day calendar.
    const fractionalPeriod = residualYears * frequency - nCoupons;
    const isOnCouponDate = Math.abs(fractionalPeriod) < 1e-9;
    const accruedInterest = isOnCouponDate
      ? 0
      : fractionalPeriod < 0
        ? // Fraction of current period elapsed = 1 - |fractionalPeriod| / couponPeriod
          // Wait: |fractionalPeriod| when < 0 gives the residual fraction to NEXT coupon.
          // Accrued = (1 - residualFraction) × couponAmount
          couponAmount * (1 - Math.abs(fractionalPeriod) * couponPeriod)
        : 0; // positive fractional period — edge case, treat as no accrual

    const cleanPrice = dirtyPrice - accruedInterest;

    // ── YTM (Newton-Raphson inversion) ────────────────────────────────────
    const yieldToMaturity = this._solveYTM(cashFlows, dirtyPrice, couponPeriod);

    // ── Macaulay duration ─────────────────────────────────────────────────
    // D_mac = Σ [t_i × C_i × df(t_i)] / P_dirty
    let macaulayDuration = 0;
    for (const cf of cashFlows) {
      macaulayDuration += cf.tenorYears * cf.amount * curve.discountFactor(cf.tenorYears);
    }
    macaulayDuration /= dirtyPrice;

    // ── Modified duration ─────────────────────────────────────────────────
    // D_mod = D_mac / (1 + y/frequency)  for periodic compounding
    // For continuous compounding: D_mod = D_mac
    const modifiedDuration = macaulayDuration;

    // ── DV01 (per unit of face value, per basis point) ────────────────────
    const dv01 = (modifiedDuration * dirtyPrice * faceValue) / 10000;

    // ── Convexity ─────────────────────────────────────────────────────────
    // Convexity = Σ [t_i² × C_i × df(t_i)] / P_dirty
    let convexity = 0;
    for (const cf of cashFlows) {
      convexity += cf.tenorYears * cf.tenorYears * cf.amount * curve.discountFactor(cf.tenorYears);
    }
    convexity /= dirtyPrice;

    return {
      dirtyPrice,
      cleanPrice,
      accruedInterest,
      yieldToMaturity,
      dv01,
      modifiedDuration,
      macaulayDuration,
      convexity,
      faceValue,
      cashFlows: Object.freeze([...cashFlows]),
    };
  }

  /**
   * Compute the par coupon rate — the coupon rate that makes price = face value.
   *
   * This is derived by solving: faceValue × (1 - df(T)) / annuity × frequency
   *
   * The par coupon rate for continuous discounting differs slightly from the
   * market-quoted par yield (which uses periodic compounding). This difference
   * is typically 1–5bp for standard tenors and rates.
   *
   * @param curve          - Discount curve.
   * @param residualYears  - Bond tenor in years.
   * @param frequency      - Coupon payments per year.
   * @param faceValue      - Par value (default: 100).
   * @returns Annual par coupon rate as a decimal.
   *
   * @example
   * ```typescript
   * const pricer = new BondPricer();
   * const parCpn = pricer.parCouponRate(sofrCurve, 5.0, 2);
   * // → 0.0404 for flat 4% continuous curve (vs 4.0% periodic par yield)
   * const result = pricer.price({ ...bond, couponRate: parCpn, curve });
   * console.log(result.cleanPrice); // → 100.000
   * ```
   */
  parCouponRate(
    curve: YieldCurve,
    residualYears: number,
    frequency: number,
    faceValue = 100,
  ): number {
    const period = 1 / frequency;
    const n = Math.round(residualYears * frequency);
    let annuity = 0;
    for (let i = 1; i <= n; i++) {
      annuity += curve.discountFactor(i * period);
    }
    const dfT = curve.discountFactor(residualYears);
    // K* = (faceValue × (1 - df(T))) / (faceValue × annuity) × frequency
    //    = (1 - df(T)) / annuity × frequency
    return ((1 - dfT) / annuity) * frequency;
  }

  // ── Private ───────────────────────────────────────────────────────────────────

  /**
   * Newton-Raphson solver for yield to maturity.
   * Converges typically in 5–10 iterations.
   */
  private _solveYTM(
    cashFlows: Array<{ tenorYears: number; amount: number }>,
    targetPrice: number,
    _couponPeriod: number,
    initialGuess = 0.05,
    maxIterations = 100,
    tolerance = 1e-8,
  ): number {
    let y = initialGuess;

    for (let i = 0; i < maxIterations; i++) {
      // Price and duration at current yield guess
      let price = 0;
      let duration = 0;
      for (const cf of cashFlows) {
        const df = Math.exp(-y * cf.tenorYears);
        price += cf.amount * df;
        duration += cf.tenorYears * cf.amount * df;
      }

      const diff = price - targetPrice;
      if (Math.abs(diff) < tolerance) return y;

      // Newton step: y_{n+1} = y_n - f(y_n) / f'(y_n)
      // f'(y) = -duration (first derivative w.r.t. yield is -Macaulay × Price)
      y = y + diff / duration;
      y = Math.max(0.0001, Math.min(2.0, y)); // bound in [0.01%, 200%]
    }

    return y; // Return best estimate if not fully converged
  }
}
