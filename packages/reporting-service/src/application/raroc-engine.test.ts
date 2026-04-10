/**
 * @file raroc-engine.test.ts
 * @description Sprint 9-B — RAROC / Multi-dimensional Profitability tests (FIS BSM gap closure).
 */
import { describe, it, expect } from 'vitest';
import { RAROCEngine, RAROCDimension, type RAROCInput } from './raroc-engine.js';

const FX_BU: RAROCInput = {
  entityId: 'FX_TRADING',
  dimension: RAROCDimension.BUSINESS_UNIT,
  period: 'FY-2027',
  currency: 'USD',
  grossRevenue: 5_000_000,
  directCosts: 1_200_000,
  ftpCharge: 300_000,
  ftpCredit: 100_000,
  expectedLoss: 50_000,
  rwa: 80_000_000,
  capitalAllocated: 8_000_000,
};
const RETAIL_BU: RAROCInput = {
  entityId: 'RETAIL',
  dimension: RAROCDimension.BUSINESS_UNIT,
  period: 'FY-2027',
  currency: 'USD',
  grossRevenue: 12_000_000,
  directCosts: 4_000_000,
  ftpCharge: 600_000,
  ftpCredit: 200_000,
  expectedLoss: 400_000,
  rwa: 200_000_000,
  capitalAllocated: 20_000_000,
};
const LOW_RAROC: RAROCInput = {
  entityId: 'BAD_DESK',
  dimension: RAROCDimension.BUSINESS_UNIT,
  period: 'FY-2027',
  currency: 'USD',
  grossRevenue: 500_000,
  directCosts: 450_000,
  ftpCharge: 100_000,
  ftpCredit: 0,
  expectedLoss: 200_000,
  rwa: 20_000_000,
  capitalAllocated: 2_000_000,
};

describe('RAROCEngine — Sprint 9-B (FIS BSM profitability gap closure)', () => {
  const engine = new RAROCEngine({ hurdleRatePct: 10, costOfCapitalPct: 8 });

  it('net contribution = revenue - costs - EL', () => {
    const r = engine.calculate(FX_BU);
    const expected = 5_000_000 - (1_200_000 + 300_000 - 100_000) - 50_000;
    expect(Math.abs(r.netContribution - expected)).toBeLessThan(1);
  });

  it('economic capital = RWA × 8% × 1.25 (default 25% stress buffer)', () => {
    const r = engine.calculate(FX_BU);
    expect(r.economicCapital).toBeCloseTo(80_000_000 * 0.08 * 1.25, 0);
  });

  it('RAROC = netContribution / economicCapital', () => {
    const r = engine.calculate(FX_BU);
    expect(Math.abs(r.raroc - r.netContribution / r.economicCapital)).toBeLessThan(0.0001);
  });

  it('profitable BU is above hurdle rate', () => {
    const r = engine.calculate(FX_BU);
    expect(r.isAboveHurdle).toBe(true);
  });

  it('loss-making BU is below hurdle rate', () => {
    const r = engine.calculate(LOW_RAROC);
    expect(r.isAboveHurdle).toBe(false);
  });

  it('EVA bps > 0 for profitable BU', () => {
    const r = engine.calculate(FX_BU);
    expect(r.evaBps).toBeGreaterThan(0);
  });

  it('EVA bps < 0 for loss-making BU', () => {
    const r = engine.calculate(LOW_RAROC);
    expect(r.evaBps).toBeLessThan(0);
  });

  it('ROE % > 0 for profitable BU', () => {
    const r = engine.calculate(FX_BU);
    expect(r.returnOnEquityPct).toBeGreaterThan(0);
  });

  it('hurdle rate is reflected in result', () => {
    const r = engine.calculate(FX_BU);
    expect(r.hurdleRatePct).toBe(10);
  });

  it('generateReport returns results for all inputs', () => {
    const rpt = engine.generateReport([FX_BU, RETAIL_BU, LOW_RAROC]);
    expect(rpt.results).toHaveLength(3);
  });

  it('totalRevenue is sum of all entity revenues', () => {
    const rpt = engine.generateReport([FX_BU, RETAIL_BU]);
    expect(rpt.totalRevenue).toBeCloseTo(17_000_000, 0);
  });

  it('portfolioRAROC > 0 for profitable portfolio', () => {
    const rpt = engine.generateReport([FX_BU, RETAIL_BU]);
    expect(rpt.portfolioRAROCPct).toBeGreaterThan(0);
  });

  it('topPerformers has at most 3 entries', () => {
    const rpt = engine.generateReport([FX_BU, RETAIL_BU, LOW_RAROC]);
    expect(rpt.topPerformers.length).toBeLessThanOrEqual(3);
  });

  it('topPerformers are sorted descending by RAROC', () => {
    const rpt = engine.generateReport([FX_BU, RETAIL_BU, LOW_RAROC]);
    const [first, second] = rpt.topPerformers;
    if (second) expect(first.rarocPct).toBeGreaterThanOrEqual(second.rarocPct);
  });

  it('underperformers are all below hurdle', () => {
    const rpt = engine.generateReport([FX_BU, RETAIL_BU, LOW_RAROC]);
    rpt.underperformers.forEach((u) => expect(u.isAboveHurdle).toBe(false));
  });

  it('customer dimension RAROC works correctly', () => {
    const customerInput: RAROCInput = {
      ...FX_BU,
      entityId: 'CUST-001',
      dimension: RAROCDimension.CUSTOMER,
    };
    const r = engine.calculate(customerInput);
    expect(r.dimension).toBe(RAROCDimension.CUSTOMER);
    expect(r.raroc).toBeGreaterThan(0);
  });
});
