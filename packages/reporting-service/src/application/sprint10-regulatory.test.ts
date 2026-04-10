import { describe, it, expect } from 'vitest';
import { COREPEngine, type COREPInput } from './corep-engine.js';
import { FINREPEngine, type FinrepBalanceSheetInput, type FinrepPLInput } from './finrep-engine.js';

const COREP_INPUT: COREPInput = {
  tenantId: 'bank-001',
  reportingDate: '2026-04-09',
  currency: 'USD',
  cet1Gross: 800_000_000,
  at1Capital: 100_000_000,
  tier2Capital: 200_000_000,
  creditRiskExposures: [
    {
      exposureClass: 'CORPORATE',
      grossExposure: 3_000_000_000,
      crmCredit: 200_000_000,
      riskWeightPct: 100,
    },
    {
      exposureClass: 'RETAIL',
      grossExposure: 1_000_000_000,
      crmCredit: 50_000_000,
      riskWeightPct: 75,
    },
    { exposureClass: 'SOVEREIGN', grossExposure: 500_000_000, crmCredit: 0, riskWeightPct: 0 },
  ],
  marketRiskPositions: [
    { riskClass: 'FX', grossSensitivity: 50_000_000, riskWeight: 0.04 },
    { riskClass: 'IR', grossSensitivity: 30_000_000, riskWeight: 0.015 },
  ],
  opRisk: { avgGrossIncome: 200_000_000, bicMultiplier: 0.15, lossComponent: 10_000_000 },
  ccybRate: 0.01,
  gsibSurcharge: 0.005,
  srepAddOn: 0.005,
};

const BS_INPUT: FinrepBalanceSheetInput = {
  tenantId: 'bank-001',
  reportingDate: '2026-04-09',
  currency: 'USD',
  loansAMC: 4_000_000_000,
  loansNonPerform: 200_000_000,
  sukukFVOCI: 500_000_000,
  derivativesFVPL: 100_000_000,
  cashEquivalents: 300_000_000,
  otherAssets: 100_000_000,
  deposits: 4_000_000_000,
  subordinatedDebt: 300_000_000,
  otherLiabilities: 200_000_000,
  cet1Capital: 400_000_000,
  retainedEarnings: 200_000_000,
  otherEquity: 100_000_000,
};
const PL_INPUT: FinrepPLInput = {
  tenantId: 'bank-001',
  period: '2026-Q1',
  currency: 'USD',
  netInterestIncome: 100_000_000,
  feeIncome: 20_000_000,
  tradingIncome: 15_000_000,
  eclCharges: 10_000_000,
  operatingExpenses: 60_000_000,
  taxRate: 0.25,
};

// ── COREP ──────────────────────────────────────────────────────────────────────
describe('COREPEngine — Sprint 10.1 (CRD V / CRR III)', () => {
  const engine = new COREPEngine();

  it('totalRWA = creditRisk + marketRisk + opRisk', () => {
    const r = engine.generate(COREP_INPUT);
    expect(Math.abs(r.totalRWA - (r.creditRiskRWA + r.marketRiskRWA + r.opRiskRWA))).toBeLessThan(
      1,
    );
  });

  it('CET1 ratio = CET1 / totalRWA × 100', () => {
    const r = engine.generate(COREP_INPUT);
    expect(Math.abs(r.cet1RatioPct - (r.cet1Capital / r.totalRWA) * 100)).toBeLessThan(0.01);
  });

  it('total capital ratio >= CET1 ratio', () => {
    const r = engine.generate(COREP_INPUT);
    expect(r.totalCapRatioPct).toBeGreaterThanOrEqual(r.cet1RatioPct);
  });

  it('zero-risk-weight sovereign gives 0 credit RWA contribution', () => {
    const single: COREPInput = {
      ...COREP_INPUT,
      creditRiskExposures: [
        {
          exposureClass: 'SOVEREIGN',
          grossExposure: 1_000_000_000,
          crmCredit: 0,
          riskWeightPct: 0,
        },
      ],
    };
    const r = engine.generate(single);
    expect(r.creditRiskRWA).toBe(0);
  });

  it('CRM reduces credit RWA', () => {
    const withCRM: COREPInput = {
      ...COREP_INPUT,
      creditRiskExposures: [
        { exposureClass: 'CORP', grossExposure: 1e9, crmCredit: 200e6, riskWeightPct: 100 },
      ],
    };
    const withoutCRM: COREPInput = {
      ...COREP_INPUT,
      creditRiskExposures: [
        { exposureClass: 'CORP', grossExposure: 1e9, crmCredit: 0, riskWeightPct: 100 },
      ],
    };
    expect(engine.generate(withCRM).creditRiskRWA).toBeLessThan(
      engine.generate(withoutCRM).creditRiskRWA,
    );
  });

  it('combined buffer includes conservation buffer + CCyB + G-SIB + SREP', () => {
    const r = engine.generate(COREP_INPUT);
    const expected = (0.025 + 0.01 + 0.005 + 0.005) * 100;
    expect(Math.abs(r.combinedBufferPct - expected)).toBeLessThan(0.01);
  });

  it('XBRL template is set', () => {
    const r = engine.generate(COREP_INPUT);
    expect(r.xbrlTemplate).toContain('COREP');
  });

  it('well-capitalised bank is compliant', () => {
    const r = engine.generate(COREP_INPUT);
    expect(r.isCompliant).toBe(r.totalCapRatioPct >= r.overallMinimumPct);
  });
});

