/**
 * @module alm-service/application/behavioural-assumptions
 *
 * Behavioural NMD (Non-Maturity Deposit) Modelling.
 *
 * Non-Maturity Deposits have no contractual maturity — they can be
 * withdrawn at any time. However, empirical evidence shows that a
 * "core" portion is stable (behavioural maturity 2–5 years) while
 * a "non-core" (volatile) portion may leave within 30 days.
 *
 * BCBS 368 (IRRBB) and Basel III LCR require banks to model NMD behaviour:
 *
 * Core/Non-Core Split:
 *   core_rate    — % of balance considered behaviorally stable
 *   non_core_rate — remaining (1 - core_rate), liquid within 30 days
 *
 * Repricing Model:
 *   repricing_speed — how quickly NMD rates follow market rates (beta)
 *   repricing_floor — minimum NMD rate (cannot go below 0% in most markets)
 *   repricing_cap   — maximum NMD rate (contractual or competitive ceiling)
 *
 * Prepayment Model (for mortgage-funded deposits):
 *   CPR (Constant Prepayment Rate) — annual prepayment as % of balance
 *   CRR (Conditional Refinancing Rate) — rate-driven refinancing
 *
 * Runoff Rates (LCR):
 *   Basel III Table 2 standard runoff rates:
 *     Retail stable:      3%
 *     Retail less stable: 10%
 *     SME operational:    5%
 *     SME non-operational: 10–20%
 *     Corporate wholesale: 25–40%
 *
 * AI/ML hook: BehaviouralCalibrationModel
 *   Calibrates core/non-core split and repricing beta from:
 *   - Historical deposit balance time series
 *   - Interest rate environment
 *   - Customer segment analytics (digital banking, relationship depth)
 *   Produces scenario-specific assumptions for stress testing.
 *
 * @see BCBS 368 §§ 69–84 — Behavioural assumptions for IRRBB
 * @see BCBS 238 §§ 73–78 — NMD runoff rates for LCR
 * @see BRD BR-T-004 — Behavioural NMD modelling
 */

// ── Product Types ─────────────────────────────────────────────────────────────

export enum NMDProductType {
  RETAIL_CURRENT_ACCOUNT = 'RETAIL_CURRENT',
  RETAIL_SAVINGS = 'RETAIL_SAVINGS',
  SME_CURRENT = 'SME_CURRENT',
  SME_SAVINGS = 'SME_SAVINGS',
  CORPORATE_OPERATIONAL = 'CORPORATE_OPERATIONAL',
  CORPORATE_NON_OPERATIONAL = 'CORPORATE_NON_OPERATIONAL',
  PRIVATE_BANKING = 'PRIVATE_BANKING',
}

// ── Behavioural Assumption Set ────────────────────────────────────────────────

export interface NMDBehaviouralAssumption {
  productType: NMDProductType;
  /** Proportion of balance considered behaviorally stable (0–1) */
  coreRate: number;
  /** Behavioural maturity of core deposits in years (BCBS 368: cap 5Y) */
  coreMaturityYears: number;
  /** Rate sensitivity (beta): 0 = fully insensitive; 1 = passes through fully */
  repricingBeta: number;
  /** Minimum NMD rate regardless of market rates */
  repricingFloor: number;
  /** Maximum NMD rate */
  repricingCap: number;
  /**
   * LCR 30-day runoff rate (Basel III Table 2).
   * Proportion of balance expected to leave within 30 days under stress.
   */
  lcrRunoffRate: number;
  /** NSFR Required Stable Funding factor */
  nsfrRSFFactor: number;
}

// ── Basel III Standard Assumptions (configurable per tenant) ──────────────────

