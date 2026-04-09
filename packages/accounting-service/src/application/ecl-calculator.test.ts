/**
 * ECLCalculator — TDD test suite
 *
 * Verifies:
 *  1. Stage assignment — SICR triggers (DPD, rating notches, watchlist)
 *  2. ECL amount = PD × LGD × EAD × DF
 *  3. Stage 1: 12-month PD used
 *  4. Stage 2/3: lifetime PD used
 *  5. ECL never negative
 *  6. Configurable SICR thresholds
 *  7. Rating deterioration notch counting
 */

import { describe, it, expect } from 'vitest';
import { ECLCalculator } from './ecl-calculator.js';
import { ECLStage } from '../domain/value-objects.js';

const calc = new ECLCalculator();

const baseInput = {
  instrumentId: 'INS-001',
  originationDate: new Date('2024-01-01'),
  reportingDate: new Date('2026-04-01'),
  outstandingPrincipal: 1_000_000,
  currency: 'USD',
  accruedInterest: 25_000,
  originationRating: 'BBB',
  currentRating: 'BBB',
  daysPastDue: 0,
  onWatchList: false,
  effectiveInterestRate: 0.05,
  recoveryRate: 0.4,
} as const;

// ── Stage Assignment ──────────────────────────────────────────────────────────

describe('ECLCalculator — stage assignment', () => {
  it('assigns Stage 1 (Performing) for clean instrument', () => {
    const result = calc.calculate({ ...baseInput });
    expect(result.stage).toBe(ECLStage.PERFORMING);
    expect(result.sicrTriggered).toBe(false);
  });

  it('assigns Stage 2 when DPD >= 30', () => {
    const result = calc.calculate({ ...baseInput, daysPastDue: 30 });
    expect(result.stage).toBe(ECLStage.UNDERPERFORMING);
    expect(result.sicrTriggered).toBe(true);
  });

  it('assigns Stage 2 when rating deteriorates by 2+ notches', () => {
    // BBB → BB = 3 notches deterioration
    const result = calc.calculate({ ...baseInput, currentRating: 'BB' });
    expect(result.stage).toBe(ECLStage.UNDERPERFORMING);
  });

  it('assigns Stage 2 when on watch-list', () => {
    const result = calc.calculate({ ...baseInput, onWatchList: true });
    expect(result.stage).toBe(ECLStage.UNDERPERFORMING);
  });

  it('assigns Stage 3 when DPD >= 90', () => {
    const result = calc.calculate({ ...baseInput, daysPastDue: 90 });
    expect(result.stage).toBe(ECLStage.NON_PERFORMING);
  });

  it('assigns Stage 3 for D-rated instrument', () => {
    const result = calc.calculate({ ...baseInput, currentRating: 'D' });
    expect(result.stage).toBe(ECLStage.NON_PERFORMING);
  });

  it('respects external stage override', () => {
    const result = calc.calculate({
      ...baseInput,
      stageOverride: ECLStage.NON_PERFORMING,
    });
    expect(result.stage).toBe(ECLStage.NON_PERFORMING);
  });
});

// ── ECL Amount ────────────────────────────────────────────────────────────────

describe('ECLCalculator — ECL amount', () => {
  it('ECL > 0 for any non-zero exposure', () => {
    const result = calc.calculate({ ...baseInput });
    expect(result.ecl).toBeGreaterThan(0);
  });

  it('ECL never negative', () => {
    // Even for near-zero PD
    const result = calc.calculate({ ...baseInput, currentRating: 'AAA' });
    expect(result.ecl).toBeGreaterThanOrEqual(0);
  });

  it('Stage 3 ECL > Stage 1 ECL for same exposure (lifetime PD > 12m PD)', () => {
    const s1 = calc.calculate({ ...baseInput, daysPastDue: 0 });
    const s3 = calc.calculate({ ...baseInput, daysPastDue: 90 });
    expect(s3.ecl).toBeGreaterThan(s1.ecl);
  });

  it('ECL scales with notional — doubling notional doubles ECL', () => {
    const r1 = calc.calculate({ ...baseInput, outstandingPrincipal: 1_000_000 });
    const r2 = calc.calculate({ ...baseInput, outstandingPrincipal: 2_000_000 });
    expect(r2.ecl / r1.ecl).toBeCloseTo(2.0, 1);
  });

  it('ECL decreases with higher recovery rate', () => {
    const r40 = calc.calculate({ ...baseInput, recoveryRate: 0.4 });
    const r70 = calc.calculate({ ...baseInput, recoveryRate: 0.7 });
    expect(r40.ecl).toBeGreaterThan(r70.ecl);
  });

  it('EAD = principal + accrued interest', () => {
    const result = calc.calculate({ ...baseInput });
    expect(result.ead).toBe(1_000_000 + 25_000);
  });

  it('LGD = 1 - recovery rate', () => {
    const result = calc.calculate({ ...baseInput, recoveryRate: 0.4 });
    expect(result.lgd).toBeCloseTo(0.6, 5);
  });
});

// ── Configurable SICR ────────────────────────────────────────────────────────

describe('ECLCalculator — configurable SICR config', () => {
  it('uses custom DPD threshold (e.g. 60 days instead of 30)', () => {
    const strictCalc = new ECLCalculator({
      sicrConfig: { dpdThreshold: 60, notchThreshold: 2, creditImpairedDpd: 90 },
    });
    // 45 DPD — Stage 1 under strict config, Stage 2 under default
    const defaultResult = calc.calculate({ ...baseInput, daysPastDue: 45 });
    const strictResult = strictCalc.calculate({ ...baseInput, daysPastDue: 45 });
    expect(defaultResult.stage).toBe(ECLStage.UNDERPERFORMING);
    expect(strictResult.stage).toBe(ECLStage.PERFORMING);
  });

  it('uses custom notch threshold (e.g. 3 notches)', () => {
    const strictCalc = new ECLCalculator({
      sicrConfig: { dpdThreshold: 30, notchThreshold: 3, creditImpairedDpd: 90 },
    });
    // BBB → BB+ = 2 notches: triggers Stage 2 with default threshold (2), but NOT with threshold=3
    const defaultResult = calc.calculate({ ...baseInput, currentRating: 'BB+' });
    const strictResult = strictCalc.calculate({ ...baseInput, currentRating: 'BB+' });
    expect(defaultResult.stage).toBe(ECLStage.UNDERPERFORMING); // 2 >= 2 → SICR
    expect(strictResult.stage).toBe(ECLStage.PERFORMING); // 2 < 3 → no SICR
  });
});

// ── Rationale ─────────────────────────────────────────────────────────────────

describe('ECLCalculator — rationale', () => {
  it('explains Stage 1 rationale clearly', () => {
    const result = calc.calculate({ ...baseInput });
    expect(result.rationale).toContain('Stage 1');
    expect(result.rationale).toContain(baseInput.currentRating);
  });

  it('explains Stage 2 DPD trigger', () => {
    const result = calc.calculate({ ...baseInput, daysPastDue: 45 });
    expect(result.rationale).toContain('Stage 2');
    expect(result.rationale).toContain('45');
  });

  it('explains Stage 3 DPD trigger', () => {
    const result = calc.calculate({ ...baseInput, daysPastDue: 120 });
    expect(result.rationale).toContain('Stage 3');
  });
});
