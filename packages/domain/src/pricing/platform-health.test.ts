/**
 * @file platform-health.test.ts
 * @description Cross-sprint functional invariants — verified against source interfaces.
 */
import { describe, it, expect } from 'vitest';
import {
  PricingEngine,
  YieldCurve,
  Money,
  OptionType,
  SVIVolatilitySurface,
  VannaVolgaPricer,
  WasmExoticPricerPool,
  Limit,
  LimitType,
  LimitLevel,
  Percentage,
  TenantId,
  LiquidityGapReport,
  ALMScenario,
  LiquidityTimeBucket,
  BusinessDate,
} from '../index.js';

const flat = (r: number, n: string) =>
  YieldCurve.fromPillars(
    [
      { tenorYears: 0.25, zeroRate: r },
      { tenorYears: 1, zeroRate: r },
      { tenorYears: 5, zeroRate: r },
      { tenorYears: 10, zeroRate: r },
    ],
    n,
  );
const M = (v: number) => Money.of(v, 'USD');
const tid = () => TenantId('bank-001');

// ─────────────────────────────────────────────────────────────────────────────
describe('FX Pricer — CIP invariants', () => {
  const e = new PricingEngine();
  it('forward > spot when USD rate > EUR rate', () => {
    const f = e.priceFXForward({
      spotRate: 1.0842,
      domesticCurve: flat(0.05, 'USD'),
      foreignCurve: flat(0.03, 'EUR'),
      notional: Money.of(1e6, 'EUR'),
      baseCurrency: 'EUR',
      termCurrency: 'USD',
      tenorYears: 1.0,
    });
    expect(f.forwardRate).toBeGreaterThan(1.0842);
    expect(Math.abs(f.forwardRate - 1.0842 * Math.exp(0.02))).toBeLessThan(0.001);
  });
  it('forward ≈ spot when rates equal', () => {
    const f = e.priceFXForward({
      spotRate: 1.0842,
      domesticCurve: flat(0.05, 'D2'),
      foreignCurve: flat(0.05, 'F2'),
      notional: Money.of(1e6, 'EUR'),
      baseCurrency: 'EUR',
      termCurrency: 'USD',
      tenorYears: 1.0,
    });
    expect(Math.abs(f.forwardRate - 1.0842)).toBeLessThan(0.001);
  });
});

describe('Bond Pricer — price/yield inverse', () => {
  const e = new PricingEngine();
  it('premium bond: dirtyPrice > face (coupon 5% on 4% curve)', () => {
    const b = e.priceBond({
      faceValue: 1e6,
      couponRate: 0.05,
      frequency: 2,
      residualYears: 5,
      curve: flat(0.04, 'c1'),
    });
    expect(b.dirtyPrice).toBeGreaterThan(1e6);
    expect(b.dv01).toBeGreaterThan(0);
    expect(b.modifiedDuration).toBeGreaterThan(0);
    expect(b.convexity).toBeGreaterThan(0);
  });
  it('discount bond: dirtyPrice < face (coupon 3% on 5% curve)', () => {
    const b = e.priceBond({
      faceValue: 1e6,
      couponRate: 0.03,
      frequency: 2,
      residualYears: 5,
      curve: flat(0.05, 'c2'),
    });
    expect(b.dirtyPrice).toBeLessThan(1e6);
  });
  it('longer tenor → higher modified duration', () => {
    const b5 = e.priceBond({
      faceValue: 1e6,
      couponRate: 0.05,
      frequency: 2,
      residualYears: 5,
      curve: flat(0.05, 'c3'),
    });
    const b10 = e.priceBond({
      faceValue: 1e6,
      couponRate: 0.05,
      frequency: 2,
      residualYears: 10,
      curve: flat(0.05, 'c4'),
    });
    expect(b10.modifiedDuration).toBeGreaterThan(b5.modifiedDuration);
  });
});

describe('IRS Pricer — at-par and directional', () => {
  const e = new PricingEngine();
  const usd = flat(0.05, 'USD');
  const swap = (fixedRate: number, isPayer: boolean) => ({
    notional: 1e7,
    fixedRate,
    tenorYears: 5,
    fixedFrequency: 2,
    floatFrequency: 4,
    discountCurve: usd,
    forwardCurve: usd,
    isPayer,
  });
  it('at-par NPV ≈ 0', () => {
    const par = e.parSwapRate(usd, 5);
    expect(Math.abs(e.priceIRS(swap(par, true)))).toBeLessThan(1000);
  });
  it('payer NPV < 0 when paying above par rate', () => {
    const par = e.parSwapRate(usd, 5);
    expect(e.priceIRS(swap(par + 0.01, true))).toBeLessThan(0);
  });
  it('receiver NPV > 0 when receiving above par rate', () => {
    const par = e.parSwapRate(usd, 5);
    expect(e.priceIRS(swap(par + 0.01, false))).toBeGreaterThan(0);
  });
});

