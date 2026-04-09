/**
 * RegulatoryReportingService — TDD test suite
 *
 * Tests: LCR ratio, NSFR ratio, IRRBB outlier test
 */
import { describe, it, expect } from 'vitest';
import {
  RegulatoryReportingService,
  type HQLAItem,
  type CashOutflowItem,
  type CashInflowItem,
} from './regulatory-reporting.service.js';

const svc = new RegulatoryReportingService();
const TODAY = new Date('2026-04-09');
const TENANT = 'tenant-001';

// ── LCR Test Data ─────────────────────────────────────────────────────────────

const hqlaItems: HQLAItem[] = [
  {
    category: 'LEVEL_1',
    description: 'Government bonds',
    marketValue: 500_000_000,
    haircut: 0.0,
    adjustedValue: 500_000_000,
    currency: 'USD',
  },
  {
    category: 'LEVEL_2A',
    description: 'Agency bonds',
    marketValue: 100_000_000,
    haircut: 0.15,
    adjustedValue: 85_000_000,
    currency: 'USD',
  },
  {
    category: 'LEVEL_2B',
    description: 'Corporate bonds (IG)',
    marketValue: 50_000_000,
    haircut: 0.5,
    adjustedValue: 25_000_000,
    currency: 'USD',
  },
];

const outflowItems: CashOutflowItem[] = [
  {
    category: 'Retail deposits — stable',
    balance: 1_000_000_000,
    runoffRate: 0.03,
    outflow: 30_000_000,
    currency: 'USD',
  },
  {
    category: 'Corporate — non-operational',
    balance: 200_000_000,
    runoffRate: 0.4,
    outflow: 80_000_000,
    currency: 'USD',
  },
  {
    category: 'Committed credit facilities',
    balance: 100_000_000,
    runoffRate: 0.1,
    outflow: 10_000_000,
    currency: 'USD',
  },
];

const inflowItems: CashInflowItem[] = [
  {
    category: 'Performing loans',
    balance: 300_000_000,
    inflowRate: 0.5,
    inflow: 150_000_000,
    currency: 'USD',
  },
];

// ── LCR Tests ─────────────────────────────────────────────────────────────────

describe('RegulatoryReportingService — LCR', () => {
  it('computes totalHQLA as sum of adjusted values', async () => {
    const report = await svc.buildLCRReport({
      tenantId: TENANT,
      reportDate: TODAY,
      currency: 'USD',
      hqlaItems,
      outflowItems,
      inflowItems,
    });
    // 500M + 85M + 25M = 610M
    expect(report.totalHQLA).toBeCloseTo(610_000_000, 0);
  });

  it('computes totalOutflows correctly', async () => {
    const report = await svc.buildLCRReport({
      tenantId: TENANT,
      reportDate: TODAY,
      currency: 'USD',
      hqlaItems,
      outflowItems,
      inflowItems,
    });
    // 30M + 80M + 10M = 120M
    expect(report.totalOutflows).toBeCloseTo(120_000_000, 0);
  });

  it('caps inflows at 75% of outflows (Basel III §33)', async () => {
    const report = await svc.buildLCRReport({
      tenantId: TENANT,
      reportDate: TODAY,
      currency: 'USD',
      hqlaItems,
      outflowItems,
      inflowItems,
    });
    // 75% of 120M = 90M; inflowItems give 150M → capped at 90M
    expect(report.totalInflows).toBeCloseTo(90_000_000, 0);
  });

  it('netCashOutflows = totalOutflows - cappedInflows', async () => {
    const report = await svc.buildLCRReport({
      tenantId: TENANT,
      reportDate: TODAY,
      currency: 'USD',
      hqlaItems,
      outflowItems,
      inflowItems,
    });
    expect(report.netCashOutflows).toBeCloseTo(30_000_000, 0); // 120M - 90M
  });

  it('lcrRatio = totalHQLA / netCashOutflows', async () => {
    const report = await svc.buildLCRReport({
      tenantId: TENANT,
      reportDate: TODAY,
      currency: 'USD',
      hqlaItems,
      outflowItems,
      inflowItems,
    });
    // 610M / 30M ≈ 20.33
    expect(report.lcrRatio).toBeCloseTo(610_000_000 / 30_000_000, 1);
  });

  it('isCompliant = true when LCR ≥ 100%', async () => {
    const report = await svc.buildLCRReport({
      tenantId: TENANT,
      reportDate: TODAY,
      currency: 'USD',
      hqlaItems,
      outflowItems,
      inflowItems,
    });
    expect(report.isCompliant).toBe(true);
    expect(report.deficitAmount).toBe(0);
  });

  it('isCompliant = false when HQLA < net outflows', async () => {
    const tinyHQLA: HQLAItem[] = [
      {
        category: 'LEVEL_1',
        description: 'Cash',
        marketValue: 1_000_000,
        haircut: 0,
        adjustedValue: 1_000_000,
        currency: 'USD',
      },
    ];
    const report = await svc.buildLCRReport({
      tenantId: TENANT,
      reportDate: TODAY,
      currency: 'USD',
      hqlaItems: tinyHQLA,
      outflowItems,
      inflowItems,
    });
    expect(report.isCompliant).toBe(false);
    expect(report.deficitAmount).toBeGreaterThan(0);
  });
});

