import { describe, it, expect } from 'vitest';
import { LiquidityGapReport, ALMScenario, LiquidityTimeBucket } from './liquidity-gap.aggregate.js';
import { BusinessDate, TenantId, Money } from '../shared/value-objects.js';

const tenantId = TenantId('tenant-001');

const baseParams = {
  tenantId,
  asOfDate: BusinessDate.today(),
  scenario: ALMScenario.CONTRACTUAL,
  currency: 'USD',
  rawBuckets: [
    {
      bucket: LiquidityTimeBucket.OVERNIGHT,
      inflows: 1_000_000,
      outflows: 600_000,
    },
    {
      bucket: LiquidityTimeBucket.ONE_WEEK,
      inflows: 500_000,
      outflows: 800_000,
    },
    {
      bucket: LiquidityTimeBucket.ONE_MONTH,
      inflows: 200_000,
      outflows: 700_000,
    },
  ],
  lcrComponents: {
    hqlaLevel1: Money.of(800_000_000, 'USD'),
    hqlaLevel2A: Money.of(100_000_000, 'USD'),
    hqlaLevel2B: Money.of(50_000_000, 'USD'),
    netCashOutflows30d: Money.of(700_000_000, 'USD'),
    minimumRequired: 100,
  },
  nsfrComponents: {
    availableStableFunding: Money.of(1_500_000_000, 'USD'),
    requiredStableFunding: Money.of(1_200_000_000, 'USD'),
  },
};

describe('LiquidityGapReport Aggregate', () => {
  describe('generate()', () => {
    it('creates a report with a valid UUID id', () => {
      const report = LiquidityGapReport.generate(baseParams);
      expect(report.id).toBeDefined();
      expect(report.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('stores the tenantId, scenario and currency', () => {
      const report = LiquidityGapReport.generate(baseParams);
      expect(report.scenario).toBe(ALMScenario.CONTRACTUAL);
      expect(report.currency).toBe('USD');
    });

    it('calculates bucket gaps correctly', () => {
      const report = LiquidityGapReport.generate(baseParams);
      expect(report.buckets[0]?.gap.toNumber()).toBe(400_000); // 1M - 600K
      expect(report.buckets[1]?.gap.toNumber()).toBe(-300_000); // 500K - 800K
    });

    it('calculates cumulative gaps correctly', () => {
      const report = LiquidityGapReport.generate(baseParams);
      expect(report.buckets[0]?.cumulativeGap.toNumber()).toBe(400_000);
      expect(report.buckets[1]?.cumulativeGap.toNumber()).toBe(100_000); // 400K - 300K
      expect(report.buckets[2]?.cumulativeGap.toNumber()).toBe(-400_000); // 100K - 500K
    });

    it('calculates totalHQLA as sum of L1 + L2A + L2B', () => {
      const report = LiquidityGapReport.generate(baseParams);
      expect(report.lcr.totalHQLA.toNumber()).toBe(950_000_000);
    });

    it('calculates LCR ratio correctly', () => {
      const report = LiquidityGapReport.generate(baseParams);
      // (950M / 700M) * 100 ≈ 135.71
      expect(report.lcr.lcrRatio).toBeCloseTo(135.71, 1);
    });

    it('marks LCR as compliant when ratio >= 100', () => {
      const report = LiquidityGapReport.generate(baseParams);
      expect(report.lcr.isCompliant).toBe(true);
    });

    it('marks LCR as non-compliant when ratio < 100', () => {
      const report = LiquidityGapReport.generate({
        ...baseParams,
        lcrComponents: {
          ...baseParams.lcrComponents,
          netCashOutflows30d: Money.of(2_000_000_000, 'USD'),
        },
      });
      expect(report.lcr.isCompliant).toBe(false);
    });

    it('returns 999 LCR ratio when net outflows are zero', () => {
      const report = LiquidityGapReport.generate({
        ...baseParams,
        lcrComponents: {
          ...baseParams.lcrComponents,
          netCashOutflows30d: Money.of(0, 'USD'),
        },
      });
      expect(report.lcr.lcrRatio).toBe(999);
    });

    it('calculates NSFR ratio correctly', () => {
      const report = LiquidityGapReport.generate(baseParams);
      // 1.5B / 1.2B * 100 = 125
      expect(report.nsfr.nsfrRatio).toBeCloseTo(125, 1);
      expect(report.nsfr.isCompliant).toBe(true);
    });

    it('marks NSFR as non-compliant when ratio < 100', () => {
      const report = LiquidityGapReport.generate({
        ...baseParams,
        nsfrComponents: {
          availableStableFunding: Money.of(900_000_000, 'USD'),
          requiredStableFunding: Money.of(1_200_000_000, 'USD'),
        },
      });
      expect(report.nsfr.isCompliant).toBe(false);
    });

    it('handles stressed scenario correctly', () => {
      const report = LiquidityGapReport.generate({
        ...baseParams,
        scenario: ALMScenario.STRESSED_30D,
      });
      expect(report.scenario).toBe(ALMScenario.STRESSED_30D);
    });
  });

  describe('domain events', () => {
    it('publishes LiquidityGapReportGeneratedEvent on generate()', () => {
      const report = LiquidityGapReport.generate(baseParams);
      const events = report.pullDomainEvents();
      expect(events.some((e) => e.eventType === 'nexus.alm.liquidity-gap.generated')).toBe(true);
    });

    it('publishes LCRBreachEvent when LCR < 100', () => {
      const report = LiquidityGapReport.generate({
        ...baseParams,
        lcrComponents: {
          ...baseParams.lcrComponents,
          netCashOutflows30d: Money.of(2_000_000_000, 'USD'),
        },
      });
      const events = report.pullDomainEvents();
      expect(events.some((e) => e.eventType === 'nexus.alm.lcr.breach')).toBe(true);
    });

    it('pullDomainEvents clears the event queue', () => {
      const report = LiquidityGapReport.generate(baseParams);
      report.pullDomainEvents();
      expect(report.pullDomainEvents()).toHaveLength(0);
    });
  });
});
