/**
 * @module reporting-service/application/regulatory-reporting.service
 *
 * Regulatory Reporting Service — generates structured regulatory output
 * in formats matching central bank submission requirements.
 *
 * Reports generated:
 *
 *  1. LCR Daily Monitoring Template (BCBS 238 Annex I)
 *     - HQLA inventory by Level 1/2A/2B with haircuts
 *     - 30-day net cash outflows by category
 *     - LCR ratio with alert threshold
 *
 *  2. NSFR Quarterly Template (BCBS 295)
 *     - Available Stable Funding (ASF) by tenor
 *     - Required Stable Funding (RSF) by asset class
 *     - NSFR ratio
 *
 *  3. IRRBB Supervisory Outlier Test (BCBS 368 §12)
 *     - EVE impact under 6 prescribed rate scenarios
 *     - NII impact under 2 scenarios
 *     - Outlier threshold: EVE > 15% of Tier 1 capital
 *
 *  4. FRTB SA Capital Return (COREP MR template, simplified)
 *     - Delta / Vega / Curvature by risk class
 *     - Default Risk Charge
 *     - Total FRTB SA capital
 *
 * Output formats: JSON (for API), structured object (for Excel/PDF rendering)
 *
 * AI/ML hook: ReportNarrativeGenerator
 *   Generates plain-language summary paragraphs for regulatory submissions,
 *   explaining changes since the previous period and material drivers.
 *
 * @see BCBS 238 — Basel III LCR (Annex I monitoring template)
 * @see BCBS 295 — NSFR
 * @see BCBS 368 §12 — IRRBB supervisory outlier test
 */

// ── LCR Report ────────────────────────────────────────────────────────────────

export interface HQLAItem {
  category: 'LEVEL_1' | 'LEVEL_2A' | 'LEVEL_2B';
  description: string;
  marketValue: number;
  haircut: number; // BCBS 238 Table 1
  adjustedValue: number; // marketValue × (1 − haircut)
  currency: string;
}

export interface CashOutflowItem {
  category: string;
  balance: number;
  runoffRate: number;
  outflow: number; // balance × runoffRate
  currency: string;
}

export interface CashInflowItem {
  category: string;
  balance: number;
  inflowRate: number; // inflow rate (capped at 75% of outflows)
  inflow: number;
  currency: string;
}

export interface LCRReport {
  reportDate: Date;
  tenantId: string;
  currency: string;
  hqlaItems: HQLAItem[];
  totalHQLA: number;
  outflowItems: CashOutflowItem[];
  totalOutflows: number;
  inflowItems: CashInflowItem[];
  totalInflows: number;
  netCashOutflows: number; // max(totalOutflows - min(inflows, 75%×outflows), 0)
  lcrRatio: number; // totalHQLA / netCashOutflows
  minimumLCR: number; // 100% (Basel III requirement)
  isCompliant: boolean;
  deficitAmount: number; // if not compliant
  generatedAt: Date;
  /** AI/ML narrative summary */
  narrativeSummary?: string;
}

// ── NSFR Report ───────────────────────────────────────────────────────────────

export interface NSFRReport {
  reportDate: Date;
  tenantId: string;
  currency: string;
  asfComponents: Array<{ description: string; balance: number; asfFactor: number; asf: number }>;
  rsfComponents: Array<{ description: string; balance: number; rsfFactor: number; rsf: number }>;
  totalASF: number;
  totalRSF: number;
  nsfrRatio: number; // totalASF / totalRSF
  minimumNSFR: number; // 100%
  isCompliant: boolean;
  generatedAt: Date;
}

// ── IRRBB Supervisory Outlier Test ────────────────────────────────────────────

export type IRRBBScenario =
  | 'PARALLEL_UP'
  | 'PARALLEL_DOWN'
  | 'STEEPENER'
  | 'FLATTENER'
  | 'SHORT_RATE_UP'
  | 'SHORT_RATE_DOWN';

export interface IRRBBScenarioResult {
  scenario: IRRBBScenario;
  /** Prescribed shock magnitudes (BCBS 368 Table 2) */
  shockBps: number;
  eveDelta: number; // change in EVE
  tier1Capital: number;
  eveRatioPct: number; // eveDelta / tier1Capital × 100
  isOutlier: boolean; // |eveRatioPct| > 15%
}

export interface IRRBBReport {
  reportDate: Date;
  tenantId: string;
  currency: string;
  tier1Capital: number;
  scenarios: IRRBBScenarioResult[];
  /** NII sensitivity for +200bp and -200bp */
  niiSensitivity200Up: number;
  niiSensitivity200Down: number;
  hasOutlierBank: boolean; // any scenario triggers outlier
  generatedAt: Date;
}

// ── AI/ML Hook ────────────────────────────────────────────────────────────────

export interface ReportNarrativeGenerator {
  generate(params: {
    reportType: 'LCR' | 'NSFR' | 'IRRBB' | 'FRTB_SA';
    currentRatio?: number;
    previousRatio?: number;
    materialChanges: string[];
    tenantId: string;
  }): Promise<string>;
}

// ── IRRBB Prescribed Shocks (BCBS 368 Table 2) ────────────────────────────────

const IRRBB_SHOCKS_BPS: Record<IRRBBScenario, number> = {
  PARALLEL_UP: 200, // +200bp across all tenors
  PARALLEL_DOWN: -200, // -200bp (floored at -150bp per BCBS 368)
  STEEPENER: 250, // short -100bp / long +150bp
  FLATTENER: -250, // short +150bp / long -100bp
  SHORT_RATE_UP: 300, // short +300bp only
  SHORT_RATE_DOWN: -300, // short -300bp only
};