describe('Option Pricer — Greeks and put-call parity', () => {
  const e = new PricingEngine();
  const C = e.priceOption({
    optionType: OptionType.CALL,
    spot: 100,
    strike: 100,
    timeToExpiry: 1,
    riskFreeRate: 0.05,
    dividendYield: 0,
    volatility: 0.2,
  });
  const P = e.priceOption({
    optionType: OptionType.PUT,
    spot: 100,
    strike: 100,
    timeToExpiry: 1,
    riskFreeRate: 0.05,
    dividendYield: 0,
    volatility: 0.2,
  });
  it('call delta ∈ (0,1)', () => {
    expect(C.delta).toBeGreaterThan(0);
    expect(C.delta).toBeLessThan(1);
  });
  it('gamma > 0', () => expect(C.gamma).toBeGreaterThan(0));
  it('vega > 0', () => expect(C.vega).toBeGreaterThan(0));
  it('put-call parity', () =>
    expect(Math.abs(C.price - P.price - (100 - 100 * Math.exp(-0.05)))).toBeLessThan(0.01));
  it('implied vol round-trip = 20%', () => {
    const iv = e.impliedVolatility({
      optionType: OptionType.CALL,
      spot: 100,
      strike: 100,
      timeToExpiry: 1,
      riskFreeRate: 0.05,
      dividendYield: 0,
      marketPrice: C.price,
    });
    expect(Math.abs(iv - 0.2)).toBeLessThan(0.0001);
  });
});

describe('Sprint 7 — Exotic Pricer: barrier, lookback, Bermudan, pool', () => {
  const e = new PricingEngine();
  const vanilla = e.priceOption({
    optionType: OptionType.CALL,
    spot: 100,
    strike: 100,
    timeToExpiry: 1,
    riskFreeRate: 0.05,
    dividendYield: 0,
    volatility: 0.2,
  });
  it('DOWN_AND_OUT ≤ vanilla', () => {
    const b = e.priceBarrierOption({
      optionType: 'CALL',
      barrierType: 'DOWN_AND_OUT',
      spot: 100,
      strike: 100,
      barrier: 90,
      rebate: 0,
      timeToExpiry: 1,
      riskFreeRate: 0.05,
      dividendYield: 0,
      volatility: 0.2,
    });
    expect(b.price).toBeGreaterThanOrEqual(0);
    expect(b.price).toBeLessThanOrEqual(vanilla.price + 0.001);
    expect(b.isKnockedOut).toBe(false);
  });
  it('knocked-out barrier price ≈ 0', () => {
    const b = e.priceBarrierOption({
      optionType: 'CALL',
      barrierType: 'DOWN_AND_OUT',
      spot: 85,
      strike: 100,
      barrier: 90,
      rebate: 0,
      timeToExpiry: 1,
      riskFreeRate: 0.05,
      dividendYield: 0,
      volatility: 0.2,
    });
    expect(b.isKnockedOut).toBe(true);
    expect(b.price).toBeCloseTo(0, 4);
  });
  it('lookback call price > 0', () => {
    expect(
      e.priceLookbackOption({
        optionType: 'CALL',
        lookbackType: 'FLOATING',
        spot: 100,
        runningExtreme: 95,
        timeToExpiry: 1,
        riskFreeRate: 0.05,
        dividendYield: 0,
        volatility: 0.2,
      }).price,
    ).toBeGreaterThan(0);
  });
  it('Bermudan payer price > 0 (ITM)', () => {
    const b = e.priceBermudanSwaption({
      swaptionType: 'PAYER',
      notional: 1e6,
      fixedRate: 0.05,
      currentSwapRate: 0.055,
      swaptionVol: 0.2,
      discountRate: 0.05,
      numPaths: 500,
      exerciseDates: [
        { timeToExercise: 1, remainingTenor: 4 },
        { timeToExercise: 2, remainingTenor: 3 },
      ],
    });
    expect(b.price).toBeGreaterThan(0);
    expect(b.exerciseProbs).toHaveLength(2);
  });
  it('WasmExoticPricerPool: poolSize=4, 0 fallbacks on 10 requests', () => {
    const pool = new WasmExoticPricerPool({ poolSize: 4 });
    for (let i = 0; i < 10; i++)
      pool.priceBarrier({
        optionType: 'CALL',
        barrierType: 'DOWN_AND_OUT',
        spot: 100,
        strike: 100,
        barrier: 90,
        rebate: 0,
        timeToExpiry: 1,
        riskFreeRate: 0.05,
        dividendYield: 0,
        volatility: 0.2,
      });
    expect(pool.totalRequests).toBe(10);
    expect(pool.fallbackInvocations).toBe(0);
  });
});

