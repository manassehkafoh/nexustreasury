/**
 * @module accounting-service/application/ecl-calculator
 *
 * Expected Credit Loss (ECL) Calculator — IFRS 9 §5.5 implementation.
 *
 * ECL = PD × LGD × EAD × DiscountFactor
 *
 * Where:
 *  PD  = Probability of Default (forward-looking, lifetime or 12-month)
 *  LGD = Loss Given Default (1 – recovery rate)
 *  EAD = Exposure At Default (outstanding principal + accrued interest)
 *  DF  = Discount factor back to reporting date (at effective interest rate)
 *
 * Stage assignment rules (SICR = Significant Increase in Credit Risk):
 *  Stage 1: Performing       → 12-month ECL  (PD for next 12 months)
 *  Stage 2: Underperforming  → Lifetime ECL  (SICR triggered — see SICR tests)
 *  Stage 3: Non-performing   → Lifetime ECL  (credit-impaired — objective evidence)
 *
 * SICR triggers (bank-configurable):
 *  - Internal rating deterioration by ≥ 2 notches from origination
 *  - Days past due > 30 (rebuttable presumption at 30 DPD per IFRS 9 §5.5.11)
 *  - Watch-list or early warning indicator (EWI) triggered
 *  - External rating below investment grade (< BBB-)
 *
 * AI/ML hook: PDModelAdapter — replaces the simplified PD table with a
 * machine-learning PD model (XGBoost, logistic regression, neural network)
 * that incorporates forward-looking macro-economic scenarios (GDP, rates,
 * unemployment) per IFRS 9 §5.5.17(c).
 *
 * @see IFRS 9 §§ 5.5.1–5.5.20 — Impairment
 * @see IFRS 9 §§ B5.5.1–B5.5.55 — Application guidance
 */

import { ECLStage } from '../domain/value-objects.js';

// ── Input / Output ────────────────────────────────────────────────────────────

export interface ECLInput {
  /** Unique instrument / position identifier */
  instrumentId: string;
  /** Origination date — used for lifetime PD horizon */
  originationDate: Date;
  /** Reporting / measurement date */
  reportingDate: Date;
  /** Outstanding principal (EAD base) */
  outstandingPrincipal: number;
  currency: string;
  /** Accrued interest (included in EAD) */
  accruedInterest: number;
  /** Internal credit rating at origination (e.g. 'AAA', 'BBB+', 'BB-') */
  originationRating: string;
  /** Current internal credit rating */
  currentRating: string;
  /** Days past due at reporting date */
  daysPastDue: number;
  /** Whether instrument is on the bank's watch-list */
  onWatchList: boolean;
  /** Effective interest rate (for discounting ECL back to reporting date) */
  effectiveInterestRate: number;
  /** Expected recovery rate (0–1), e.g. 0.4 for senior unsecured */
  recoveryRate: number;
  /** Override stage if determined externally (e.g. by credit committee) */
  stageOverride?: ECLStage;
}

export interface ECLResult {
  instrumentId: string;
  stage: ECLStage;
  pd12Month: number; // 12-month PD
  pdLifetime: number; // lifetime PD (tenor-adjusted)
  lgd: number; // 1 – recoveryRate
  ead: number; // EAD = principal + accrued
  ecl: number; // final ECL amount
  currency: string;
  rationale: string;
  sicrTriggered: boolean;
  /** AI/ML model used, if applicable */
  modelVersion?: string;
}

// ── AI/ML PD Model Hook ────────────────────────────────────────────────────────

/**
 * Pluggable PD model interface. Implement this to replace the default
 * credit-rating lookup table with a machine-learning PD predictor.
 *
 * Forward-looking macro scenarios should be incorporated per IFRS 9 §5.5.17(c):
 * ECL = Σ probability_i × ECL_scenario_i (base / optimistic / adverse)
 */
export interface PDModelAdapter {
  /** Predict 12-month and lifetime PD for a given rating and tenor */
  predict(params: {
    currentRating: string;
    tenorYears: number;
    sector?: string;
    region?: string;
  }): Promise<{ pd12Month: number; pdLifetime: number; modelVersion: string }>;
}

// ── SICR Configuration ────────────────────────────────────────────────────────