// ── FINREP ─────────────────────────────────────────────────────────────────────
describe('FINREPEngine — Sprint 10.2 (EBA FINREP Taxonomy v3.3)', () => {
  const engine = new FINREPEngine();

  it('totalAssets = sum of all asset components', () => {
    const r = engine.generateReport(BS_INPUT, PL_INPUT);
    const expected =
      BS_INPUT.loansAMC +
      BS_INPUT.loansNonPerform +
      BS_INPUT.sukukFVOCI +
      BS_INPUT.derivativesFVPL +
      BS_INPUT.cashEquivalents +
      BS_INPUT.otherAssets;
    expect(Math.abs(r.totalAssets - expected)).toBeLessThan(1);
  });

  it('net profit > 0 for profitable bank', () => {
    const r = engine.generateReport(BS_INPUT, PL_INPUT);
    expect(r.netProfit).toBeGreaterThan(0);
  });

  it('NPL ratio = nonPerform / totalLoans × 100', () => {
    const r = engine.generateReport(BS_INPUT, PL_INPUT);
    const expected =
      (BS_INPUT.loansNonPerform / (BS_INPUT.loansAMC + BS_INPUT.loansNonPerform)) * 100;
    expect(Math.abs(r.nplRatioPct - expected)).toBeLessThan(0.01);
  });

  it('cost-to-income ratio in (0, 100)', () => {
    const r = engine.generateReport(BS_INPUT, PL_INPUT);
    expect(r.costToIncomePct).toBeGreaterThan(0);
    expect(r.costToIncomePct).toBeLessThan(100);
  });

  it('ROE > 0 for profitable bank', () => {
    const r = engine.generateReport(BS_INPUT, PL_INPUT);
    expect(r.returnOnEquityPct).toBeGreaterThan(0);
  });

  it('EBA template reference is set', () => {
    const r = engine.generateReport(BS_INPUT, PL_INPUT);
    expect(r.ebaTemplate).toContain('FINREP');
  });
});

// ── Branch coverage additions ──────────────────────────────────────────────────

describe('COREPEngine — branch coverage (zero RWA edge case)', () => {
  const engine = new COREPEngine();

  it('returns 0 ratios when totalRWA is 0', () => {
    const input: COREPInput = {
      ...COREP_INPUT,
      creditRiskExposures: [],
      marketRiskPositions: [],
      opRisk: { avgGrossIncome: 0, bicMultiplier: 0.15, lossComponent: 0 },
    };
    const r = engine.generate(input);
    expect(r.totalRWA).toBe(0);
    expect(r.cet1RatioPct).toBe(0);
    expect(r.totalCapRatioPct).toBe(0);
    expect(r.tier1RatioPct).toBe(0);
  });

  it('non-compliant bank: totalCapPct < overallMinimum', () => {
    const weak: COREPInput = {
      ...COREP_INPUT,
      cet1Gross: 10_000_000,
      at1Capital: 0,
      tier2Capital: 0,
    };
    const r = engine.generate(weak);
    expect(r.isCompliant).toBe(false);
    expect(r.capitalHeadroom).toBeLessThan(0);
  });
});

describe('FINREPEngine — branch coverage (zero loans edge case)', () => {
  const engine = new FINREPEngine();

  it('returns 0 NPL ratio when total loans are 0', () => {
    const bs: FinrepBalanceSheetInput = {
      ...BS_INPUT,
      loansAMC: 0,
      loansNonPerform: 0,
    };
    const r = engine.generateReport(bs, PL_INPUT);
    expect(r.nplRatioPct).toBe(0);
  });

  it('handles zero revenue for cost-to-income ratio', () => {
    const zeroPL: FinrepPLInput = {
      ...PL_INPUT,
      netInterestIncome: 0,
      feeIncome: 0,
      tradingIncome: 0,
    };
    const r = engine.generateReport(BS_INPUT, zeroPL);
    expect(r.costToIncomePct).toBe(0);
  });
});