export const BASEL_III_NMD_ASSUMPTIONS: Record<NMDProductType, NMDBehaviouralAssumption> = {
  [NMDProductType.RETAIL_CURRENT_ACCOUNT]: {
    productType: NMDProductType.RETAIL_CURRENT_ACCOUNT,
    coreRate: 0.7,
    coreMaturityYears: 4.5,
    repricingBeta: 0.1,
    repricingFloor: 0.0,
    repricingCap: 0.05,
    lcrRunoffRate: 0.03, // Basel III: stable retail
    nsfrRSFFactor: 0.9,
  },
  [NMDProductType.RETAIL_SAVINGS]: {
    productType: NMDProductType.RETAIL_SAVINGS,
    coreRate: 0.6,
    coreMaturityYears: 3.5,
    repricingBeta: 0.3,
    repricingFloor: 0.0,
    repricingCap: 0.06,
    lcrRunoffRate: 0.1, // less stable retail
    nsfrRSFFactor: 0.9,
  },
  [NMDProductType.SME_CURRENT]: {
    productType: NMDProductType.SME_CURRENT,
    coreRate: 0.55,
    coreMaturityYears: 3.0,
    repricingBeta: 0.2,
    repricingFloor: 0.0,
    repricingCap: 0.05,
    lcrRunoffRate: 0.05, // SME operational deposits
    nsfrRSFFactor: 0.5,
  },
  [NMDProductType.SME_SAVINGS]: {
    productType: NMDProductType.SME_SAVINGS,
    coreRate: 0.4,
    coreMaturityYears: 2.0,
    repricingBeta: 0.4,
    repricingFloor: 0.0,
    repricingCap: 0.06,
    lcrRunoffRate: 0.1,
    nsfrRSFFactor: 0.5,
  },
  [NMDProductType.CORPORATE_OPERATIONAL]: {
    productType: NMDProductType.CORPORATE_OPERATIONAL,
    coreRate: 0.3,
    coreMaturityYears: 1.5,
    repricingBeta: 0.5,
    repricingFloor: 0.0,
    repricingCap: 0.06,
    lcrRunoffRate: 0.25, // corporate operational
    nsfrRSFFactor: 0.5,
  },
  [NMDProductType.CORPORATE_NON_OPERATIONAL]: {
    productType: NMDProductType.CORPORATE_NON_OPERATIONAL,
    coreRate: 0.1,
    coreMaturityYears: 0.5,
    repricingBeta: 0.7,
    repricingFloor: 0.0,
    repricingCap: 0.07,
    lcrRunoffRate: 0.4, // non-operational: high outflow
    nsfrRSFFactor: 0.0,
  },
  [NMDProductType.PRIVATE_BANKING]: {
    productType: NMDProductType.PRIVATE_BANKING,
    coreRate: 0.65,
    coreMaturityYears: 4.0,
    repricingBeta: 0.25,
    repricingFloor: 0.0,
    repricingCap: 0.05,
    lcrRunoffRate: 0.1,
    nsfrRSFFactor: 0.5,
  },
};

// ── NMD Balance Input ─────────────────────────────────────────────────────────

export interface NMDBalance {
  productType: NMDProductType;
  balance: number;
  currency: string;
  /** Current NMD interest rate being paid */
  currentRate: number;
}

// ── NMD Projection Output ─────────────────────────────────────────────────────

export interface NMDProjection {
  productType: NMDProductType;
  totalBalance: number;
  coreBalance: number;
  nonCoreBalance: number;
  /** LCR 30-day outflow from this product */
  lcrOutflow30d: number;
  /** NSFR required stable funding amount */
  nsfrRequired: number;
  /** Repriced NMD rate given a parallel rate shock */
  repricedRate: number;
  /** NII impact of rate shock (annual, in currency units) */
  niiImpact: number;
  /** EVE impact (present value change of the core balance cash flows) */
  eveImpact: number;
  currency: string;
}

// ── AI/ML Calibration Hook ────────────────────────────────────────────────────

export interface BehaviouralCalibrationModel {
  calibrate(params: {
    productType: NMDProductType;
    historicalBalances: Array<{ date: Date; balance: number; marketRate: number }>;
    rateEnvironment: 'LOW_RATE' | 'RISING_RATE' | 'HIGH_RATE' | 'FALLING_RATE';
  }): Promise<Partial<NMDBehaviouralAssumption>>;
}

// ── NMD Modelling Service ─────────────────────────────────────────────────────

export class NMDModellingService {
  /** Tenant-specific assumptions (override Basel III defaults) */
  private readonly assumptions: Record<string, NMDBehaviouralAssumption>;

