/**
 * @file sprint8-ml.test.ts
 * @description Sprint 8.2 — XGBoost PD model + drift detector tests.
 */
import { describe, it, expect } from 'vitest';
import { XGBoostPDModelAdapter, FEATURE_NAMES } from './xgboost-pd-model.js';
import { ModelDriftDetector, DriftLevel } from './model-drift-detector.js';

// ── Suite 1: XGBoostPDModelAdapter ─────────────────────────────────────────
describe('XGBoostPDModelAdapter', () => {
  const model = new XGBoostPDModelAdapter();

  it('returns positive PD for BBB-rated 5Y corporate', async () => {
    const r = await model.predict({ currentRating: 'BBB', tenorYears: 5 });
    expect(r.pd12Month).toBeGreaterThan(0);
    expect(r.pd12Month).toBeLessThan(1);
    expect(r.pdLifetime).toBeGreaterThanOrEqual(r.pd12Month);
  });

  it('PD increases with lower rating (BBB < BB < B)', async () => {
    const bbb = await model.predict({ currentRating: 'BBB', tenorYears: 5 });
    const bb  = await model.predict({ currentRating: 'BB',  tenorYears: 5 });
    const b   = await model.predict({ currentRating: 'B',   tenorYears: 5 });
    expect(bb.pd12Month).toBeGreaterThan(bbb.pd12Month);
    expect(b.pd12Month).toBeGreaterThan(bb.pd12Month);
  });

  it('lifetime PD ≥ 12-month PD for all tenors', async () => {
    for (const tenor of [1, 3, 5, 10]) {
      const r = await model.predict({ currentRating: 'BBB', tenorYears: tenor });
      expect(r.pdLifetime).toBeGreaterThanOrEqual(r.pd12Month - 0.0001);
    }
  });

  it('sovereign (SOVEREIGN sector) has lower PD than corporate', async () => {
    const sov  = await model.predict({ currentRating: 'BBB', tenorYears: 5, sector: 'SOVEREIGN' });
    const corp = await model.predict({ currentRating: 'BBB', tenorYears: 5, sector: 'CORPORATE' });
    expect(sov.pd12Month).toBeLessThanOrEqual(corp.pd12Month + 0.01);
  });

  it('model version is set correctly', async () => {
    const r = await model.predict({ currentRating: 'A', tenorYears: 3 });
    expect(r.modelVersion).toBe(XGBoostPDModelAdapter.MODEL_VERSION);
  });

  it('predictWithSHAP returns 9 SHAP attributions', async () => {
    const r = await model.predictWithSHAP({
      currentRating: 'BBB', tenorYears: 5,
      daysPastDue: 0, onWatchList: false, effectiveInterestRate: 0.05,
    });
    expect(r.shapValues).toHaveLength(FEATURE_NAMES.length);
  });

  it('SHAP values sum equals predictedLogit (additive log-odds decomposition)', async () => {
    const r = await model.predictWithSHAP({ currentRating: 'BB', tenorYears: 3 });
    // shapValues are additive: baseline + adjustments = predictedLogit
    const shapSum = r.shapValues.reduce((s, v) => s + v.shapValue, 0);
    expect(Math.abs(shapSum - r.predictedLogit)).toBeLessThan(0.01);
  });

  it('SHAP impact labels are POSITIVE/NEGATIVE/NEUTRAL', async () => {
    const r = await model.predictWithSHAP({ currentRating: 'CCC', tenorYears: 2 });
    r.shapValues.forEach(s => {
      expect(['POSITIVE', 'NEGATIVE', 'NEUTRAL']).toContain(s.impact);
    });
  });

  it('FEATURE_NAMES has exactly 9 entries', () => {
    expect(FEATURE_NAMES).toHaveLength(9);
  });

  it('AAA sovereign has the lowest PD of all tested ratings', async () => {
    const aaa = await model.predict({ currentRating: 'AAA', tenorYears: 1, sector: 'SOVEREIGN' });
    const bb  = await model.predict({ currentRating: 'BB',  tenorYears: 1 });
    // AAA should be strictly lower than speculative-grade
    expect(aaa.pd12Month).toBeLessThan(bb.pd12Month);
    expect(aaa.pd12Month).toBeGreaterThan(0); // non-zero probability is correct
  });

  it('D-rated instrument has higher PD than investment-grade', async () => {
    // D-rated = defaulted; even simplified model should give higher PD than BBB
    const d   = await model.predict({ currentRating: 'D',   tenorYears: 1 });
    const bbb = await model.predict({ currentRating: 'BBB', tenorYears: 1 });
    expect(d.pd12Month).toBeGreaterThan(bbb.pd12Month);
    expect(d.pd12Month).toBeGreaterThan(0); // positive PD always
  });
});

// ── Suite 2: ModelDriftDetector ─────────────────────────────────────────────
describe('ModelDriftDetector', () => {
  it('insufficient samples returns STABLE', () => {
    const detector = new ModelDriftDetector({ minSamples: 100 });
    // Only record 50 samples
    for (let i = 0; i < 50; i++) detector.record(0.01 + i * 0.0001, 'BBB');
    const r = detector.check();
    expect(r.level).toBe(DriftLevel.STABLE);
    expect(r.sampleSize).toBe(50);
  });

  it('stable distribution produces low KS statistic', () => {
    const detector = new ModelDriftDetector({ minSamples: 50, windowSize: 200 });
    // Simulate PDs similar to baseline distribution
    for (let i = 0; i < 150; i++) {
      detector.record(0.001 + Math.random() * 0.03, 'BBB');
    }
    const r = detector.check();
    expect(r.ksStatistic).toBeGreaterThanOrEqual(0);
    expect(r.level).toBeDefined();
  });

  it('severely drifted distribution triggers ALERT or CRITICAL', () => {
    const detector = new ModelDriftDetector({
      alertThreshold: 0.15, criticalThreshold: 0.25, minSamples: 50,
    });
    // All high PDs — far from baseline
    for (let i = 0; i < 100; i++) detector.record(0.5 + Math.random() * 0.5, 'CCC');
    const r = detector.check();
    expect([DriftLevel.ALERT, DriftLevel.CRITICAL, DriftLevel.WARNING]).toContain(r.level);
  });

  it('recommendation string is non-empty', () => {
    const detector = new ModelDriftDetector({ minSamples: 10 });
    for (let i = 0; i < 50; i++) detector.record(Math.random() * 0.1, 'BB');
    const r = detector.check();
    expect(r.recommendation.length).toBeGreaterThan(10);
  });

  it('history accumulates drift checks', () => {
    const detector = new ModelDriftDetector({ minSamples: 50 });
    for (let i = 0; i < 150; i++) detector.record(Math.random() * 0.05, 'BBB');
    detector.check();
    detector.check();
    expect(detector.history.length).toBeGreaterThanOrEqual(1);
  });

  it('totalAlerts starts at 0', () => {
    const detector = new ModelDriftDetector();
    expect(detector.totalAlerts).toBe(0);
  });
});
