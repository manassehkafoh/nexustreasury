/**
 * @module SukukPricer
 * @description Sharia-compliant Sukuk pricing engine for NexusTreasury.
 *
 * Implements cash flow modelling for the two most common Sukuk structures:
 *
 * ## Ijara Sukuk (Lease-based)
 *   Periodic rental payments from SPV to certificate holders, backed by
 *   ownership of a leased asset. Cash flows mirror a conventional bond but
 *   the return is rent (ujrah), not interest (riba).
 *
 *   Yield Calculation:
 *   P = Σᵢ [Rental_i × df(tᵢ)] + FaceValue × df(tₙ)
 *   where df = discount factor using the Islamic benchmark rate
 *   (IIBOR, SAIBOR, or risk-free rate as a proxy where permitted by AAOIFI)
 *
 * ## Murabaha Sukuk (Cost-plus-profit)
 *   One or more fixed profit payments at maturity. The profit rate (ribh)
 *   replaces the coupon rate. No compounding is applied (AAOIFI Standard 17).
 *
 *   P = Principal × (1 + ribhRate × tenorYears)   [simple profit, no compounding]
 *
 * ## Regulatory Framework
 * - AAOIFI FAS 28 (Sukuk)
 * - IFSB-7 (Capital Adequacy for Sukuk Exposures)
 * - Basel III risk weights applied per underlying asset type
 *
 * @see AAOIFI Sharia Standard No. 17 — Investment Sukuk
 * @see Sprint 9.1
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** Sukuk structure type. */
export const SukukType = {
  IJARA:    'IJARA',    // Lease-backed — periodic rental payments
  MURABAHA: 'MURABAHA', // Cost-plus — single terminal profit payment
  MUSHARAKA:'MUSHARAKA',// Partnership — profit/loss sharing
  WAKALA:   'WAKALA',   // Agency — investment mandate
} as const;
export type SukukType = (typeof SukukType)[keyof typeof SukukType];

/** AAOIFI credit quality categories for Basel III risk weight mapping. */
export const SukukGrade = {
  INVESTMENT_GRADE: 'INVESTMENT_GRADE',
  SUB_INVESTMENT:   'SUB_INVESTMENT',
  UNRATED:          'UNRATED',
} as const;
export type SukukGrade = (typeof SukukGrade)[keyof typeof SukukGrade];

/** Input for Ijara Sukuk pricing. */
export interface IjaraSukukInput {
  readonly sukukType:       'IJARA';
  /** Face value (principal) of the Sukuk */
  readonly faceValue:        number;
  /** Periodic rental rate (ujrah) as a decimal — replaces coupon rate */
  readonly rentalRate:       number;
  /** Payment frequency per year (typically 2 or 4) */
  readonly frequency:        number;
  /** Remaining tenor in years */
  readonly tenorYears:       number;
  /** Islamic benchmark rate used for discounting (IIBOR proxy, NOT riba) */
  readonly discountRate:     number;
  /** Currency */
  readonly currency:         string;
  /** AAOIFI credit grade for regulatory risk weight */
  readonly grade:            SukukGrade;
  /** Underlying asset description (for AAOIFI FAS 28 disclosure) */
  readonly underlyingAsset?: string;
}

/** Input for Murabaha Sukuk pricing. */
export interface MurabahaSukukInput {
  readonly sukukType:    'MURABAHA';
  /** Principal amount */
  readonly faceValue:    number;
  /** Profit rate (ribh rate) — simple, no compounding (AAOIFI Standard 17) */
  readonly ribhRate:     number;
  /** Tenor in years */
  readonly tenorYears:   number;
  /** Discount rate for NPV calculation */
  readonly discountRate: number;
  readonly currency:     string;
  readonly grade:        SukukGrade;
}

export type SukukInput = IjaraSukukInput | MurabahaSukukInput;

/** Sukuk pricing result. */
export interface SukukResult {
  /** Dirty price (full price including accrued) */
  readonly dirtyPrice:        number;
  /** Clean price */
  readonly cleanPrice:        number;
  /** Sharia-compliant yield (analogous to YTM but labelled as profit rate) */
  readonly profitRate:        number;
  /** DV01 (price sensitivity to 1bp change in discount rate) */
  readonly dv01:               number;
  /** Modified duration */
  readonly modifiedDuration:   number;
  /** Basel III risk weight (%) per IFSB-7 */
  readonly riskWeightPct:      number;
  /** Regulatory capital charge (Basel III SA approach) */
  readonly reguCapitalCharge:  number;
  /** Sharia compliance note */
  readonly shariaNote:         string;
  /** AAOIFI standard referenced */
  readonly aaoifiStandard:     string;
  readonly processingMs:       number;
}

// ── Basel III risk weights for Sukuk (IFSB-7 Table 1) ─────────────────────────
const RISK_WEIGHTS: Record<SukukGrade, number> = {
  INVESTMENT_GRADE: 0.20,  // 20% — qualifying investment-grade
  SUB_INVESTMENT:   1.50,  // 150% — below investment grade
  UNRATED:          0.50,  // 50% — unrated (Sharia-compliant treatment)
};

const CAPITAL_RATIO = 0.08; // 8% Basel III minimum capital ratio

/**
 * Sharia-compliant Sukuk pricing engine.
 * Returns price, yield, duration, and Basel III capital charge.
 */
export class SukukPricer {
  /**
   * Price an Ijara or Murabaha Sukuk.
   *
   * @param input - Sukuk specification.
   * @returns Full pricing result with regulatory capital charge.
   */
  price(input: SukukInput): SukukResult {
    const t0 = performance.now();
    return input.sukukType === 'IJARA'
      ? this._priceIjara(input, t0)
      : this._priceMurabaha(input, t0);
  }

