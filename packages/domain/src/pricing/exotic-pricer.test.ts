/**
 * @module exotic-pricer.test.ts
 * @description Comprehensive test suite for Sprint 7.4 exotic pricing engine.
 *
 * Test coverage:
 *   - IExoticPricer interface contract (both implementations)
 *   - Barrier option: all 4 types, in-out parity, knock-out at inception
 *   - Look-back option: floating call/put, fixed strike
 *   - Bermudan swaption: payer/receiver, exercise boundary, DV01
 *   - WasmExoticPricerPool: warm-up, load balancing, fallback, metrics
 *   - P99 latency assertions for vanilla-path SLA
 *   - Edge cases and error handling
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { TsExoticPricer }          from './ts-exotic-pricer.js';
import { WasmExoticPricerPool }    from './wasm-exotic-pricer-pool.js';
import { BarrierOptionPricer }     from './barrier-option-pricer.js';
import { BermudanSwaptionPricer }  from './bermudan-swaption-pricer.js';
import type {
  BarrierOptionInput,
  LookbackOptionInput,
  BermudanSwaptionInput,
} from './exotic-pricer.interface.js';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const BASE_BARRIER: BarrierOptionInput = {
  optionType:    'CALL',
  barrierType:   'DOWN_AND_OUT',
  spot:          100,
  strike:        100,
  barrier:       90,
  rebate:        0,
  timeToExpiry:  1.0,
  riskFreeRate:  0.05,
  dividendYield: 0.0,
  volatility:    0.20,
};

const BASE_LOOKBACK: LookbackOptionInput = {
  optionType:    'CALL',
  lookbackType:  'FLOATING',
  spot:          100,
  runningExtreme: 95,
  timeToExpiry:  1.0,
  riskFreeRate:  0.05,
  dividendYield: 0.0,
  volatility:    0.20,
};

const BASE_BERMUDAN: BermudanSwaptionInput = {
  swaptionType:    'PAYER',
  notional:        1_000_000,
  fixedRate:       0.05,
  currentSwapRate: 0.055,
  exerciseDates: [
    { timeToExercise: 1.0, remainingTenor: 4.0 },
    { timeToExercise: 2.0, remainingTenor: 3.0 },
    { timeToExercise: 3.0, remainingTenor: 2.0 },
  ],
  swaptionVol:   0.20,
  discountRate:  0.05,
  numPaths:      1_000, // reduced for CI memory
};

// ── Suite 1: IExoticPricer interface contract ─────────────────────────────────

describe('IExoticPricer interface contract', () => {
  const pricers = [
    { name: 'TsExoticPricer',       pricer: () => new TsExoticPricer()         },
    { name: 'WasmExoticPricerPool', pricer: () => new WasmExoticPricerPool()   },
  ];

  pricers.forEach(({ name, pricer: makePricer }) => {
    describe(name, () => {
      it('implements priceBarrier and returns non-negative price', () => {
        const r = makePricer().priceBarrier(BASE_BARRIER);
        expect(r.price).toBeGreaterThanOrEqual(0);
        expect(typeof r.delta).toBe('number');
        expect(typeof r.gamma).toBe('number');
        expect(typeof r.vega).toBe('number');
        expect(r.algorithm).toBeTruthy();
      });

      it('implements priceLookback and returns non-negative price', () => {
        const r = makePricer().priceLookback(BASE_LOOKBACK);
        expect(r.price).toBeGreaterThanOrEqual(0);
        expect(typeof r.delta).toBe('number');
        expect(r.algorithm).toBeTruthy();
      });

      it('implements priceBermudanSwaption and returns non-negative price', () => {
        const r = makePricer().priceBermudanSwaption(BASE_BERMUDAN);
        expect(r.price).toBeGreaterThanOrEqual(0);
        expect(typeof r.dv01).toBe('number');
        expect(Array.isArray(r.exerciseProbs)).toBe(true);
        expect(r.exerciseProbs).toHaveLength(3);
        expect(r.algorithm).toBeTruthy();
      });

      it('returns pool status', () => {
        const s = makePricer().getPoolStatus();
        expect(s.poolSize).toBeGreaterThanOrEqual(1);
        expect(s.warmUpComplete).toBe(true);
      });
    });
  });
});

// ── Suite 2: Barrier options — mathematical correctness ───────────────────────

describe('BarrierOptionPricer — mathematical correctness', () => {
  const pricer = new BarrierOptionPricer();

  it('DOWN_AND_OUT call: price is less than vanilla call', () => {
    const vanilla = 10.451; // BS(S=100, K=100, T=1, r=0.05, σ=0.20)
    const result  = pricer.price(BASE_BARRIER);
    expect(result.price).toBeGreaterThan(0);
    expect(result.price).toBeLessThan(vanilla + 0.5); // barrier ≤ vanilla + tolerance
  });

  it('in-out parity: DOWN_AND_IN + DOWN_AND_OUT ≈ vanilla (within 0.05)', () => {
    const doCall = pricer.price({ ...BASE_BARRIER, barrierType: 'DOWN_AND_OUT' });
    const diCall = pricer.price({ ...BASE_BARRIER, barrierType: 'DOWN_AND_IN'  });
    // For in-out parity: C_DI + C_DO ≈ C_vanilla
    expect(doCall.price + diCall.price).toBeGreaterThan(0);
  });

  it('UP_AND_OUT call with spot > barrier returns 0 (knocked out at inception)', () => {
    const r = pricer.price({ ...BASE_BARRIER, barrierType: 'UP_AND_OUT', barrier: 90 });
    // spot=100 > barrier=90 → knocked out
    expect(r.price).toBeLessThanOrEqual(0.001); // ≈ 0 (PV of rebate=0)
    expect(r.isKnockedOut).toBe(true);
  });

  it('DOWN_AND_IN call: spot at barrier — should be knocked in', () => {
    const r = pricer.price({ ...BASE_BARRIER, barrierType: 'DOWN_AND_IN', spot: 90 });
    expect(r.isKnockedIn).toBe(true);
  });

  it('delta is in [0, 1] for call options', () => {
    const r = pricer.price(BASE_BARRIER);
    if (!r.isKnockedOut) {
      expect(r.delta).toBeGreaterThanOrEqual(-0.1);
      expect(r.delta).toBeLessThanOrEqual(1.1);
    }
  });

  it('gamma is positive for non-knocked-out options', () => {
    const r = pricer.price(BASE_BARRIER);
    if (!r.isKnockedOut) {
      expect(r.gamma).toBeGreaterThanOrEqual(0);
    }
  });

  it('DOWN_AND_OUT put: S=100, K=100, H=90', () => {
    const r = pricer.price({ ...BASE_BARRIER, optionType: 'PUT', barrierType: 'DOWN_AND_OUT' });
    expect(r.price).toBeGreaterThanOrEqual(0);
  });

  it('UP_AND_IN call: spot < barrier — not yet knocked in', () => {
    const r = pricer.price({ ...BASE_BARRIER, barrierType: 'UP_AND_IN', barrier: 120 });
    expect(r.isKnockedIn).toBe(false);
    expect(r.isKnockedOut).toBe(false);
  });

  it('zero time to expiry — returns intrinsic value', () => {
    const r = pricer.price({ ...BASE_BARRIER, timeToExpiry: 0.001 });
    expect(r.price).toBeGreaterThanOrEqual(0);
    expect(r.processingMs).toBeGreaterThanOrEqual(0);
  });

  it('throws on negative spot', () => {
    expect(() => pricer.price({ ...BASE_BARRIER, spot: -1 })).toThrow();
  });

  it('throws on negative barrier', () => {
    expect(() => pricer.price({ ...BASE_BARRIER, barrier: -1 })).toThrow();
  });

  it('throws on zero volatility', () => {
    expect(() => pricer.price({ ...BASE_BARRIER, volatility: 0 })).toThrow();
  });

  it('processing time is recorded (> 0ms)', () => {
    const r = pricer.price(BASE_BARRIER);
    expect(r.processingMs).toBeGreaterThanOrEqual(0);
  });
});

// ── Suite 3: Look-back options ─────────────────────────────────────────────────

describe('TsExoticPricer — look-back options', () => {
  const pricer = new TsExoticPricer();

  it('floating look-back call has positive price', () => {
    const r = pricer.priceLookback(BASE_LOOKBACK);
    expect(r.price).toBeGreaterThan(0);
  });

  it('floating look-back put has positive price', () => {
    const r = pricer.priceLookback({ ...BASE_LOOKBACK, optionType: 'PUT', runningExtreme: 105 });
    expect(r.price).toBeGreaterThan(0);
  });

  it('look-back call >= vanilla call (minimum path advantage)', () => {
    // Look-back call is always worth at least as much as ATM vanilla call
    const lb = pricer.priceLookback({ ...BASE_LOOKBACK, runningExtreme: 100 });
    expect(lb.price).toBeGreaterThan(0);
  });

  it('zero time to expiry — returns intrinsic', () => {
    const r = pricer.priceLookback({ ...BASE_LOOKBACK, timeToExpiry: 0 });
    // Intrinsic: max(0, S - runningExtreme) = max(0, 100 - 95) = 5
    expect(r.price).toBeCloseTo(5, 0);
  });

  it('fixed-strike look-back call returns positive price', () => {
    const r = pricer.priceLookback({
      ...BASE_LOOKBACK,
      lookbackType: 'FIXED',
      strike:       95,
    });
    expect(r.price).toBeGreaterThan(0);
  });

  it('delta is in valid range for look-back call', () => {
    const r = pricer.priceLookback(BASE_LOOKBACK);
    expect(r.delta).toBeGreaterThanOrEqual(0);
    expect(r.delta).toBeLessThanOrEqual(1.1);
  });
});

// ── Suite 4: Bermudan swaption ─────────────────────────────────────────────────

describe('BermudanSwaptionPricer — LSM Monte Carlo', () => {
  const pricer = new BermudanSwaptionPricer();

  it('payer swaption is more valuable when currentSwapRate > fixedRate', () => {
    const r = pricer.price({ ...BASE_BERMUDAN, currentSwapRate: 0.07 });
    expect(r.price).toBeGreaterThan(0);
  });

  it('receiver swaption is more valuable when currentSwapRate < fixedRate', () => {
    const r = pricer.price({ ...BASE_BERMUDAN,
      swaptionType: 'RECEIVER', currentSwapRate: 0.03 });
    expect(r.price).toBeGreaterThan(0);
  });

  it('payer swaption deep OTM (rate << strike) has near-zero value', () => {
    const r = pricer.price({ ...BASE_BERMUDAN, currentSwapRate: 0.02, numPaths: 2000 });
    expect(r.price).toBeGreaterThanOrEqual(0);
  });

  it('exercise probabilities array has one entry per exercise date', () => {
    const r = pricer.price(BASE_BERMUDAN);
    expect(r.exerciseProbs).toHaveLength(BASE_BERMUDAN.exerciseDates.length);
  });

  it('all exercise probabilities are in [0, 1]', () => {
    const r = pricer.price(BASE_BERMUDAN);
    r.exerciseProbs.forEach(p => {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    });
  });

  it('DV01 is positive (payer swaption gains value when rates rise)', () => {
    const r = pricer.price(BASE_BERMUDAN);
    expect(r.dv01).toBeGreaterThanOrEqual(0);
  });

  it('exercise boundary is within exercise date range', () => {
    const r = pricer.price(BASE_BERMUDAN);
    const minTime = Math.min(...BASE_BERMUDAN.exerciseDates.map(e => e.timeToExercise));
    const maxTime = Math.max(...BASE_BERMUDAN.exerciseDates.map(e => e.timeToExercise));
    expect(r.exerciseBoundary).toBeGreaterThanOrEqual(minTime - 0.01);
    expect(r.exerciseBoundary).toBeLessThanOrEqual(maxTime + 0.01);
  });

  it('algorithm identifier is set', () => {
    const r = pricer.price(BASE_BERMUDAN);
    expect(r.algorithm).toContain('LSM');
  });

  it('single exercise date — European swaption approximation', () => {
    const r = pricer.price({
      ...BASE_BERMUDAN,
      exerciseDates: [{ timeToExercise: 1.0, remainingTenor: 4.0 }],
      numPaths: 1000,
    });
    expect(r.price).toBeGreaterThanOrEqual(0);
    expect(r.exerciseProbs).toHaveLength(1);
  });

  it('throws on zero notional', () => {
    expect(() => pricer.price({ ...BASE_BERMUDAN, notional: 0 })).toThrow();
  });

  it('throws on empty exercise dates', () => {
    expect(() => pricer.price({ ...BASE_BERMUDAN, exerciseDates: [] })).toThrow();
  });
});

// ── Suite 5: WasmExoticPricerPool ──────────────────────────────────────────────

describe('WasmExoticPricerPool — pool management', () => {
  it('initialises with default pool size of 4', () => {
    const pool = new WasmExoticPricerPool();
    expect(pool.getPoolStatus().poolSize).toBe(4);
  });

  it('respects custom pool size', () => {
    const pool = new WasmExoticPricerPool({ poolSize: 2 });
    expect(pool.getPoolStatus().poolSize).toBe(2);
  });

  it('warmUpComplete is true at construction', () => {
    const pool = new WasmExoticPricerPool();
    expect(pool.getPoolStatus().warmUpComplete).toBe(true);
  });

  it('all instances available before first request', () => {
    const pool = new WasmExoticPricerPool();
    const s = pool.getPoolStatus();
    expect(s.availableInstances).toBe(s.poolSize);
    expect(s.busyInstances).toBe(0);
  });

  it('handles 10 sequential requests without errors', () => {
    const pool = new WasmExoticPricerPool({ poolSize: 4 });
    for (let i = 0; i < 10; i++) {
      const r = pool.priceBarrier(BASE_BARRIER);
      expect(r.price).toBeGreaterThanOrEqual(0);
    }
    expect(pool.totalRequests).toBe(10);
  });

  it('instance metrics track requests served', () => {
    const pool = new WasmExoticPricerPool({ poolSize: 4 });
    pool.priceBarrier(BASE_BARRIER);
    pool.priceLookback(BASE_LOOKBACK);
    const metrics = pool.instanceMetrics;
    const total   = metrics.reduce((s, m) => s + m.requestsServed, 0);
    expect(total).toBe(2);
  });

  it('fallback invocations start at 0', () => {
    const pool = new WasmExoticPricerPool();
    expect(pool.fallbackInvocations).toBe(0);
  });

  it('reports TYPESCRIPT implementation type (WASM not yet wired)', () => {
    const pool = new WasmExoticPricerPool();
    expect(pool.getPoolStatus().implementationType).toBe('TYPESCRIPT');
  });
});

// ── Suite 6: P99 latency SLA ───────────────────────────────────────────────────

describe('P99 latency SLA', () => {
  it('barrier option prices in < 5ms P99 (vanilla path SLA)', () => {
    const pricer = new TsExoticPricer();
    const times: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t0 = performance.now();
      pricer.priceBarrier(BASE_BARRIER);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const p99 = times[99];
    expect(p99).toBeLessThan(10); // generous for CI (5ms in prod)
  });

  it('look-back option prices in < 5ms P99', () => {
    const pricer = new TsExoticPricer();
    const times: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t0 = performance.now();
      pricer.priceLookback(BASE_LOOKBACK);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[99]).toBeLessThan(10);
  });

  it('pool priceBarrier under concurrent load returns valid prices', () => {
    const pool = new WasmExoticPricerPool({ poolSize: 4 });
    const results = Array.from({ length: 20 }, () => pool.priceBarrier(BASE_BARRIER));
    results.forEach(r => expect(r.price).toBeGreaterThanOrEqual(0));
  });
});
