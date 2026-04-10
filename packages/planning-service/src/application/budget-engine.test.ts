/**
 * @file budget-engine.test.ts
 * @description Sprint 9-A — Financial Planning & Budgeting Engine tests (FIS BSM gap closure).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  BudgetEngine,
  BudgetScenario,
  BudgetStatus,
  BudgetPeriod,
  type BudgetEntry,
} from './budget-engine.js';

const ENTRIES: BudgetEntry[] = [
  {
    businessUnit: 'FX_TRADING',
    period: BudgetPeriod.ANNUAL,
    currency: 'USD',
    targetNII: 5_000_000,
    targetNIM: 0.032,
    nonInterestIncome: 2_000_000,
    opex: 1_500_000,
    rwa: 80_000_000,
    capitalAllocated: 8_000_000,
  },
  {
    businessUnit: 'RETAIL_BANKING',
    period: BudgetPeriod.ANNUAL,
    currency: 'USD',
    targetNII: 12_000_000,
    targetNIM: 0.028,
    nonInterestIncome: 1_000_000,
    opex: 4_000_000,
    rwa: 200_000_000,
    capitalAllocated: 20_000_000,
  },
  {
    businessUnit: 'TREASURY',
    period: BudgetPeriod.ANNUAL,
    currency: 'USD',
    targetNII: 3_000_000,
    targetNIM: 0.025,
    nonInterestIncome: 500_000,
    opex: 800_000,
    rwa: 50_000_000,
    capitalAllocated: 5_000_000,
  },
];

describe('BudgetEngine — Sprint 9-A (FIS BSM gap closure)', () => {
  let engine: BudgetEngine;
  beforeEach(() => {
    engine = new BudgetEngine();
  });

  it('createBudget returns DRAFT plan', () => {
    const p = engine.createBudget({
      tenantId: 'bank-001',
      fiscalYear: 2027,
      scenario: BudgetScenario.BASE,
      entries: ENTRIES,
    });
    expect(p.status).toBe(BudgetStatus.DRAFT);
    expect(p.fiscalYear).toBe(2027);
    expect(p.entries).toHaveLength(3);
  });

  it('budgetId is unique across multiple plans', () => {
    const a = engine.createBudget({
      tenantId: 'bank-001',
      fiscalYear: 2027,
      scenario: BudgetScenario.BASE,
      entries: ENTRIES,
    });
    const b = engine.createBudget({
      tenantId: 'bank-001',
      fiscalYear: 2027,
      scenario: BudgetScenario.STRESS,
      entries: ENTRIES,
    });
    expect(a.budgetId).not.toBe(b.budgetId);
  });

  it('approveBudget transitions status to APPROVED', () => {
    const p = engine.createBudget({
      tenantId: 'bank-001',
      fiscalYear: 2027,
      scenario: BudgetScenario.BASE,
      entries: ENTRIES,
    });
    const approved = engine.approveBudget(p.budgetId, 'cfo@bank.com');
    expect(approved.status).toBe(BudgetStatus.APPROVED);
    expect(approved.approvedBy).toBe('cfo@bank.com');
  });

  it('createReforecast bumps version to 2', () => {
    const p = engine.createBudget({
      tenantId: 'bank-001',
      fiscalYear: 2027,
      scenario: BudgetScenario.BASE,
      entries: ENTRIES,
    });
    const rfc = engine.createReforecast(p.budgetId, ENTRIES);
    expect(rfc.version).toBe(2);
    expect(rfc.budgetId).toContain('RFC2');
  });

  it('generateReport — totalNII is sum of all BU entries', () => {
    const p = engine.createBudget({
      tenantId: 'bank-001',
      fiscalYear: 2027,
      scenario: BudgetScenario.BASE,
      entries: ENTRIES,
    });
    const r = engine.generateReport(p.budgetId);
    expect(r.totalNII).toBeCloseTo(20_000_000, 0);
  });

  it('generateReport — totalRevenue = NII + non-interest income', () => {
    const p = engine.createBudget({
      tenantId: 'bank-001',
      fiscalYear: 2027,
      scenario: BudgetScenario.BASE,
      entries: ENTRIES,
    });
    const r = engine.generateReport(p.budgetId);
    expect(r.totalRevenue).toBeCloseTo(r.totalNII + r.totalNonInterestIncome, 0);
  });

  it('generateReport — cost-to-income ratio in (0,1)', () => {
    const p = engine.createBudget({
      tenantId: 'bank-001',
      fiscalYear: 2027,
      scenario: BudgetScenario.BASE,
      entries: ENTRIES,
    });
    const r = engine.generateReport(p.budgetId);
    expect(r.costToIncomeRatio).toBeGreaterThan(0);
    expect(r.costToIncomeRatio).toBeLessThan(1);
  });

  it('generateReport — byBusinessUnit has 3 BUs', () => {
    const p = engine.createBudget({
      tenantId: 'bank-001',
      fiscalYear: 2027,
      scenario: BudgetScenario.BASE,
      entries: ENTRIES,
    });
    const r = engine.generateReport(p.budgetId);
    expect(r.byBusinessUnit).toHaveLength(3);
  });

  it('each BU RAROC > 0', () => {
    const p = engine.createBudget({
      tenantId: 'bank-001',
      fiscalYear: 2027,
      scenario: BudgetScenario.BASE,
      entries: ENTRIES,
    });
    const r = engine.generateReport(p.budgetId);
    r.byBusinessUnit.forEach((bu) => expect(bu.raroc).toBeGreaterThan(0));
  });

  it('capital share sums to ~100%', () => {
    const p = engine.createBudget({
      tenantId: 'bank-001',
      fiscalYear: 2027,
      scenario: BudgetScenario.BASE,
      entries: ENTRIES,
    });
    const r = engine.generateReport(p.budgetId);
    const total = r.byBusinessUnit.reduce((s, bu) => s + bu.capitalShare, 0);
    expect(Math.abs(total - 100)).toBeLessThan(0.1);
  });

  it('mismatch analysis: NII shock up > 0, down < 0', () => {
    const p = engine.createBudget({
      tenantId: 'bank-001',
      fiscalYear: 2027,
      scenario: BudgetScenario.BASE,
      entries: ENTRIES,
    });
    const r = engine.generateReport(p.budgetId);
    expect(r.misMatchAnalysis.niiShockUp100bps).toBeGreaterThan(0);
    expect(r.misMatchAnalysis.niiShockDown100bps).toBeLessThan(0);
  });

  it('FTP assessment: net margin is negative (cost > credit)', () => {
    const p = engine.createBudget({
      tenantId: 'bank-001',
      fiscalYear: 2027,
      scenario: BudgetScenario.BASE,
      entries: ENTRIES,
    });
    const r = engine.generateReport(p.budgetId);
    expect(r.ftpAssessment.netFTPMarginBps).toBeLessThan(0);
    expect(r.ftpAssessment.recommendation.length).toBeGreaterThan(10);
  });

  it('listPlans returns all plans for tenant', () => {
    engine.createBudget({
      tenantId: 'bank-001',
      fiscalYear: 2027,
      scenario: BudgetScenario.BASE,
      entries: ENTRIES,
    });
    engine.createBudget({
      tenantId: 'bank-001',
      fiscalYear: 2027,
      scenario: BudgetScenario.STRESS,
      entries: ENTRIES,
    });
    engine.createBudget({
      tenantId: 'bank-002',
      fiscalYear: 2027,
      scenario: BudgetScenario.BASE,
      entries: ENTRIES,
    });
    expect(engine.listPlans('bank-001')).toHaveLength(2);
  });

  it('STRESS scenario plan generates higher opex ratio (more conservative)', () => {
    const base = engine.createBudget({
      tenantId: 'bank-001',
      fiscalYear: 2027,
      scenario: BudgetScenario.BASE,
      entries: ENTRIES,
    });
    const stressEntries = ENTRIES.map((e) => ({
      ...e,
      opex: e.opex * 1.2,
      targetNII: e.targetNII * 0.85,
    }));
    const stress = engine.createBudget({
      tenantId: 'bank-001',
      fiscalYear: 2027,
      scenario: BudgetScenario.STRESS,
      entries: stressEntries,
    });
    const rBase = engine.generateReport(base.budgetId);
    const rStress = engine.generateReport(stress.budgetId);
    expect(rStress.costToIncomeRatio).toBeGreaterThan(rBase.costToIncomeRatio);
  });

  it('getPlan returns undefined for unknown ID', () => {
    expect(engine.getPlan('does-not-exist')).toBeUndefined();
  });

  it('targetROE > 0 when capital > 0', () => {
    const p = engine.createBudget({
      tenantId: 'bank-001',
      fiscalYear: 2027,
      scenario: BudgetScenario.BASE,
      entries: ENTRIES,
    });
    const r = engine.generateReport(p.budgetId);
    expect(r.targetROE).toBeGreaterThan(0);
  });

  it('totalNIM is weighted average (positive)', () => {
    const p = engine.createBudget({
      tenantId: 'bank-001',
      fiscalYear: 2027,
      scenario: BudgetScenario.BASE,
      entries: ENTRIES,
    });
    const r = engine.generateReport(p.budgetId);
    expect(r.totalNIM).toBeGreaterThan(0);
  });
});
