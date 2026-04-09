/**
 * VaRCalculator — TDD test suite
 *
 * Tests:
 *  - HS-VaR: correct percentile, scaling, 1% tail
 *  - Stressed VaR: period filter, fallback
 *  - MC-VaR: correct shape, always positive, ES ≥ VaR
 *  - AI/ML augmentation hook
 *  - Edge cases: empty series, single observation
 */
import { describe, it, expect } from 'vitest';
import {
  VaRCalculator,
  type HistoricalPnLObservation,
  type PositionRiskFactor,
  type RiskFactorReturn,
} from './var-calculator.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDailyPnL(values: number[], from = new Date('2025-01-01')): HistoricalPnLObservation[] {
  return values.map((pnl, i) => ({
    date: new Date(from.getTime() + i * 86_400_000),
    pnl,
    currency: 'USD',
  }));
}

// 250 observations with known distribution: 247 +1000, 3 at -100_000
// 99% VaR = 1% tail = 2.5 obs → VaR ≈ 100_000
const LOSS_SERIES = [...Array(247).fill(1_000), -50_000, -100_000, -80_000];

const calc = new VaRCalculator();

// ── Historical Simulation ─────────────────────────────────────────────────────

describe('VaRCalculator — Historical Simulation', () => {
  it('returns a positive var1Day', async () => {
    const result = await calc.historicalVaR(makeDailyPnL(LOSS_SERIES));
    expect(result.var1Day).toBeGreaterThan(0);
  });

  it('var10Day = var1Day × √10', async () => {
    const result = await calc.historicalVaR(makeDailyPnL(LOSS_SERIES));
    expect(result.var10Day).toBeCloseTo(result.var1Day * Math.sqrt(10), 4);
  });

  it('method is HISTORICAL', async () => {
    const result = await calc.historicalVaR(makeDailyPnL(LOSS_SERIES));
    expect(result.method).toBe('HISTORICAL');
  });

  it('uses the last N=250 observations (window)', async () => {
    // Prepend extreme losses that should be outside the 250-day window
    const longHistory = makeDailyPnL([
      ...Array(50).fill(-1_000_000), // far outside window
      ...LOSS_SERIES,
    ]);
    const resultAll = await calc.historicalVaR(makeDailyPnL(LOSS_SERIES));
    const resultLong = await calc.historicalVaR(longHistory);
    expect(resultLong.var1Day).toBeCloseTo(resultAll.var1Day, 0);
  });

  it('scenariosUsed equals the window size', async () => {
    const result = await calc.historicalVaR(makeDailyPnL(LOSS_SERIES));
    expect(result.scenariosUsed).toBe(250);
  });

  it('ES ≥ VaR (tail average is always at least as large as VaR percentile)', async () => {
    const result = await calc.historicalVaR(makeDailyPnL(LOSS_SERIES));
    expect(result.expectedShortfall).toBeGreaterThanOrEqual(result.var1Day);
  });

  it('returns var1Day = 0 for a portfolio with all gains', async () => {
    const allGains = makeDailyPnL(Array(250).fill(5_000));
    const result = await calc.historicalVaR(allGains);
    expect(result.var1Day).toBe(0);
  });

  it('handles empty history gracefully', async () => {
    const result = await calc.historicalVaR([]);
    expect(result.var1Day).toBe(0);
    expect(result.var10Day).toBe(0);
  });
});

// ── AI/ML Augmentation ────────────────────────────────────────────────────────

describe('VaRCalculator — AI/ML scenario augmentation', () => {
  it('augmented VaR is higher when augmenter adds extreme tail scenarios', async () => {
    const augmenter = {
      augment: async (history: HistoricalPnLObservation[]) => [
        ...history,
        { date: new Date(), pnl: -500_000, currency: 'USD' },
        { date: new Date(), pnl: -600_000, currency: 'USD' },
        { date: new Date(), pnl: -700_000, currency: 'USD' },
      ],
    };
    const calcWithML = new VaRCalculator(augmenter);
    const baseResult = await calc.historicalVaR(makeDailyPnL(LOSS_SERIES));
    const mlResult = await calcWithML.historicalVaR(makeDailyPnL(LOSS_SERIES));
    expect(mlResult.var1Day).toBeGreaterThan(baseResult.var1Day);
  });
});