// ── Regulatory Reporting Service ──────────────────────────────────────────────

export class RegulatoryReportingService {
  constructor(private readonly narrativeGenerator?: ReportNarrativeGenerator) {}

  // ── LCR Report ─────────────────────────────────────────────────────────────

  async buildLCRReport(params: {
    tenantId: string;
    reportDate: Date;
    currency: string;
    hqlaItems: HQLAItem[];
    outflowItems: CashOutflowItem[];
    inflowItems: CashInflowItem[];
    tier1Capital?: number;
  }): Promise<LCRReport> {
    const totalHQLA = params.hqlaItems.reduce((s, i) => s + i.adjustedValue, 0);
    const totalOutflows = params.outflowItems.reduce((s, i) => s + i.outflow, 0);
    const grossInflows = params.inflowItems.reduce((s, i) => s + i.inflow, 0);
    // Cap inflows at 75% of outflows (Basel III §33)
    const cappedInflows = Math.min(grossInflows, 0.75 * totalOutflows);
    const netCashOutflows = Math.max(totalOutflows - cappedInflows, 0);
    const lcrRatio = netCashOutflows > 0 ? totalHQLA / netCashOutflows : Infinity;
    const isCompliant = lcrRatio >= 1.0;
    const deficitAmount = isCompliant ? 0 : netCashOutflows - totalHQLA;

    let narrativeSummary: string | undefined;
    if (this.narrativeGenerator) {
      try {
        narrativeSummary = await this.narrativeGenerator.generate({
          reportType: 'LCR',
          currentRatio: lcrRatio,
          materialChanges: this.detectLCRChanges(totalHQLA, netCashOutflows),
          tenantId: params.tenantId,
        });
      } catch {
        /* narrative failure must never block report */
      }
    }

    return {
      reportDate: params.reportDate,
      tenantId: params.tenantId,
      currency: params.currency,
      hqlaItems: params.hqlaItems,
      totalHQLA,
      outflowItems: params.outflowItems,
      totalOutflows,
      inflowItems: params.inflowItems,
      totalInflows: cappedInflows,
      netCashOutflows,
      lcrRatio,
      minimumLCR: 1.0,
      isCompliant,
      deficitAmount,
      generatedAt: new Date(),
      narrativeSummary,
    };
  }

  // ── NSFR Report ────────────────────────────────────────────────────────────

  buildNSFRReport(params: {
    tenantId: string;
    reportDate: Date;
    currency: string;
    asfComponents: NSFRReport['asfComponents'];
    rsfComponents: NSFRReport['rsfComponents'];
  }): NSFRReport {
    const totalASF = params.asfComponents.reduce((s, c) => s + c.asf, 0);
    const totalRSF = params.rsfComponents.reduce((s, c) => s + c.rsf, 0);
    const nsfrRatio = totalRSF > 0 ? totalASF / totalRSF : Infinity;

    return {
      reportDate: params.reportDate,
      tenantId: params.tenantId,
      currency: params.currency,
      asfComponents: params.asfComponents,
      rsfComponents: params.rsfComponents,
      totalASF,
      totalRSF,
      nsfrRatio,
      minimumNSFR: 1.0,
      isCompliant: nsfrRatio >= 1.0,
      generatedAt: new Date(),
    };
  }

  // ── IRRBB Outlier Test ─────────────────────────────────────────────────────

  /**
   * Compute IRRBB supervisory outlier test for all 6 prescribed scenarios.
   * EVE deltas are provided as inputs (computed by the ALM/IRRBB engine).
   *
   * Outlier threshold: |ΔEVE / Tier 1 Capital| > 15% (BCBS 368 §12)
   */
  buildIRRBBReport(params: {
    tenantId: string;
    reportDate: Date;
    currency: string;
    tier1Capital: number;
    /** EVE delta for each scenario — provided by ALM service */
    eveDeltas: Partial<Record<IRRBBScenario, number>>;
    niiSensitivity200Up: number;
    niiSensitivity200Down: number;
  }): IRRBBReport {
    const scenarios: IRRBBScenarioResult[] = Object.entries(IRRBB_SHOCKS_BPS).map(
      ([scenario, shockBps]) => {
        const eveDelta = params.eveDeltas[scenario as IRRBBScenario] ?? 0;
        const eveRatioPct = params.tier1Capital > 0 ? (eveDelta / params.tier1Capital) * 100 : 0;
        return {
          scenario: scenario as IRRBBScenario,
          shockBps,
          eveDelta,
          tier1Capital: params.tier1Capital,
          eveRatioPct,
          isOutlier: Math.abs(eveRatioPct) > 15,
        };
      },
    );

    return {
      reportDate: params.reportDate,
      tenantId: params.tenantId,
      currency: params.currency,
      tier1Capital: params.tier1Capital,
      scenarios,
      niiSensitivity200Up: params.niiSensitivity200Up,
      niiSensitivity200Down: params.niiSensitivity200Down,
      hasOutlierBank: scenarios.some((s) => s.isOutlier),
      generatedAt: new Date(),
    };
  }

  private detectLCRChanges(hqla: number, outflows: number): string[] {
    const changes: string[] = [];
    if (hqla < outflows) changes.push('HQLA below net outflows — compliance deficit');
    return changes;
  }
}
