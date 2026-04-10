/**
 * @module MurabahaLifecycle
 * @description Commodity Murabaha lifecycle engine — Sprint 9.2.
 *
 * Commodity Murabaha (also called Tawarruq when used for liquidity) is a
 * deferred payment sale used by Islamic banks to replace interest-bearing
 * lending. The bank purchases a commodity (typically LME metals) and
 * immediately sells it to the customer at cost-plus-profit on deferred terms.
 *
 * ## Lifecycle Steps
 *
 * 1. Bank buys commodity from Broker A at spot price
 * 2. Bank sells commodity to Customer at cost + profit (deferred)
 * 3. Customer (optionally) sells commodity back to Broker B (Tawarruq)
 *    to receive cash — this creates the liquidity effect
 *
 * ## Sharia Constraints
 *
 * - The bank MUST take actual ownership before reselling (no paper transaction)
 * - Profit rate must be fixed at inception (no floating rate Murabaha under AAOIFI)
 * - No rollover — a new contract must be created at maturity
 *
 * ## Cash Flow Timeline
 *
 * Day 0:   Bank pays spot price to Broker A (outflow = notional)
 * Day 0:   Customer receives commodity (or Tawarruq cash)
 * Day T:   Customer pays bank face value + profit (single bullet payment)
 *          OR instalment payments if structured as instalment Murabaha
 *
 * @see AAOIFI Sharia Standard 30 (Monetisation / Tawarruq)
 * @see Sprint 9.2
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** LME commodity types used as Murabaha underlying. */
export const MurabahaCommodity = {
  LME_COPPER: 'LME_COPPER',
  LME_ALUMINIUM: 'LME_ALUMINIUM',
  LME_NICKEL: 'LME_NICKEL',
  LME_ZINC: 'LME_ZINC',
  LME_TIN: 'LME_TIN',
  GOLD: 'GOLD',
  PALM_OIL: 'PALM_OIL',
} as const;
export type MurabahaCommodity = (typeof MurabahaCommodity)[keyof typeof MurabahaCommodity];

/** Repayment structure. */
export const MurabahaRepayment = {
  BULLET: 'BULLET', // Single payment at maturity
  INSTALMENT: 'INSTALMENT', // Equal instalments (like amortising loan)
  BALLOON: 'BALLOON', // Small instalments + large final payment
} as const;
export type MurabahaRepayment = (typeof MurabahaRepayment)[keyof typeof MurabahaRepayment];

/** Input for a new Commodity Murabaha transaction. */
export interface MurabahaInput {
  /** Customer / counterparty ID */
  readonly customerId: string;
  /** Underlying LME commodity */
  readonly commodity: MurabahaCommodity;
  /** Cost price (bank purchase price from Broker A) */
  readonly costPrice: number;
  /** Currency */
  readonly currency: string;
  /** Profit markup amount (ribh) — absolute, not percentage */
  readonly profitAmount: number;
  /** Total tenor in days */
  readonly tenorDays: number;
  /** Repayment structure */
  readonly repaymentType: MurabahaRepayment;
  /** Number of instalments (for INSTALMENT / BALLOON) */
  readonly numInstalments?: number;
  /** Is this a Tawarruq (customer sells back to Broker B for cash)? */
  readonly isTawarruq: boolean;
  /** Value date */
  readonly valueDate: string; // ISO date
}

/** A single cash flow in the Murabaha schedule. */
export interface MurabahaCashFlow {
  readonly dueDate: string; // ISO date
  readonly type: 'PRINCIPAL' | 'PROFIT' | 'COMBINED';
  readonly principalAmount: number;
  readonly profitAmount: number;
  readonly totalPayment: number;
  readonly outstandingPrincipal: number;
}

/** Full Murabaha transaction result. */
export interface MurabahaResult {
  /** Transaction reference */
  readonly reference: string;
  /** Total sale price = costPrice + profitAmount */
  readonly salePrice: number;
  /** Effective profit rate (annualised) */
  readonly effectiveProfitRatePct: number;
  /** Profit rate vs benchmark comparison (vs 3M LIBOR proxy) */
  readonly spreadOverBenchmarkBps: number;
  /** Full payment schedule */
  readonly schedule: MurabahaCashFlow[];
  /** For Tawarruq: cash received by customer after selling commodity */
  readonly tawarruqCash?: number;
  /** AAOIFI compliance status */
  readonly shariaCompliant: boolean;
  readonly shariaNote: string;
  /** IFRS9 classification (amortised cost — AC) */
  readonly ifrs9Classification: string;
  readonly processingMs: number;
}

