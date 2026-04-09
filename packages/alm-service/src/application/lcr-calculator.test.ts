import { describe, it, expect } from 'vitest';
import { LCRCalculator } from './lcr-calculator.js';
import { ALMScenario, LiquidityTimeBucket, TenantId, BusinessDate } from '@nexustreasury/domain';

const calc = new LCRCalculator();
const tenantId = TenantId('tenant-001');

const standardInput = {
  tenantId,
  asOfDate: BusinessDate.today(),
  scenario: ALMScenario.CONTRACTUAL,
  currency: 'USD',
  cashFlows: [
    { bucket: LiquidityTimeBucket.OVERNIGHT, inflowAmount: 500, outflowAmount: 200 },
    { bucket: LiquidityTimeBucket.ONE_WEEK, inflowAmount: 300, outflowAmount: 400 },
    { bucket: LiquidityTimeBucket.ONE_MONTH, inflowAmount: 200, outflowAmount: 600 },
  ],
  lcr: {
    hqlaLevel1: 1_200_000_000,
    hqlaLevel2A: 200_000_000,
    hqlaLevel2B: 50_000_000,
    netCashOutflows30d: 1_000_000_000,
  },
  nsfr: { availableStableFunding: 2_000_000_000, requiredStableFunding: 1_700_000_000 },
};

describe('LCRCalculator', () => {
  it('generates a report with correct LCR ratio', () => {
    const report = calc.generate(standardInput);
    expect(report.lcr.lcrRatio).toBeGreaterThan(100);
    expect(report.lcr.isCompliant).toBe(true);
  });

  it('generates a report with correct NSFR ratio', () => {
    const report = calc.generate(standardInput);
    expect(report.nsfr.nsfrRatio).toBeCloseTo(117.65, 1);
    expect(report.nsfr.isCompliant).toBe(true);
  });

  it('calculates cumulative gap correctly', () => {
    const report = calc.generate(standardInput);
    const buckets = report.buckets;
    // O/N: +300, 1W: +300-400= -100 cumulative = +200, 1M: +200-600= -400 cumulative = -200
    expect(buckets[0]?.gap.toNumber()).toBe(300);
    expect(buckets[1]?.gap.toNumber()).toBe(-100);
    expect(buckets[1]?.cumulativeGap.toNumber()).toBe(200);
  });

  it('marks report as LCR breach when ratio < 100', () => {
    const breachInput = {
      ...standardInput,
      lcr: { ...standardInput.lcr, netCashOutflows30d: 2_000_000_000 },
    };
    const report = calc.generate(breachInput);
    expect(report.lcr.isCompliant).toBe(false);
    const events = report.pullDomainEvents();
    expect(events.some((e) => e.eventType === 'nexus.alm.lcr.breach')).toBe(true);
  });

  describe('applyHQLAHaircuts', () => {
    it('applies 15% haircut to Level 2A', () => {
      // Realistic input: L1=500 ensures L2 cap (40% rule) doesn't restrict L2A=100 post-haircut (85 < 40%×585=234)
      const result = calc.applyHQLAHaircuts({ level1: 500, level2A: 100, level2B: 0 });
      expect(result.level2A).toBe(85);
    });

    it('applies 25% haircut to Level 2B', () => {
      // Realistic input: L1=1000 ensures L2B cap (15% rule) doesn't restrict L2B=100 post-haircut (75 < 15%×1075=161)
      const result = calc.applyHQLAHaircuts({ level1: 1000, level2A: 0, level2B: 100 });
      expect(result.level2B).toBe(75);
    });

    it('enforces Level 2B cap at 15% of total HQLA', () => {
      const result = calc.applyHQLAHaircuts({ level1: 1000, level2A: 0, level2B: 500 });
      expect(result.level2B).toBeLessThanOrEqual(result.total * 0.15);
    });
  });
});