export interface SICRConfig {
  /** Rating notches deterioration to trigger SICR (default: 2) */
  notchThreshold: number;
  /** Days past due threshold for Stage 2 (default: 30, IFRS 9 rebuttable presumption) */
  dpdThreshold: number;
  /** Days past due threshold for Stage 3 (default: 90) */
  creditImpairedDpd: number;
}

const DEFAULT_SICR_CONFIG: SICRConfig = {
  notchThreshold: 2,
  dpdThreshold: 30,
  creditImpairedDpd: 90,
};

// ── Simplified PD Table (rating → PD) ────────────────────────────────────────
// Based on Moody's historical average annual default rates (1983–2023)
// Tenants should replace this with their internal PD models via PDModelAdapter

const PD_12M_BY_RATING: Record<string, number> = {
  AAA: 0.0001,
  'AA+': 0.0001,
  AA: 0.0002,
  'AA-': 0.0003,
  'A+': 0.0005,
  A: 0.0007,
  'A-': 0.001,
  'BBB+': 0.002,
  BBB: 0.003,
  'BBB-': 0.005,
  'BB+': 0.01,
  BB: 0.015,
  'BB-': 0.02,
  'B+': 0.04,
  B: 0.06,
  'B-': 0.08,
  CCC: 0.2,
  CC: 0.35,
  C: 0.5,
  D: 1.0,
};

// Credit rating notch order (lowest risk → highest risk)
const RATING_NOTCHES: string[] = [
  'AAA',
  'AA+',
  'AA',
  'AA-',
  'A+',
  'A',
  'A-',
  'BBB+',
  'BBB',
  'BBB-',
  'BB+',
  'BB',
  'BB-',
  'B+',
  'B',
  'B-',
  'CCC',
  'CC',
  'C',
  'D',
];

// ── ECL Calculator ────────────────────────────────────────────────────────────

export class ECLCalculator {
  private readonly pdModel?: PDModelAdapter;
  private readonly sicrConfig: SICRConfig;

  constructor(params?: { pdModel?: PDModelAdapter; sicrConfig?: Partial<SICRConfig> }) {
    this.pdModel = params?.pdModel;
    this.sicrConfig = { ...DEFAULT_SICR_CONFIG, ...(params?.sicrConfig ?? {}) };
  }

  /**
   * Calculate ECL synchronously using the built-in PD table.
   * For ML-enhanced ECL, use calculateAsync().
   */
  calculate(input: ECLInput): ECLResult {
    const stage = this.assignStage(input);
    const ead = input.outstandingPrincipal + input.accruedInterest;
    const lgd = 1 - input.recoveryRate;
    const tenorYrs = this.tenorYears(input.originationDate, input.reportingDate);

    const pd12Month = this.lookup12mPD(input.currentRating);
    const pdLifetime = this.estimateLifetimePD(input.currentRating, tenorYrs);

    const pd = stage === ECLStage.PERFORMING ? pd12Month : pdLifetime;
    const eclRaw = pd * lgd * ead;

    // Discount back to reporting date using effective interest rate
    const df =
      stage === ECLStage.PERFORMING
        ? this.discountFactor(input.effectiveInterestRate, Math.min(tenorYrs, 1.0))
        : this.discountFactor(input.effectiveInterestRate, tenorYrs / 2); // midpoint convention

    const ecl = eclRaw * df;

    return {
      instrumentId: input.instrumentId,
      stage,
      pd12Month,
      pdLifetime,
      lgd,
      ead,
      ecl: Math.max(0, ecl),
      currency: input.currency,
      rationale: this.buildRationale(stage, input),
      sicrTriggered: stage > ECLStage.PERFORMING,
    };
  }

  /** Async variant — uses ML PD model if configured */
  async calculateAsync(input: ECLInput): Promise<ECLResult> {
    if (!this.pdModel) return this.calculate(input);

    const stage = this.assignStage(input);
    const tenorYrs = this.tenorYears(input.originationDate, input.reportingDate);

    const { pd12Month, pdLifetime, modelVersion } = await this.pdModel.predict({
      currentRating: input.currentRating,
      tenorYears: tenorYrs,
    });

    const ead = input.outstandingPrincipal + input.accruedInterest;
    const lgd = 1 - input.recoveryRate;
    const pd = stage === ECLStage.PERFORMING ? pd12Month : pdLifetime;
    const ecl = pd * lgd * ead * this.discountFactor(input.effectiveInterestRate, tenorYrs / 2);

    return {
      instrumentId: input.instrumentId,
      stage,
      pd12Month,
      pdLifetime,
      lgd,
      ead,
      ecl: Math.max(0, ecl),
      currency: input.currency,
      rationale: this.buildRationale(stage, input),
      sicrTriggered: stage > ECLStage.PERFORMING,
      modelVersion,
    };
  }

