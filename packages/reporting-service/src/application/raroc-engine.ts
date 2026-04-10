/**
 * @module RAROCEngine
 * @description Risk-Adjusted Return on Capital (RAROC) engine — Sprint 9-B.
 *
 * Closes the FIS BSM gap: "Multi-dimensional Profitability Analysis"
 * and "Capital, Cost and Profit Allocations".
 *
 * RAROC = (Revenue - Costs - Expected Loss) / Economic Capital
 *
 * Dimensions supported (matching FIS BSM wheel):
 *  - By business unit (desk, division, subsidiary)
 *  - By customer (relationship-level RAROC)
 *  - By product (instrument type)
 *  - By trader / relationship manager
 *  - By geography / legal entity
 *
 * Economic Capital model: Basel III Pillar 2 ICAAP internal model.
 *   EC = RWA × 8% × (1 + stress_buffer)
 *
 * @see FIS BSM "Capital, Cost and Profit Allocations"
 * @see Sprint 9-B
 */

export const RAROCDimension = {
  BUSINESS_UNIT: 'BUSINESS_UNIT',
  CUSTOMER: 'CUSTOMER',
  PRODUCT: 'PRODUCT',
  TRADER: 'TRADER',
  GEOGRAPHY: 'GEOGRAPHY',
} as const;
export type RAROCDimension = (typeof RAROCDimension)[keyof typeof RAROCDimension];

/** Input record for a single profit/cost contribution. */
export interface RAROCInput {
  readonly entityId: string; // BU, customerId, productCode, etc.
  readonly dimension: RAROCDimension;
  readonly period: string; // 'Q1-2027', 'FY-2027'
  readonly currency: string;
  /** Gross revenue (NII + fees + FX spread) */
  readonly grossRevenue: number;
  /** Direct costs allocated to this entity */
  readonly directCosts: number;
  /** FTP charge (funding cost allocated from treasury) */
  readonly ftpCharge: number;
  /** FTP credit (funding benefit allocated from treasury) */
  readonly ftpCredit: number;
  /** Expected Loss (from IFRS9 ECL calculation) */
  readonly expectedLoss: number;
  /** Risk-Weighted Assets */
  readonly rwa: number;
  /** Capital allocated (could be formula-driven or manually allocated) */
  readonly capitalAllocated: number;
  /** Stress buffer for internal capital model (default 0.25 = 25%) */
  readonly stressBuffer?: number;
}

/** RAROC calculation result for a single dimension entity. */
export interface RAROCResult {
  readonly entityId: string;
  readonly dimension: RAROCDimension;
  readonly period: string;
  readonly currency: string;
  readonly grossRevenue: number;
  readonly totalCosts: number; // directCosts + ftpCharge - ftpCredit
  readonly expectedLoss: number;
  readonly netContribution: number; // grossRevenue - totalCosts - expectedLoss
  readonly economicCapital: number; // RWA × 8% × (1 + stressBuffer)
  readonly raroc: number; // netContribution / economicCapital
  readonly rarocPct: number; // raroc × 100
  readonly hurdleRatePct: number; // minimum acceptable RAROC (10% default)
  readonly isAboveHurdle: boolean;
  readonly returnOnEquityPct: number; // netContribution / capitalAllocated × 100
  readonly costOfCapitalPct: number; // WACC proxy (8% default)
  readonly evaBps: number; // Economic Value Added in bps
  readonly processingMs: number;
}

/** Aggregated multi-dimensional profitability report. */
export interface ProfitabilityReport {
  readonly period: string;
  readonly currency: string;
  readonly totalRevenue: number;
  readonly totalCosts: number;
  readonly totalExpectedLoss: number;
  readonly totalNetContribution: number;
  readonly totalRWA: number;
  readonly totalCapital: number;
  readonly portfolioRAROC: number;
  readonly portfolioRAROCPct: number;
  readonly results: RAROCResult[];
  readonly topPerformers: RAROCResult[]; // top 3 by RAROC
  readonly underperformers: RAROCResult[]; // below hurdle rate
  readonly generatedAt: string;
}

const DEFAULT_HURDLE_RATE = 0.1; // 10% RAROC minimum
const DEFAULT_COST_OF_CAPITAL = 0.08; // 8% WACC proxy
const MIN_CAPITAL_FLOOR = 1.0; // avoid divide-by-zero