  constructor(
    tenantOverrides?: Partial<Record<NMDProductType, Partial<NMDBehaviouralAssumption>>>,
    private readonly calibrationModel?: BehaviouralCalibrationModel,
  ) {
    // Merge tenant overrides on top of Basel III defaults
    this.assumptions = Object.fromEntries(
      Object.entries(BASEL_III_NMD_ASSUMPTIONS).map(([key, base]) => [
        key,
        { ...base, ...(tenantOverrides?.[key as NMDProductType] ?? {}) },
      ]),
    );
  }

  /**
   * Project NMD balances for LCR, NSFR, and IRRBB calculations.
   *
   * @param balance     NMD balance and product details
   * @param rateShock   Parallel interest rate shock in decimal (e.g. 0.02 = +200bp)
   */
  project(balance: NMDBalance, rateShock: number = 0): NMDProjection {
    const assumption = this.assumptions[balance.productType];
    if (!assumption) throw new Error(`No assumption set for ${balance.productType}`);

    const coreBalance = balance.balance * assumption.coreRate;
    const nonCoreBalance = balance.balance * (1 - assumption.coreRate);

    // LCR outflow: Basel III 30-day stress
    const lcrOutflow30d = balance.balance * assumption.lcrRunoffRate;

    // NSFR required stable funding
    const nsfrRequired = balance.balance * assumption.nsfrRSFFactor;

    // Repriced NMD rate after shock (beta × shock, clamped to floor/cap)
    const rawRepricedRate = balance.currentRate + assumption.repricingBeta * rateShock;
    const repricedRate = Math.max(
      assumption.repricingFloor,
      Math.min(assumption.repricingCap, rawRepricedRate),
    );

    // NII impact: balance × (repriced - current) — annual income change
    const niiImpact = balance.balance * (repricedRate - balance.currentRate);

    // EVE impact: core balance × duration × rate shock
    // Simple proxy: duration = coreMaturityYears; full EVE uses discounted CF
    const coreDuration = assumption.coreMaturityYears;
    const eveImpact = -(coreBalance * coreDuration * rateShock * assumption.repricingBeta);

    return {
      productType: balance.productType,
      totalBalance: balance.balance,
      coreBalance,
      nonCoreBalance,
      lcrOutflow30d,
      nsfrRequired,
      repricedRate,
      niiImpact,
      eveImpact,
      currency: balance.currency,
    };
  }

  /**
   * Project multiple NMD balances and aggregate LCR/NSFR/NII/EVE totals.
   */
  projectAll(
    balances: NMDBalance[],
    rateShock: number = 0,
  ): {
    projections: NMDProjection[];
    totalLcrOutflow: number;
    totalNsfrRequired: number;
    totalNiiImpact: number;
    totalEveImpact: number;
  } {
    const projections = balances.map((b) => this.project(b, rateShock));
    const totalLcrOutflow = projections.reduce((s, p) => s + p.lcrOutflow30d, 0);
    const totalNsfrRequired = projections.reduce((s, p) => s + p.nsfrRequired, 0);
    const totalNiiImpact = projections.reduce((s, p) => s + p.niiImpact, 0);
    const totalEveImpact = projections.reduce((s, p) => s + p.eveImpact, 0);
    return { projections, totalLcrOutflow, totalNsfrRequired, totalNiiImpact, totalEveImpact };
  }

  /**
   * Async variant — uses AI/ML calibration model to override assumptions
   * before projecting. Useful for stress scenarios where historical
   * behaviour differs from Basel III defaults.
   */
  async projectWithCalibration(
    balance: NMDBalance,
    rateShock: number,
    historicalBalances: Array<{ date: Date; balance: number; marketRate: number }>,
    environment: 'LOW_RATE' | 'RISING_RATE' | 'HIGH_RATE' | 'FALLING_RATE',
  ): Promise<NMDProjection> {
    if (this.calibrationModel) {
      const calibrated = await this.calibrationModel.calibrate({
        productType: balance.productType,
        historicalBalances,
        rateEnvironment: environment,
      });
      // Apply calibrated assumptions temporarily
      const base = this.assumptions[balance.productType]!;
      this.assumptions[balance.productType] = { ...base, ...calibrated };
      const result = this.project(balance, rateShock);
      this.assumptions[balance.productType] = base; // restore
      return result;
    }
    return this.project(balance, rateShock);
  }
}
