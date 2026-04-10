/**
 * @module FINREPEngine
 * @description FINREP Financial Reporting — Sprint 10.2.
 * Produces EBA FINREP balance sheet and P&L from IFRS9 accounting data.
 * @see Sprint 10.2
 */

export interface FinrepBalanceSheetInput {
  readonly tenantId: string;
  readonly reportingDate: string;
  readonly currency: string;
  /** IFRS9 category: AMC (Amortised Cost), FVOCI, FVPL */
  readonly loansAMC: number;
  readonly loansNonPerform: number;
  readonly sukukFVOCI: number;
  readonly derivativesFVPL: number;
  readonly cashEquivalents: number;
  readonly otherAssets: number;
  readonly deposits: number;
  readonly subordinatedDebt: number;
  readonly otherLiabilities: number;
  readonly cet1Capital: number;
  readonly retainedEarnings: number;
  readonly otherEquity: number;
}

export interface FinrepPLInput {
  readonly tenantId: string;
  readonly period: string;
  readonly currency: string;
  readonly netInterestIncome: number;
  readonly feeIncome: number;
  readonly tradingIncome: number;
  readonly eclCharges: number; // IFRS9 Stage 1+2+3 ECL
  readonly operatingExpenses: number;
  readonly taxRate: number;
}

export interface FinrepReport {
  readonly tenantId: string;
  readonly reportingDate: string;
  readonly currency: string;
  readonly totalAssets: number;
  readonly totalLiabilities: number;
  readonly totalEquity: number;
  readonly nplRatioPct: number; // Non-performing loans ratio
  readonly netProfit: number;
  readonly returnOnAssetsPct: number;
  readonly returnOnEquityPct: number;
  readonly costToIncomePct: number;
  readonly ebaTemplate: string; // FINREP F 01.01 reference
  readonly generatedAt: string;
}

export class FINREPEngine {
  generateReport(bs: FinrepBalanceSheetInput, pl: FinrepPLInput): FinrepReport {
    const totalAssets =
      bs.loansAMC +
      bs.loansNonPerform +
      bs.sukukFVOCI +
      bs.derivativesFVPL +
      bs.cashEquivalents +
      bs.otherAssets;
    const totalLiab = bs.deposits + bs.subordinatedDebt + bs.otherLiabilities;
    const totalEquity = bs.cet1Capital + bs.retainedEarnings + bs.otherEquity;

    const nplRatio =
      bs.loansAMC + bs.loansNonPerform > 0
        ? (bs.loansNonPerform / (bs.loansAMC + bs.loansNonPerform)) * 100
        : 0;

    const revenue = pl.netInterestIncome + pl.feeIncome + pl.tradingIncome;
    const preProvProfit = revenue - pl.operatingExpenses;
    const preTaxProfit = preProvProfit - pl.eclCharges;
    const netProfit = preTaxProfit * (1 - pl.taxRate);

    const roaPct = totalAssets > 0 ? (netProfit / totalAssets) * 100 : 0;
    const roePct = totalEquity > 0 ? (netProfit / totalEquity) * 100 : 0;
    const ctirPct = revenue > 0 ? (pl.operatingExpenses / revenue) * 100 : 0;

    return {
      tenantId: bs.tenantId,
      reportingDate: bs.reportingDate,
      currency: bs.currency,
      totalAssets: parseFloat(totalAssets.toFixed(2)),
      totalLiabilities: parseFloat(totalLiab.toFixed(2)),
      totalEquity: parseFloat(totalEquity.toFixed(2)),
      nplRatioPct: parseFloat(nplRatio.toFixed(4)),
      netProfit: parseFloat(netProfit.toFixed(2)),
      returnOnAssetsPct: parseFloat(roaPct.toFixed(4)),
      returnOnEquityPct: parseFloat(roePct.toFixed(4)),
      costToIncomePct: parseFloat(ctirPct.toFixed(4)),
      ebaTemplate: 'FINREP F 01.01 / F 02.00 — EBA Taxonomy v3.3',
      generatedAt: new Date().toISOString(),
    };
  }
}