// ── NSFR Tests ────────────────────────────────────────────────────────────────

describe('RegulatoryReportingService — NSFR', () => {
  it('nsfrRatio = totalASF / totalRSF', () => {
    const report = svc.buildNSFRReport({
      tenantId: TENANT,
      reportDate: TODAY,
      currency: 'USD',
      asfComponents: [
        { description: 'Tier 1 capital', balance: 100_000_000, asfFactor: 1.0, asf: 100_000_000 },
        { description: 'Retail deposits', balance: 800_000_000, asfFactor: 0.9, asf: 720_000_000 },
      ],
      rsfComponents: [
        { description: 'Loans 1Y+', balance: 600_000_000, rsfFactor: 0.65, rsf: 390_000_000 },
        { description: 'HQLA Level 1', balance: 300_000_000, rsfFactor: 0.05, rsf: 15_000_000 },
      ],
    });
    // ASF = 820M, RSF = 405M → NSFR ≈ 2.02
    expect(report.totalASF).toBeCloseTo(820_000_000, 0);
    expect(report.totalRSF).toBeCloseTo(405_000_000, 0);
    expect(report.nsfrRatio).toBeCloseTo(820_000_000 / 405_000_000, 2);
    expect(report.isCompliant).toBe(true);
  });

  it('isCompliant = false when ASF < RSF', () => {
    const report = svc.buildNSFRReport({
      tenantId: TENANT,
      reportDate: TODAY,
      currency: 'USD',
      asfComponents: [
        { description: 'Capital', balance: 10_000_000, asfFactor: 1.0, asf: 10_000_000 },
      ],
      rsfComponents: [
        { description: 'Loans', balance: 20_000_000, rsfFactor: 1.0, rsf: 20_000_000 },
      ],
    });
    expect(report.isCompliant).toBe(false);
    expect(report.nsfrRatio).toBeCloseTo(0.5, 2);
  });
});

// ── IRRBB Outlier Test ────────────────────────────────────────────────────────

describe('RegulatoryReportingService — IRRBB supervisory outlier test', () => {
  const tier1Capital = 500_000_000; // $500M Tier 1

  it('generates results for all 6 prescribed scenarios', () => {
    const report = svc.buildIRRBBReport({
      tenantId: TENANT,
      reportDate: TODAY,
      currency: 'USD',
      tier1Capital,
      eveDeltas: {
        PARALLEL_UP: -80_000_000,
        PARALLEL_DOWN: 20_000_000,
        STEEPENER: -30_000_000,
        FLATTENER: 15_000_000,
        SHORT_RATE_UP: -50_000_000,
        SHORT_RATE_DOWN: 10_000_000,
      },
      niiSensitivity200Up: -25_000_000,
      niiSensitivity200Down: 15_000_000,
    });
    expect(report.scenarios).toHaveLength(6);
  });

  it('identifies outlier when |ΔEVE / Tier1| > 15%', () => {
    const report = svc.buildIRRBBReport({
      tenantId: TENANT,
      reportDate: TODAY,
      currency: 'USD',
      tier1Capital,
      eveDeltas: {
        PARALLEL_UP: -80_000_000, // 80M / 500M = 16% > 15% → outlier
      },
      niiSensitivity200Up: -10_000_000,
      niiSensitivity200Down: 5_000_000,
    });
    const upScenario = report.scenarios.find((s) => s.scenario === 'PARALLEL_UP');
    expect(upScenario!.isOutlier).toBe(true);
    expect(upScenario!.eveRatioPct).toBeCloseTo(-16, 0);
  });

  it('does NOT flag outlier when |ΔEVE / Tier1| ≤ 15%', () => {
    const report = svc.buildIRRBBReport({
      tenantId: TENANT,
      reportDate: TODAY,
      currency: 'USD',
      tier1Capital,
      eveDeltas: { PARALLEL_UP: -60_000_000 }, // 60M / 500M = 12% ≤ 15%
      niiSensitivity200Up: 0,
      niiSensitivity200Down: 0,
    });
    const upScenario = report.scenarios.find((s) => s.scenario === 'PARALLEL_UP');
    expect(upScenario!.isOutlier).toBe(false);
  });

  it('hasOutlierBank = true when any scenario triggers outlier threshold', () => {
    const report = svc.buildIRRBBReport({
      tenantId: TENANT,
      reportDate: TODAY,
      currency: 'USD',
      tier1Capital,
      eveDeltas: { PARALLEL_UP: -80_000_000 },
      niiSensitivity200Up: 0,
      niiSensitivity200Down: 0,
    });
    expect(report.hasOutlierBank).toBe(true);
  });

  it('captures NII sensitivities in report', () => {
    const report = svc.buildIRRBBReport({
      tenantId: TENANT,
      reportDate: TODAY,
      currency: 'USD',
      tier1Capital,
      eveDeltas: {},
      niiSensitivity200Up: -25_000_000,
      niiSensitivity200Down: 15_000_000,
    });
    expect(report.niiSensitivity200Up).toBe(-25_000_000);
    expect(report.niiSensitivity200Down).toBe(15_000_000);
  });
});