// ── Stressed VaR ──────────────────────────────────────────────────────────────

describe('VaRCalculator — Stressed VaR', () => {
  it('method is STRESSED', async () => {
    const result = await calc.stressedVaR(makeDailyPnL(LOSS_SERIES, new Date('2007-07-01')));
    expect(result.method).toBe('STRESSED');
  });

  it('stressedPeriod is returned in result', async () => {
    const result = await calc.stressedVaR(makeDailyPnL(LOSS_SERIES, new Date('2007-07-01')));
    expect(result.stressedPeriod).toBeDefined();
    expect(result.stressedPeriod!.from).toBeDefined();
  });

  it('falls back to all data if none in stress period', async () => {
    // Use dates outside the 2007-2009 window
    const result = await calc.stressedVaR(makeDailyPnL(LOSS_SERIES, new Date('2020-01-01')));
    expect(result.var1Day).toBeGreaterThanOrEqual(0);
    expect(result.scenariosUsed).toBeGreaterThan(0);
  });

  it('sVaR ≥ 0 for all loss series', async () => {
    const result = await calc.stressedVaR(makeDailyPnL(LOSS_SERIES, new Date('2007-07-01')));
    expect(result.var1Day).toBeGreaterThanOrEqual(0);
  });
});

// ── Monte Carlo ───────────────────────────────────────────────────────────────

describe('VaRCalculator — Monte Carlo', () => {
  const positions: PositionRiskFactor[] = [
    { positionId: 'p1', riskFactorId: 'USD_IR_5Y', sensitivity: -5_000, currency: 'USD' },
    { positionId: 'p2', riskFactorId: 'EURUSD_FX', sensitivity: 1_000_000, currency: 'USD' },
  ];

  const rfReturns: RiskFactorReturn[] = [
    ...Array.from({ length: 100 }, (_, i) => ({
      date: new Date(Date.now() - i * 86_400_000),
      riskFactorId: 'USD_IR_5Y',
      return: (Math.random() - 0.5) * 0.01,
    })),
    ...Array.from({ length: 100 }, (_, i) => ({
      date: new Date(Date.now() - i * 86_400_000),
      riskFactorId: 'EURUSD_FX',
      return: (Math.random() - 0.5) * 0.005,
    })),
  ];

  it('returns a positive var1Day', () => {
    const result = calc.monteCarloVaR(positions, rfReturns);
    expect(result.var1Day).toBeGreaterThan(0);
  });

  it('method is MONTE_CARLO', () => {
    const result = calc.monteCarloVaR(positions, rfReturns);
    expect(result.method).toBe('MONTE_CARLO');
  });

  it('scenariosUsed = mcPaths (default 10_000)', () => {
    // Use a small path count for test speed
    const fastCalc = new VaRCalculator(undefined, {
      mcPaths: 100,
      historicalWindow: 250,
      stressedPeriodFrom: new Date('2007-07-01'),
      stressedPeriodTo: new Date('2008-12-31'),
    });
    const result = fastCalc.monteCarloVaR(positions, rfReturns);
    expect(result.scenariosUsed).toBe(100);
  });

  it('ES ≥ var1Day', () => {
    const fastCalc = new VaRCalculator(undefined, {
      mcPaths: 500,
      historicalWindow: 250,
      stressedPeriodFrom: new Date('2007-07-01'),
      stressedPeriodTo: new Date('2008-12-31'),
    });
    const result = fastCalc.monteCarloVaR(positions, rfReturns);
    expect(result.expectedShortfall).toBeGreaterThanOrEqual(result.var1Day);
  });

  it('returns 0 for empty positions', () => {
    const result = calc.monteCarloVaR([], rfReturns);
    expect(result.var1Day).toBe(0);
  });
});