export class RAROCEngine {
  private readonly _hurdleRate: number;
  private readonly _costOfCapital: number;

  constructor(config?: { hurdleRatePct?: number; costOfCapitalPct?: number }) {
    this._hurdleRate = (config?.hurdleRatePct ?? 10) / 100;
    this._costOfCapital = (config?.costOfCapitalPct ?? 8) / 100;
  }

  /** Calculate RAROC for a single entity/dimension. */
  calculate(input: RAROCInput): RAROCResult {
    const t0 = performance.now();

    const ftpNet = input.ftpCharge - input.ftpCredit;
    const totalCosts = input.directCosts + ftpNet;
    const netContrib = input.grossRevenue - totalCosts - input.expectedLoss;
    const stressBuffer = input.stressBuffer ?? 0.25;
    const econCapital = Math.max(MIN_CAPITAL_FLOOR, input.rwa * 0.08 * (1 + stressBuffer));
    const raroc = netContrib / econCapital;
    const rarocPct = raroc * 100;
    const roeRaw = input.capitalAllocated > 0 ? netContrib / input.capitalAllocated : 0;
    const evaBps = Math.round((raroc - this._costOfCapital) * 10_000);

    return {
      entityId: input.entityId,
      dimension: input.dimension,
      period: input.period,
      currency: input.currency,
      grossRevenue: parseFloat(input.grossRevenue.toFixed(2)),
      totalCosts: parseFloat(totalCosts.toFixed(2)),
      expectedLoss: parseFloat(input.expectedLoss.toFixed(2)),
      netContribution: parseFloat(netContrib.toFixed(2)),
      economicCapital: parseFloat(econCapital.toFixed(2)),
      raroc: parseFloat(raroc.toFixed(6)),
      rarocPct: parseFloat(rarocPct.toFixed(4)),
      hurdleRatePct: this._hurdleRate * 100,
      isAboveHurdle: raroc >= this._hurdleRate,
      returnOnEquityPct: parseFloat((roeRaw * 100).toFixed(4)),
      costOfCapitalPct: this._costOfCapital * 100,
      evaBps,
      processingMs: parseFloat((performance.now() - t0).toFixed(2)),
    };
  }

  /** Generate a full multi-dimensional profitability report. */
  generateReport(inputs: RAROCInput[]): ProfitabilityReport {
    const results = inputs.map((i) => this.calculate(i));

    const totalRev = results.reduce((s, r) => s + r.grossRevenue, 0);
    const totalCosts = results.reduce((s, r) => s + r.totalCosts, 0);
    const totalEL = results.reduce((s, r) => s + r.expectedLoss, 0);
    const totalNC = results.reduce((s, r) => s + r.netContribution, 0);
    const totalRWA = inputs.reduce((s, i) => s + i.rwa, 0);
    const totalCap = inputs.reduce((s, i) => s + i.capitalAllocated, 0);
    const stressBuffer = inputs[0]?.stressBuffer ?? 0.25;
    const portfolioEC = Math.max(MIN_CAPITAL_FLOOR, totalRWA * 0.08 * (1 + stressBuffer));
    const portfolioRAROC = totalNC / portfolioEC;

    const sorted = [...results].sort((a, b) => b.rarocPct - a.rarocPct);

    return {
      period: inputs[0]?.period ?? 'UNKNOWN',
      currency: inputs[0]?.currency ?? 'USD',
      totalRevenue: parseFloat(totalRev.toFixed(2)),
      totalCosts: parseFloat(totalCosts.toFixed(2)),
      totalExpectedLoss: parseFloat(totalEL.toFixed(2)),
      totalNetContribution: parseFloat(totalNC.toFixed(2)),
      totalRWA: parseFloat(totalRWA.toFixed(2)),
      totalCapital: parseFloat(totalCap.toFixed(2)),
      portfolioRAROC: parseFloat(portfolioRAROC.toFixed(6)),
      portfolioRAROCPct: parseFloat((portfolioRAROC * 100).toFixed(4)),
      results,
      topPerformers: sorted.slice(0, 3),
      underperformers: results.filter((r) => !r.isAboveHurdle),
      generatedAt: new Date().toISOString(),
    };
  }
}