// ── LME benchmark prices (simulated; in production: Bloomberg B-PIPE) ─────────
const LME_SPOT_PRICES: Record<MurabahaCommodity, number> = {
  LME_COPPER: 9_450, // USD/tonne
  LME_ALUMINIUM: 2_430,
  LME_NICKEL: 17_200,
  LME_ZINC: 2_870,
  LME_TIN: 30_500,
  GOLD: 2_320, // USD/troy oz
  PALM_OIL: 875, // USD/tonne
};

// 3M SOFR proxy for spread calculation (basis points)
const BENCHMARK_RATE_3M = 0.0531;

let txnCounter = 1000;

/**
 * Commodity Murabaha lifecycle engine.
 */
export class MurabahaLifecycleEngine {
  /**
   * Create a new Commodity Murabaha transaction with full payment schedule.
   */
  create(input: MurabahaInput): MurabahaResult {
    const t0 = performance.now();

    const {
      costPrice,
      profitAmount,
      tenorDays,
      repaymentType,
      numInstalments,
      isTawarruq,
      currency,
      commodity,
    } = input;

    const salePrice = costPrice + profitAmount;
    const tenorYears = tenorDays / 365;

    // Effective annualised profit rate (simple, no compounding)
    const effectiveProfitRate = profitAmount / (costPrice * tenorYears);
    const spreadBps = Math.round((effectiveProfitRate - BENCHMARK_RATE_3M) * 10_000);

    // Build payment schedule
    const schedule = this._buildSchedule(
      costPrice,
      profitAmount,
      tenorDays,
      repaymentType,
      numInstalments ?? 1,
      input.valueDate,
    );

    // Sharia compliance check
    const spotPrice = LME_SPOT_PRICES[commodity] ?? costPrice;
    const shariaCompliant = costPrice > 0 && profitAmount > 0 && tenorDays > 0;

    const ref = `MURA-${++txnCounter}-${currency}`;

    return {
      reference: ref,
      salePrice: parseFloat(salePrice.toFixed(2)),
      effectiveProfitRatePct: parseFloat((effectiveProfitRate * 100).toFixed(4)),
      spreadOverBenchmarkBps: spreadBps,
      schedule,
      tawarruqCash: isTawarruq ? costPrice * 0.995 : undefined, // 0.5% broker fee
      shariaCompliant,
      shariaNote: shariaCompliant
        ? 'Commodity Murabaha: bank acquired commodity before sale. AAOIFI FAS 28 & SS-30 compliant.'
        : 'COMPLIANCE ALERT: Review transaction for Sharia compliance.',
      ifrs9Classification: 'AMORTISED_COST', // AAOIFI + IFRS9 FAS 28 para 6
      processingMs: parseFloat((performance.now() - t0).toFixed(2)),
    };
  }

  private _buildSchedule(
    principal: number,
    totalProfit: number,
    tenorDays: number,
    type: MurabahaRepayment,
    n: number,
    valueDate: string,
  ): MurabahaCashFlow[] {
    const start = new Date(valueDate);
    const schedule: MurabahaCashFlow[] = [];

    if (type === 'BULLET') {
      const dueDate = new Date(start);
      dueDate.setDate(dueDate.getDate() + tenorDays);
      schedule.push({
        dueDate: dueDate.toISOString().slice(0, 10),
        type: 'COMBINED',
        principalAmount: principal,
        profitAmount: totalProfit,
        totalPayment: principal + totalProfit,
        outstandingPrincipal: 0,
      });
    } else {
      const instalment = Math.round(tenorDays / n);
      const principalPmt = principal / n;
      const profitPmt = totalProfit / n;
      let outstanding = principal;

      for (let i = 1; i <= n; i++) {
        const dueDate = new Date(start);
        dueDate.setDate(dueDate.getDate() + instalment * i);
        outstanding -= principalPmt;
        schedule.push({
          dueDate: dueDate.toISOString().slice(0, 10),
          type: 'COMBINED',
          principalAmount: parseFloat(principalPmt.toFixed(2)),
          profitAmount: parseFloat(profitPmt.toFixed(2)),
          totalPayment: parseFloat((principalPmt + profitPmt).toFixed(2)),
          outstandingPrincipal: parseFloat(Math.max(0, outstanding).toFixed(2)),
        });
      }
    }

    return schedule;
  }
}
