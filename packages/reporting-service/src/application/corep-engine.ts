/**
 * @module COREPEngine
 * @description COREP Capital Adequacy Reporting — Sprint 10.1.
 *
 * Implements EBA COREP (Common Reporting) under CRD V / CRR III:
 * - Credit Risk: Standardised Approach (SA) — CRR Art. 107-134
 * - Market Risk: FRTB Standardised Approach (SA) — CRR III
 * - Operational Risk: Standardised Measurement Approach (SMA) — CRR III Art. 315
 * - Capital buffers: CCyB, G-SIB surcharge, SREP add-on
 *
 * @see EBA ITS on Supervisory Reporting (COREP)
 * @see Sprint 10.1
 */

export const RiskClass = {
  CREDIT_RISK_SA: 'CREDIT_RISK_SA',
  MARKET_RISK_FRTB: 'MARKET_RISK_FRTB',
  OP_RISK_SMA: 'OP_RISK_SMA',
} as const;
export type RiskClass = (typeof RiskClass)[keyof typeof RiskClass];

export interface CreditRiskSAInput {
  /** Exposure class (corporates, retail, sovereigns, banks, mortgages, etc.) */
  readonly exposureClass: string;
  /** Gross exposure before CRM */
  readonly grossExposure: number;
  /** Credit Risk Mitigation (guarantees/collateral, post-haircut) */
  readonly crmCredit: number;
  /** Basel III SA risk weight (0-150%) */
  readonly riskWeightPct: number;
}

export interface MarketRiskFRTBInput {
  /** FRTB SA risk class (IR, FX, Credit, Equity, Commodity) */
  readonly riskClass: string;
  readonly grossSensitivity: number;
  /** Risk weight per FRTB SA bucket */
  readonly riskWeight: number;
}

export interface OpRiskSMAInput {
  /** Average annual gross income (3-year average) */
  readonly avgGrossIncome: number;
  /** BIC component multiplier (0.12 / 0.15 / 0.18 by size tier) */
  readonly bicMultiplier: number;
  /** Loss component (internal loss data × 15x multiplier) */
  readonly lossComponent: number;
}

export interface COREPInput {
  readonly tenantId: string;
  readonly reportingDate: string;
  readonly currency: string;
  /** CET1 before Pillar 1 deductions */
  readonly cet1Gross: number;
  readonly at1Capital: number;
  readonly tier2Capital: number;
  readonly creditRiskExposures: CreditRiskSAInput[];
  readonly marketRiskPositions: MarketRiskFRTBInput[];
  readonly opRisk: OpRiskSMAInput;
  readonly ccybRate: number;
  readonly gsibSurcharge: number;
  readonly srepAddOn: number;
}

export interface COREPReport {
  readonly tenantId: string;
  readonly reportingDate: string;
  readonly currency: string;
  readonly cet1Capital: number;
  readonly totalCapital: number;
  readonly creditRiskRWA: number;
  readonly marketRiskRWA: number;
  readonly opRiskRWA: number;
  readonly totalRWA: number;
  readonly cet1RatioPct: number;
  readonly tier1RatioPct: number;
  readonly totalCapRatioPct: number;
  readonly pillar1Minimum: number; // 8% of RWA
  readonly combinedBufferPct: number; // CCyB + G-SIB + SREP
  readonly overallMinimumPct: number; // 8% + buffers
  readonly isCompliant: boolean;
  readonly capitalHeadroom: number;
  readonly xbrlTemplate: string; // COREP C 01.00 reference
  readonly generatedAt: string;
}

export class COREPEngine {
  generate(input: COREPInput): COREPReport {
    // Credit Risk RWA
    const crRWA = input.creditRiskExposures.reduce((sum, e) => {
      const net = Math.max(0, e.grossExposure - e.crmCredit);
      return sum + net * (e.riskWeightPct / 100);
    }, 0);

    // Market Risk RWA (FRTB SA: sensitivity × risk weight × 12.5 scalar)
    const mrRWA = input.marketRiskPositions.reduce(
      (sum, p) => sum + Math.abs(p.grossSensitivity) * p.riskWeight * 12.5,
      0,
    );

    // Op Risk RWA (SMA: BIC × BIC multiplier + loss component × 12.5)
    const bic = input.opRisk.avgGrossIncome * input.opRisk.bicMultiplier;
    const orRWA = (bic + input.opRisk.lossComponent) * 12.5;

    const totalRWA = crRWA + mrRWA + orRWA;
    const cet1 = input.cet1Gross;
    const tier1 = cet1 + input.at1Capital;
    const totalCap = tier1 + input.tier2Capital;

    const cet1Pct = totalRWA > 0 ? (cet1 / totalRWA) * 100 : 0;
    const tier1Pct = totalRWA > 0 ? (tier1 / totalRWA) * 100 : 0;
    const totalCapPct = totalRWA > 0 ? (totalCap / totalRWA) * 100 : 0;

    const p1Min = 8.0; // 8% Pillar 1 minimum
    const combinedBuf = (input.ccybRate + input.gsibSurcharge + input.srepAddOn + 0.025) * 100; // +conservation buffer
    const overallMin = p1Min + combinedBuf;
    const headroom = totalCapPct - overallMin;

    return {
      tenantId: input.tenantId,
      reportingDate: input.reportingDate,
      currency: input.currency,
      cet1Capital: parseFloat(cet1.toFixed(2)),
      totalCapital: parseFloat(totalCap.toFixed(2)),
      creditRiskRWA: parseFloat(crRWA.toFixed(2)),
      marketRiskRWA: parseFloat(mrRWA.toFixed(2)),
      opRiskRWA: parseFloat(orRWA.toFixed(2)),
      totalRWA: parseFloat(totalRWA.toFixed(2)),
      cet1RatioPct: parseFloat(cet1Pct.toFixed(4)),
      tier1RatioPct: parseFloat(tier1Pct.toFixed(4)),
      totalCapRatioPct: parseFloat(totalCapPct.toFixed(4)),
      pillar1Minimum: p1Min,
      combinedBufferPct: parseFloat(combinedBuf.toFixed(4)),
      overallMinimumPct: parseFloat(overallMin.toFixed(4)),
      isCompliant: totalCapPct >= overallMin,
      capitalHeadroom: parseFloat(headroom.toFixed(4)),
      xbrlTemplate: 'COREP C 01.00 — Own funds (CRR III)',
      generatedAt: new Date().toISOString(),
    };
  }
}