  // ── Private: Ijara pricing ─────────────────────────────────────────────────

  private _priceIjara(input: IjaraSukukInput, t0: number): SukukResult {
    const { faceValue: F, rentalRate: c, frequency: freq,
            tenorYears: T, discountRate: r, grade, currency } = input;

    const periodicCoupon = (c * F) / freq;
    const n = Math.round(T * freq);

    // Dirty price: PV of periodic rentals + PV of principal redemption
    let dirtyPrice = 0;
    for (let i = 1; i <= n; i++) {
      const t = i / freq;
      dirtyPrice += periodicCoupon * Math.exp(-r * t);
    }
    dirtyPrice += F * Math.exp(-r * T);

    // Accrued rental (since last payment date) — simplified: 0 at issuance
    const accruedRental = 0;
    const cleanPrice = dirtyPrice - accruedRental;

    // Profit rate (Newton-Raphson)
    const profitRate = this._solveYield(periodicCoupon, F, freq, n, dirtyPrice);

    // DV01 — bump +1bp
    const priceBump = this._computePrice(periodicCoupon, F, freq, n, r + 0.0001);
    const dv01 = Math.abs(priceBump - dirtyPrice);

    // Modified duration
    let macaulay = 0;
    for (let i = 1; i <= n; i++) {
      const t = i / freq;
      macaulay += t * periodicCoupon * Math.exp(-r * t);
    }
    macaulay = (macaulay + T * F * Math.exp(-r * T)) / dirtyPrice;
    const modifiedDuration = macaulay / (1 + profitRate / freq);

    // Basel III risk weight and capital charge
    const riskWeightPct  = RISK_WEIGHTS[grade] * 100;
    const reguCapitalCharge = dirtyPrice * RISK_WEIGHTS[grade] * CAPITAL_RATIO;

    return {
      dirtyPrice:        parseFloat(dirtyPrice.toFixed(4)),
      cleanPrice:        parseFloat(cleanPrice.toFixed(4)),
      profitRate:        parseFloat(profitRate.toFixed(6)),
      dv01:               parseFloat(dv01.toFixed(4)),
      modifiedDuration:   parseFloat(modifiedDuration.toFixed(4)),
      riskWeightPct,
      reguCapitalCharge:  parseFloat(reguCapitalCharge.toFixed(2)),
      shariaNote:         'Ijara (lease): rental payments are ujrah, not riba. AAOIFI FAS 28 compliant.',
      aaoifiStandard:     'AAOIFI Sharia Standard 9 (Ijara)',
      processingMs:       parseFloat((performance.now() - t0).toFixed(2)),
    };
  }

  // ── Private: Murabaha pricing ──────────────────────────────────────────────

  private _priceMurabaha(input: MurabahaSukukInput, t0: number): SukukResult {
    const { faceValue: F, ribhRate: ribh, tenorYears: T,
            discountRate: r, grade } = input;

    // Murabaha terminal value = principal + simple profit (AAOIFI Standard 17: no compounding)
    const totalProfit = F * ribh * T;
    const terminalValue = F + totalProfit;

    // Current dirty price = PV of terminal value
    const dirtyPrice  = terminalValue * Math.exp(-r * T);
    const cleanPrice  = dirtyPrice;

    // Effective annualised profit rate (equivalent yield)
    const profitRate = (terminalValue / dirtyPrice - 1) / T;

    // DV01
    const priceBump = terminalValue * Math.exp(-(r + 0.0001) * T);
    const dv01 = Math.abs(priceBump - dirtyPrice);

    const modifiedDuration = T * (terminalValue * Math.exp(-r * T)) / dirtyPrice;
    const riskWeightPct = RISK_WEIGHTS[grade] * 100;
    const reguCapitalCharge = dirtyPrice * RISK_WEIGHTS[grade] * CAPITAL_RATIO;

    return {
      dirtyPrice:        parseFloat(dirtyPrice.toFixed(4)),
      cleanPrice:        parseFloat(cleanPrice.toFixed(4)),
      profitRate:        parseFloat(profitRate.toFixed(6)),
      dv01:               parseFloat(dv01.toFixed(4)),
      modifiedDuration:   parseFloat(modifiedDuration.toFixed(4)),
      riskWeightPct,
      reguCapitalCharge:  parseFloat(reguCapitalCharge.toFixed(2)),
      shariaNote:         'Murabaha: single profit payment at maturity. Simple profit only — no compounding (AAOIFI Standard 17).',
      aaoifiStandard:     'AAOIFI Sharia Standard 17 (Murabaha)',
      processingMs:       parseFloat((performance.now() - t0).toFixed(2)),
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private _computePrice(coupon: number, face: number, freq: number, n: number, r: number): number {
    let p = 0;
    for (let i = 1; i <= n; i++) p += coupon * Math.exp(-r * i / freq);
    return p + face * Math.exp(-r * n / freq);
  }

  private _solveYield(coupon: number, face: number, freq: number, n: number, price: number): number {
    let y = coupon * freq / face; // initial guess = running yield
    for (let i = 0; i < 200; i++) {
      const p  = this._computePrice(coupon, face, freq, n, y);
      // Analytical derivative: d(price)/dy (negative — price falls as yield rises)
      const dp = this._computePrice(coupon, face, freq, n, y + 0.0001) - p;
      const diff = p - price;
      if (Math.abs(diff) < 1e-6) break;
      if (Math.abs(dp) < 1e-14) break;
      y -= diff / (dp / 0.0001); // Newton step: y -= f(y)/f'(y)
      y = Math.max(0.0001, Math.min(0.99, y)); // cap at 99% yield
    }
    return y;
  }
}