describe('Sprint 8.4 — SVI Vol Surface + Vanna-Volga', () => {
  it('ATM vol from calibration is in (1%,50%)', () => {
    const s = SVIVolatilitySurface.fromQuotes([
      { tau: 0.0833, atmVol: 0.082, rr25: -0.0025, bf25: 0.0003, forward: 1.0842 },
    ]);
    expect(s.impliedVol(1.0842, 0.0833)).toBeGreaterThan(0.01);
    expect(s.impliedVol(1.0842, 0.0833)).toBeLessThan(0.5);
  });
  it('VV price ≥ 0 with surface', () => {
    const s = SVIVolatilitySurface.fromQuotes([
      { tau: 0.0833, atmVol: 0.082, rr25: -0.0025, bf25: 0.0003, forward: 1.0842 },
    ]);
    const r = new VannaVolgaPricer().price({
      optionType: 'CALL',
      exoticType: 'VANILLA',
      spot: 1.0842,
      strike: 1.0842,
      rebate: 0,
      timeToExpiry: 0.0833,
      riskFreeRate: 0.05,
      dividendYield: 0.03,
      atmVol: 0.082,
      volSurface: s,
    });
    expect(r.price).toBeGreaterThanOrEqual(0);
    expect(r.weights).toHaveLength(3);
  });
});

describe('Risk — Limit class (correct name: Limit, not LimitAggregate)', () => {
  const makeLimit = () =>
    Limit.create({
      tenantId: tid(),
      limitType: LimitType.COUNTERPARTY_CREDIT,
      level: LimitLevel.COUNTERPARTY,
      limitAmount: M(1_000_000),
      warningThreshold: Percentage.of(80),
      entityId: 'cp-acme-001',
    });

  it('created at 0% utilisation', () => {
    expect(makeLimit().utilisationPct).toBe(0);
  });
  it('pre-deal check approves within hard limit', () => {
    const r = makeLimit().checkPreDeal({ requestedExposure: M(500_000), tenantId: tid() });
    expect(r.approved).toBe(true);
  });
  it('pre-deal check rejects over hard limit', () => {
    const r = makeLimit().checkPreDeal({ requestedExposure: M(1_500_000), tenantId: tid() });
    expect(r.approved).toBe(false);
    expect(r.failureReasons.length).toBeGreaterThan(0);
  });
  it('utilise fires LimitBreachedEvent when > hard limit', () => {
    const l = makeLimit();
    l.utilise(M(1_100_000));
    expect(l.pullDomainEvents().some((e) => e.eventType.includes('breached'))).toBe(true);
  });
});

describe('ALM — LiquidityGapReport (r.lcr/r.nsfr, r.buckets[].cumulativeGap)', () => {
  const today = BusinessDate.fromDate(new Date('2026-04-09'));
  const base = () =>
    LiquidityGapReport.generate({
      tenantId: tid(),
      asOfDate: today,
      scenario: ALMScenario.CONTRACTUAL,
      currency: 'USD',
      rawBuckets: [{ bucket: LiquidityTimeBucket.OVERNIGHT, inflows: 500_000, outflows: 150_000 }],
      lcrComponents: {
        hqlaLevel1: M(500_000_000),
        hqlaLevel2A: M(0),
        hqlaLevel2B: M(0),
        netCashOutflows30d: M(50_000_000),
      },
      nsfrComponents: {
        availableStableFunding: M(800_000_000),
        requiredStableFunding: M(600_000_000),
      },
    });

  it('LCR ratio > 100% (HQLA=500M / outflows=50M = 1000%)', () => {
    expect(base().lcr.lcrRatio).toBeGreaterThan(100);
    expect(base().lcr.isCompliant).toBe(true);
  });
  it('NSFR ratio > 100% (ASF=800M / RSF=600M ≈ 133%)', () => {
    expect(base().nsfr.nsfrRatio).toBeGreaterThan(100);
    expect(base().nsfr.isCompliant).toBe(true);
  });
  it('LCR < 100% when HQLA insufficient', () => {
    const r = LiquidityGapReport.generate({
      tenantId: tid(),
      asOfDate: today,
      scenario: ALMScenario.STRESSED_30D,
      currency: 'USD',
      rawBuckets: [{ bucket: LiquidityTimeBucket.OVERNIGHT, inflows: 0, outflows: 100_000 }],
      lcrComponents: {
        hqlaLevel1: M(40_000_000),
        hqlaLevel2A: M(0),
        hqlaLevel2B: M(0),
        netCashOutflows30d: M(100_000_000),
      },
      nsfrComponents: {
        availableStableFunding: M(500_000_000),
        requiredStableFunding: M(600_000_000),
      },
    });
    expect(r.lcr.lcrRatio).toBeLessThan(100);
    expect(r.lcr.isCompliant).toBe(false);
  });
  it('bucket cumulativeGap is negative for net outflow', () => {
    const r = LiquidityGapReport.generate({
      tenantId: tid(),
      asOfDate: today,
      scenario: ALMScenario.CONTRACTUAL,
      currency: 'USD',
      rawBuckets: [{ bucket: LiquidityTimeBucket.OVERNIGHT, inflows: 0, outflows: 300_000 }],
      lcrComponents: {
        hqlaLevel1: M(100_000_000),
        hqlaLevel2A: M(0),
        hqlaLevel2B: M(0),
        netCashOutflows30d: M(10_000_000),
      },
      nsfrComponents: {
        availableStableFunding: M(700_000_000),
        requiredStableFunding: M(600_000_000),
      },
    });
    const onBucket = r.buckets.find((b) => b.bucket === LiquidityTimeBucket.OVERNIGHT);
    expect(onBucket?.cumulativeGap.amount).toBeLessThan(0);
  });
});
