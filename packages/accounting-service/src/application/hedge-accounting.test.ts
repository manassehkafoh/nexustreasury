/**
 * HedgeAccountingService — TDD test suite
 *
 * Tests effectiveness testing (dollar-offset and regression)
 * and journal entry generation for FVH / CFH / NIH.
 */
import { describe, it, expect } from 'vitest';
import { HedgeAccountingService } from './hedge-accounting.service.js';
import { HedgeType, EffectivenessMethod } from '../domain/value-objects.js';

const service = new HedgeAccountingService();

const rel = {
  hedgeId: 'h-001',
  hedgeType: HedgeType.CASH_FLOW,
  hedgedItemId: 'pos-001',
  hedgingInstrumentId: 'trade-swap',
  notional: 10_000_000,
  currency: 'USD',
  effectivenessMethod: EffectivenessMethod.DOLLAR_OFFSET,
  designationDate: new Date('2026-01-01'),
  hedgeRatio: 1.0,
};

describe('HedgeAccountingService — dollar-offset', () => {
  it('deems highly effective when ratio = 1.0 (perfect hedge)', () => {
    const result = service.testEffectiveness({
      hedgeRelationship: rel,
      instrumentFVChange: -100_000,
      hedgedItemFVChange: 100_000,
    });
    expect(result.isHighlyEffective).toBe(true);
    expect(result.effectivenessRatio).toBeCloseTo(1.0, 4);
    expect(result.ineffectivePortion).toBeCloseTo(0, 2);
  });

  it('deems highly effective when ratio = 0.90', () => {
    const result = service.testEffectiveness({
      hedgeRelationship: rel,
      instrumentFVChange: -90_000,
      hedgedItemFVChange: 100_000,
    });
    expect(result.isHighlyEffective).toBe(true);
    expect(result.effectivenessRatio).toBeCloseTo(0.9, 3);
  });

  it('deems NOT highly effective when ratio = 0.70 (below 80%)', () => {
    const result = service.testEffectiveness({
      hedgeRelationship: rel,
      instrumentFVChange: -70_000,
      hedgedItemFVChange: 100_000,
    });
    expect(result.isHighlyEffective).toBe(false);
    expect(result.effectivePortion).toBe(0);
    expect(result.ineffectivePortion).toBeGreaterThan(0);
  });

  it('deems NOT highly effective when ratio = 1.30 (above 125%)', () => {
    const result = service.testEffectiveness({
      hedgeRelationship: rel,
      instrumentFVChange: -130_000,
      hedgedItemFVChange: 100_000,
    });
    expect(result.isHighlyEffective).toBe(false);
  });
});

describe('HedgeAccountingService — regression', () => {
  // Generate correlated pairs (R² ≈ 1)
  const perfectPairs: [number, number][] = Array.from({ length: 10 }, (_, i) => [
    -(i + 1) * 10_000, // instrument
    (i + 1) * 10_000, // hedged item
  ]);

  it('deems highly effective for near-perfect regression', () => {
    const result = service.testEffectiveness({
      hedgeRelationship: { ...rel, effectivenessMethod: EffectivenessMethod.REGRESSION },
      instrumentFVChange: -100_000,
      hedgedItemFVChange: 100_000,
      historicalPairs: perfectPairs,
    });
    expect(result.rSquared).toBeGreaterThan(0.99);
    expect(result.isHighlyEffective).toBe(true);
  });
});

describe('HedgeAccountingService — journal entries (CFH)', () => {
  it('generates OCI entry for effective portion', () => {
    const result = service.testEffectiveness({
      hedgeRelationship: rel,
      instrumentFVChange: -100_000,
      hedgedItemFVChange: 100_000,
    });
    const ociEntry = result.journalEntries.find((e) => e.creditAccount === '6200');
    expect(ociEntry).toBeDefined();
    expect(ociEntry!.amount).toBeGreaterThan(0);
  });

  it('generates FVH P&L entry for fair value hedge', () => {
    const result = service.testEffectiveness({
      hedgeRelationship: { ...rel, hedgeType: HedgeType.FAIR_VALUE },
      instrumentFVChange: -100_000,
      hedgedItemFVChange: 100_000,
    });
    const plEntry = result.journalEntries.find((e) => e.creditAccount === '4400');
    expect(plEntry).toBeDefined();
  });
});