  // ── Stage Assignment ───────────────────────────────────────────────────────

  /**
   * Assign IFRS 9 ECL stage based on SICR triggers and credit-impairment evidence.
   *
   * Priority order (highest wins):
   *  1. External override (credit committee decision)
   *  2. Stage 3: credit-impaired (DPD ≥ 90 or D-rated)
   *  3. Stage 2: SICR triggered (DPD ≥ 30, rating deterioration ≥ 2 notches, watch-list)
   *  4. Stage 1: performing (no SICR)
   */
  assignStage(input: ECLInput): ECLStage {
    if (input.stageOverride) return input.stageOverride;

    // Stage 3: objective evidence of credit impairment
    if (input.daysPastDue >= this.sicrConfig.creditImpairedDpd || input.currentRating === 'D') {
      return ECLStage.NON_PERFORMING;
    }

    // Stage 2: SICR triggered
    const notchDeterior = this.ratingDeteriorationNotches(
      input.originationRating,
      input.currentRating,
    );

    if (
      input.daysPastDue >= this.sicrConfig.dpdThreshold ||
      notchDeterior >= this.sicrConfig.notchThreshold ||
      input.onWatchList
    ) {
      return ECLStage.UNDERPERFORMING;
    }

    return ECLStage.PERFORMING;
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  private lookup12mPD(rating: string): number {
    const normalised = rating.toUpperCase().replace(' ', '');
    return PD_12M_BY_RATING[normalised] ?? 0.05; // default 5% if rating unknown
  }

  /**
   * Estimate lifetime PD using the "square-root rule" approximation:
   * PD_lifetime ≈ 1 - (1 - PD_annual)^tenor
   */
  private estimateLifetimePD(rating: string, tenorYears: number): number {
    const annualPD = this.lookup12mPD(rating);
    return 1 - Math.pow(1 - annualPD, Math.max(tenorYears, 1));
  }

  private discountFactor(rate: number, years: number): number {
    return Math.exp(-rate * Math.max(years, 0));
  }

  private tenorYears(origination: Date, reporting: Date): number {
    return Math.max(
      (reporting.getTime() - origination.getTime()) / (365.25 * 24 * 3600 * 1000),
      0.0833, // minimum 1 month
    );
  }

  /** Number of rating notches from current to origination (positive = deterioration) */
  private ratingDeteriorationNotches(originRating: string, currentRating: string): number {
    const originIdx = RATING_NOTCHES.indexOf(originRating.toUpperCase());
    const currentIdx = RATING_NOTCHES.indexOf(currentRating.toUpperCase());
    if (originIdx === -1 || currentIdx === -1) return 0;
    return currentIdx - originIdx; // positive = moved towards 'D'
  }

  private buildRationale(stage: ECLStage, input: ECLInput): string {
    if (stage === ECLStage.NON_PERFORMING) {
      if (input.daysPastDue >= this.sicrConfig.creditImpairedDpd) {
        return `Stage 3: Credit-impaired — ${input.daysPastDue} days past due`;
      }
      return `Stage 3: Credit-impaired — D-rated counterparty`;
    }
    if (stage === ECLStage.UNDERPERFORMING) {
      const notches = this.ratingDeteriorationNotches(input.originationRating, input.currentRating);
      if (input.onWatchList) return `Stage 2: SICR — instrument on watch-list`;
      if (input.daysPastDue >= this.sicrConfig.dpdThreshold) {
        return `Stage 2: SICR — ${input.daysPastDue} days past due (threshold: ${this.sicrConfig.dpdThreshold})`;
      }
      return `Stage 2: SICR — rating deterioration ${input.originationRating} → ${input.currentRating} (${notches} notches)`;
    }
    return `Stage 1: Performing — 12-month ECL, rating ${input.currentRating}`;
  }
}
