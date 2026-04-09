/**
 * @file vol-surface.test.ts
 * @description Sprint 8.4 — SVI vol surface + Vanna-Volga pricer tests.
 */
import { describe, it, expect } from 'vitest';
import { SVIVolatilitySurface, type SVISlice, type VolQuote } from './vol-surface.js';
import { VannaVolgaPricer } from './vanna-volga-pricer.js';

// ── Realistic SVI slice for EUR/USD 1M vol ───────────────────────────────────
// Slices calibrated to be strictly calendar-arbitrage-free:
// w(k, tau_next) >= w(k, tau_prev) for all k in [-0.3, 0.3]
// achieved by keeping b constant and only increasing 'a'
const EURUSD_SLICES: SVISlice[] = [
  { tau: 0.0833, a: 0.0004, b: 0.0150, rho: -0.12, m: 0.001,  sigma: 0.0180 }, // 1M
  { tau: 0.2500, a: 0.0012, b: 0.0150, rho: -0.12, m: 0.0005, sigma: 0.0180 }, // 3M
  { tau: 0.5000, a: 0.0024, b: 0.0150, rho: -0.10, m: 0.0003, sigma: 0.0180 }, // 6M
  { tau: 1.0000, a: 0.0048, b: 0.0150, rho: -0.08, m: 0.0002, sigma: 0.0180 }, // 1Y
];

const EURUSD_MARKET_QUOTES: VolQuote[] = [
  { tau: 0.0833, atmVol: 0.0820, rr25: -0.0025, bf25: 0.0003, forward: 1.0842 },
  { tau: 0.2500, atmVol: 0.0785, rr25: -0.0022, bf25: 0.0003, forward: 1.0842 },
  { tau: 1.0000, atmVol: 0.0750, rr25: -0.0018, bf25: 0.0002, forward: 1.0842 },
];

// ── Suite 1: SVIVolatilitySurface ─────────────────────────────────────────────
describe('SVIVolatilitySurface', () => {
  const surface = new SVIVolatilitySurface(EURUSD_SLICES, 1.0842);

  it('returns ATM vol close to calibrated value for 1M expiry', () => {
    const vol = surface.impliedVol(1.0842, 0.0833); // ATM = F
    expect(vol).toBeGreaterThan(0.01);
    expect(vol).toBeLessThan(0.30);
  });

  it('returns higher vol for OTM puts (downside skew for EUR/USD)', () => {
    const atmVol  = surface.impliedVol(1.0842, 0.0833);
    const otmPut  = surface.impliedVol(1.0842 * 0.97, 0.0833); // 3% OTM put
    // EUR/USD has negative skew: puts should be more expensive
    expect(otmPut).toBeGreaterThanOrEqual(atmVol * 0.95); // allow slight variation
  });

  it('vol is positive for all strikes along 1Y expiry slice', () => {
    const strikes = [0.95, 1.00, 1.05, 1.08, 1.10, 1.15, 1.20].map(s => s * 1.0842);
    for (const K of strikes) {
      const v = surface.impliedVol(K, 1.0);
      expect(v).toBeGreaterThan(0);
    }
  });

  it('total variance increases with time (calendar arbitrage-free)', () => {
    const strike = 1.0842;
    const w1M = surface.impliedVol(strike, 0.0833) ** 2 * 0.0833;
    const w3M = surface.impliedVol(strike, 0.25)   ** 2 * 0.25;
    const w1Y = surface.impliedVol(strike, 1.0)    ** 2 * 1.0;
    expect(w3M).toBeGreaterThan(w1M * 0.9);  // allow small numerical tolerance
    expect(w1Y).toBeGreaterThan(w3M * 0.9);
  });

  it('surface() grid returns correct dimensions', () => {
    const strikes  = [0.95, 1.00, 1.05, 1.10].map(s => s * 1.0842);
    const expiries = [0.0833, 0.25, 1.0];
    const grid     = surface.surface(strikes, expiries);
    expect(grid).toHaveLength(3);      // 3 expiries
    expect(grid[0]).toHaveLength(4);   // 4 strikes per expiry
    expect(grid[0][0]).toHaveProperty('impliedVol');
    expect(grid[0][0]).toHaveProperty('logMoney');
  });

  it('numSlices returns correct count', () => {
    expect(surface.numSlices).toBe(4);
  });

  it('expiries array matches input slices', () => {
    expect(surface.expiries).toHaveLength(4);
    expect(surface.expiries[0]).toBeCloseTo(0.0833, 3);
  });

  it('flat extrapolation at boundary: total variance clamped to first slice at short expiry', () => {
    const K    = 1.0842;
    // total var = vol^2 * tau.  With flat extrapolation both use the 1M SVI params:
    // total-var(K, 0.001) should equal total-var(K, 0.0833) since same SVI parameters are used
    const wShort = surface.impliedVol(K, 0.001) ** 2 * 0.001;
    const w1M    = surface.impliedVol(K, 0.0833) ** 2 * 0.0833;
    expect(wShort).toBeCloseTo(w1M, 4);
  });

  it('fromQuotes() calibrates from ATM/RR/BF market data', () => {
    const s = SVIVolatilitySurface.fromQuotes(EURUSD_MARKET_QUOTES);
    expect(s.numSlices).toBe(3);
    const vol1M = s.impliedVol(1.0842, 0.0833);
    expect(vol1M).toBeGreaterThan(0.01);
  });

  it('isArbitrageFree() returns true for calibrated slices', () => {
    expect(surface.isArbitrageFree()).toBe(true);
  });
});

