/**
 * NMDModellingService — TDD test suite
 * Tests: core/non-core split, LCR outflow, NSFR, NII impact, EVE impact
 */
import { describe, it, expect } from 'vitest';
import {
  NMDModellingService,
  NMDProductType,
  BASEL_III_NMD_ASSUMPTIONS,
  type NMDBalance,
} from './nmd-modelling.js';

const svc = new NMDModellingService();

const RETAIL_BALANCE: NMDBalance = {
  productType: NMDProductType.RETAIL_CURRENT_ACCOUNT,
  balance: 100_000_000,
  currency: 'USD',
  currentRate: 0.005, // 0.5% current NMD rate
};

const CORP_BALANCE: NMDBalance = {
  productType: NMDProductType.CORPORATE_NON_OPERATIONAL,
  balance: 50_000_000,
  currency: 'USD',
  currentRate: 0.04,
};

// ── Core / Non-Core Split ─────────────────────────────────────────────────────

describe('NMDModellingService — core/non-core split', () => {
  it('core balance = total × core rate (retail current: 70%)', () => {
    const proj = svc.project(RETAIL_BALANCE);
    expect(proj.coreBalance).toBeCloseTo(70_000_000, 0);
    expect(proj.nonCoreBalance).toBeCloseTo(30_000_000, 0);
  });

  it('coreBalance + nonCoreBalance = totalBalance', () => {
    const proj = svc.project(RETAIL_BALANCE);
    expect(proj.coreBalance + proj.nonCoreBalance).toBeCloseTo(proj.totalBalance, 0);
  });

  it('corporate non-operational: only 10% core (highly volatile)', () => {
    const proj = svc.project(CORP_BALANCE);
    expect(proj.coreBalance).toBeCloseTo(5_000_000, 0);
  });
});

// ── LCR Outflow ───────────────────────────────────────────────────────────────

describe('NMDModellingService — LCR outflow', () => {
  it('retail stable: 3% outflow rate (Basel III Table 2)', () => {
    const proj = svc.project(RETAIL_BALANCE);
    expect(proj.lcrOutflow30d).toBeCloseTo(3_000_000, 0); // 3% × 100M
  });

  it('corporate non-operational: 40% outflow rate', () => {
    const proj = svc.project(CORP_BALANCE);
    expect(proj.lcrOutflow30d).toBeCloseTo(20_000_000, 0); // 40% × 50M
  });
});

// ── NSFR Required Stable Funding ──────────────────────────────────────────────

describe('NMDModellingService — NSFR', () => {
  it('retail: 90% RSF factor', () => {
    const proj = svc.project(RETAIL_BALANCE);
    expect(proj.nsfrRequired).toBeCloseTo(90_000_000, 0);
  });

  it('corporate non-operational: 0% RSF (not stable funding)', () => {
    const proj = svc.project(CORP_BALANCE);
    expect(proj.nsfrRequired).toBe(0);
  });
});

// ── NII Impact (Interest Rate Sensitivity) ────────────────────────────────────

describe('NMDModellingService — NII impact', () => {
  it('NII impact = 0 when rateShock = 0', () => {
    const proj = svc.project(RETAIL_BALANCE, 0);
    expect(proj.niiImpact).toBe(0);
  });

  it('+200bp shock: NII increases for liability (bank pays more on deposits)', () => {
    const proj = svc.project(RETAIL_BALANCE, 0.02);
    // Retail beta = 0.10; repricedRate = 0.005 + 0.10×0.02 = 0.007
    // niiImpact = 100M × (0.007 - 0.005) = 200K (bank pays more → negative for bank)
    // NII impact sign depends on perspective: for liabilities, higher rate = cost
    expect(proj.repricedRate).toBeCloseTo(0.007, 4);
    expect(proj.niiImpact).toBeCloseTo(200_000, 0); // 100M × 0.002
  });

  it('repriced rate clamped to floor (cannot go below 0)', () => {
    const proj = svc.project(RETAIL_BALANCE, -0.1); // -1000bp shock
    expect(proj.repricedRate).toBeGreaterThanOrEqual(0);
    expect(proj.repricedRate).toBeCloseTo(
      BASEL_III_NMD_ASSUMPTIONS[NMDProductType.RETAIL_CURRENT_ACCOUNT].repricingFloor,
      4,
    );
  });

  it('repriced rate clamped to cap', () => {
    const proj = svc.project(RETAIL_BALANCE, 1.0); // +10000bp shock
    expect(proj.repricedRate).toBeLessThanOrEqual(
      BASEL_III_NMD_ASSUMPTIONS[NMDProductType.RETAIL_CURRENT_ACCOUNT].repricingCap,
    );
  });
});

// ── EVE Impact ────────────────────────────────────────────────────────────────

describe('NMDModellingService — EVE impact', () => {
  it('EVE impact = 0 when rateShock = 0', () => {
    const proj = svc.project(RETAIL_BALANCE, 0);
    expect(proj.eveImpact).toBeCloseTo(0, 10); // -0 and +0 are equal
  });

  it('+200bp shock: negative EVE impact (duration risk on core deposits)', () => {
    const proj = svc.project(RETAIL_BALANCE, 0.02);
    // eveImpact = -(coreBalance × coreDuration × rateShock × beta)
    // = -(70M × 4.5 × 0.02 × 0.10) = -630_000
    expect(proj.eveImpact).toBeCloseTo(-630_000, 0);
  });
});

// ── Aggregate Projection ──────────────────────────────────────────────────────

describe('NMDModellingService — projectAll', () => {
  it('aggregates LCR outflow across multiple products', () => {
    const result = svc.projectAll([RETAIL_BALANCE, CORP_BALANCE], 0);
    // retail: 3M + corp: 20M = 23M
    expect(result.totalLcrOutflow).toBeCloseTo(23_000_000, 0);
  });

  it('projections array has same length as input', () => {
    const result = svc.projectAll([RETAIL_BALANCE, CORP_BALANCE]);
    expect(result.projections).toHaveLength(2);
  });
});

// ── Tenant Overrides ──────────────────────────────────────────────────────────

describe('NMDModellingService — tenant overrides', () => {
  it('applies tenant override on top of Basel III defaults', () => {
    const svcWithOverride = new NMDModellingService({
      [NMDProductType.RETAIL_CURRENT_ACCOUNT]: { coreRate: 0.8 }, // more stable than Basel
    });
    const proj = svcWithOverride.project(RETAIL_BALANCE);
    expect(proj.coreBalance).toBeCloseTo(80_000_000, 0); // 80% not 70%
  });
});
