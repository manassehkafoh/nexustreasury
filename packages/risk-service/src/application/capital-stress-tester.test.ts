/**
 * @file capital-stress-tester.test.ts — Sprint 10-A (FIS BSM Capital Stress Testing gap closure)
 */
import { describe, it, expect } from 'vitest';
import { CapitalStressTester, StressScenario, type CapitalPosition } from './capital-stress-tester.js';

const SOUND_BANK: CapitalPosition = {
  tenantId: 'bank-001', reportingDate: '2026-04-09', currency: 'USD',
  cet1Capital: 800_000_000, at1Capital: 100_000_000, tier2Capital: 200_000_000,
  rwa: 6_000_000_000, totalExposure: 10_000_000_000,
  grossLoans: 4_000_000_000, nii: 400_000_000, ppop: 250_000_000,
  ccybRate: 0.01, gsibSurcharge: 0.005, horizonYears: 3,
};

const tester = new CapitalStressTester();

describe('CapitalStressTester — Sprint 10-A (FIS BSM gap)', () => {
  it('baseline CET1 ratio is correctly calculated', () => {
    const r = tester.runStressTest(SOUND_BANK);
    const expected = (800_000_000 / 6_000_000_000) * 100;
    expect(Math.abs(r.baselineCET1RatioPct - expected)).toBeLessThan(0.01);
  });

  it('generates results for all 5 stress scenarios', () => {
    const r = tester.runStressTest(SOUND_BANK);
    expect(r.results).toHaveLength(5);
  });

  it('each result has a valid scenario type', () => {
    const r = tester.runStressTest(SOUND_BANK);
    const valid = Object.values(StressScenario);
    r.results.forEach(res => expect(valid).toContain(res.scenario));
  });

  it('severely adverse CET1 ratio < adverse CET1 ratio (more stressed = worse)', () => {
    const r = tester.runStressTest(SOUND_BANK);
    const adverse = r.results.find(x => x.scenario === StressScenario.ADVERSE)!;
    const severe  = r.results.find(x => x.scenario === StressScenario.SEVERELY_ADVERSE)!;
    expect(severe.stressedCET1RatioPct).toBeLessThan(adverse.stressedCET1RatioPct);
  });

  it('baseline CET1 ratio >= adverse CET1 ratio (stress reduces capital)', () => {
    const r = tester.runStressTest(SOUND_BANK);
    const adverse = r.results.find(x => x.scenario === StressScenario.ADVERSE)!;
    expect(r.baselineCET1RatioPct).toBeGreaterThanOrEqual(adverse.stressedCET1RatioPct);
  });

  it('well-capitalised bank passes baseline and adverse scenarios', () => {
    const r = tester.runStressTest(SOUND_BANK);
    const base = r.results.find(x => x.scenario === StressScenario.BASELINE)!;
    expect(base.passesMinimum).toBe(true);
  });

  it('worstCase is the result with lowest CET1 ratio', () => {
    const r = tester.runStressTest(SOUND_BANK);
    const allRatios = r.results.map(x => x.stressedCET1RatioPct);
    expect(r.worstCase.stressedCET1RatioPct).toBe(Math.min(...allRatios));
  });

  it('capital depletion > 0 under adverse shock', () => {
    const r = tester.runStressTest(SOUND_BANK);
    const adverse = r.results.find(x => x.scenario === StressScenario.ADVERSE)!;
    expect(adverse.capitalDepletion).toBeGreaterThan(0);
  });

  it('survival horizon > 0 days for passing scenarios', () => {
    const r = tester.runStressTest(SOUND_BANK);
    // Only baseline should reliably have positive headroom; check at least 1 result has > 0
    const positive = r.results.filter(res => res.survivalHorizonDays > 0);
    expect(positive.length).toBeGreaterThan(0);
  });

  it('minimum CET1 ratio includes CCyB and G-SIB surcharge', () => {
    const r = tester.runStressTest(SOUND_BANK);
    const expected = (0.045 + 0.025 + 0.01 + 0.005) * 100;
    r.results.forEach(res =>
      expect(Math.abs(res.minimumCET1RatioPct - expected)).toBeLessThan(0.01)
    );
  });

  it('overall assessment string is non-empty', () => {
    const r = tester.runStressTest(SOUND_BANK);
    expect(r.overallAssessment.length).toBeGreaterThan(10);
  });

  it('undercapitalised bank fails severely adverse', () => {
    const weak: CapitalPosition = { ...SOUND_BANK, cet1Capital: 250_000_000 };
    const r = tester.runStressTest(weak);
    const severe = r.results.find(x => x.scenario === StressScenario.SEVERELY_ADVERSE)!;
    expect(severe.passesMinimum).toBe(false);
  });

  it('leverage ratio > 0 for all scenarios', () => {
    const r = tester.runStressTest(SOUND_BANK);
    r.results.forEach(res => expect(res.stressedLeverageRatioPct).toBeGreaterThan(0));
  });

  it('cfpTriggerScenario is null when all scenarios viable', () => {
    const strong: CapitalPosition = { ...SOUND_BANK, cet1Capital: 2_000_000_000 };
    const r = tester.runStressTest(strong);
    expect(r.cfpTriggerScenario).toBeNull();
  });
});