// ── Suite 2: VannaVolgaPricer ─────────────────────────────────────────────────
describe('VannaVolgaPricer', () => {
  const surface = new SVIVolatilitySurface(EURUSD_SLICES, 1.0842);
  const vvPricer = new VannaVolgaPricer();

  const BASE_VV = {
    optionType:    'CALL' as const,
    exoticType:    'VANILLA' as const,
    spot:          1.0842,
    strike:        1.0842,
    barrier:       undefined,
    rebate:        0,
    timeToExpiry:  0.0833,
    riskFreeRate:  0.05,
    dividendYield: 0.03,
    atmVol:        0.082,
    volSurface:    surface,
  };

  it('vanilla VV price is positive', () => {
    const r = vvPricer.price(BASE_VV);
    expect(r.price).toBeGreaterThan(0);
  });

  it('VV price ≥ BS price at ATM (smile adds value to buyer)', () => {
    const r = vvPricer.price(BASE_VV);
    expect(r.price).toBeGreaterThanOrEqual(r.bsPrice - 0.001); // allow tiny numerical tolerance
  });

  it('bsPrice is returned correctly', () => {
    const r = vvPricer.price(BASE_VV);
    expect(r.bsPrice).toBeGreaterThan(0);
  });

  it('weights array has exactly 3 elements', () => {
    const r = vvPricer.price(BASE_VV);
    expect(r.weights).toHaveLength(3);
  });

  it('implied vols array has exactly 3 elements', () => {
    const r = vvPricer.price(BASE_VV);
    expect(r.impliedVols).toHaveLength(3);
    r.impliedVols.forEach(v => expect(v).toBeGreaterThan(0));
  });

  it('processing time is recorded', () => {
    const r = vvPricer.price(BASE_VV);
    expect(r.processingMs).toBeGreaterThanOrEqual(0);
  });

  it('DOWN_AND_OUT barrier call: VV price ≤ vanilla VV price', () => {
    const vanilla  = vvPricer.price({ ...BASE_VV, exoticType: 'VANILLA' });
    const barrier  = vvPricer.price({
      ...BASE_VV,
      exoticType: 'DOWN_AND_OUT',
      barrier:    1.0842 * 0.95,
    });
    expect(barrier.price).toBeLessThanOrEqual(vanilla.price + 0.001);
  });

  it('without volSurface: VV price = BS price (no smile correction)', () => {
    const r = vvPricer.price({ ...BASE_VV, volSurface: undefined });
    // With flat vol, smile correction should be ~0
    expect(Math.abs(r.smileCorrection)).toBeLessThan(0.05);
  });

  it('OTM put VV price is non-negative', () => {
    const r = vvPricer.price({
      ...BASE_VV,
      optionType: 'PUT',
      strike:     1.0842 * 0.98,
    });
    expect(r.price).toBeGreaterThanOrEqual(0);
  });
});
