import { describe, it, expect, beforeEach } from 'vitest';
import { FXAutoHedger, HedgeStrategy, DealStatus, type CustomerFXDeal, type CustomerDealingLimit } from './fx-auto-hedger.js';

const mkDeal = (overrides: Partial<CustomerFXDeal> = {}): CustomerFXDeal => ({
  dealId:'D001', customerId:'C001', baseCurrency:'EUR', quoteCurrency:'USD',
  side:'BUY', notional:500_000, valueDate:'2026-04-10', channel:'WEB', indicativeRate:1.0842,
  ...overrides,
});
const mkLimit = (overrides: Partial<CustomerDealingLimit> = {}): CustomerDealingLimit => ({
  customerId:'C001', maxDealSize:1_000_000, dailyLimit:3_000_000, utilised:0, currency:'USD', ...overrides,
});

describe('FXAutoHedger — Sprint 10-B (FIS FX portal gap closure)', () => {
  let hedger: FXAutoHedger;
  beforeEach(() => { hedger = new FXAutoHedger({ strategy: HedgeStrategy.FULL_COVER }); });

  it('processes a valid BUY deal and returns HEDGED status', () => {
    hedger.setLimit(mkLimit());
    const r = hedger.processDeal(mkDeal());
    expect(r.status).toBe(DealStatus.HEDGED);
  });

  it('customer BUY rate > indicative rate (spread applied upward)', () => {
    hedger.setLimit(mkLimit());
    const r = hedger.processDeal(mkDeal({ side:'BUY' }));
    expect(r.customerRate).toBeGreaterThan(1.0842);
  });

  it('customer SELL rate < indicative rate (spread applied downward)', () => {
    hedger.setLimit(mkLimit());
    const r = hedger.processDeal(mkDeal({ side:'SELL' }));
    expect(r.customerRate).toBeLessThan(1.0842);
  });

  it('locked profit > 0 for all deals', () => {
    hedger.setLimit(mkLimit());
    const r = hedger.processDeal(mkDeal());
    expect(r.lockedProfit).toBeGreaterThan(0);
  });

  it('FULL_COVER strategy generates hedgeRef immediately', () => {
    hedger.setLimit(mkLimit());
    const r = hedger.processDeal(mkDeal());
    expect(r.hedgeRef).toBeDefined();
    expect(r.hedgeRef).toContain('HLDG');
  });

  it('rejects deal exceeding single deal size limit', () => {
    hedger.setLimit(mkLimit({ maxDealSize: 100_000 }));
    const r = hedger.processDeal(mkDeal({ notional: 500_000 }));
    expect(r.status).toBe(DealStatus.FAILED_LIMIT);
    expect(r.failureReason).toBeDefined();
  });

  it('rejects deal when daily limit would be breached', () => {
    hedger.setLimit(mkLimit({ dailyLimit: 300_000, utilised: 200_000 }));
    const r = hedger.processDeal(mkDeal({ notional: 200_000 }));
    expect(r.status).toBe(DealStatus.FAILED_LIMIT);
  });

  it('daily utilisation accumulates across sequential deals', () => {
    hedger.setLimit(mkLimit({ dailyLimit: 1_200_000, utilised: 0 }));
    hedger.processDeal(mkDeal({ dealId:'D001', notional:500_000 }));
    hedger.processDeal(mkDeal({ dealId:'D002', notional:500_000 }));
    const r3 = hedger.processDeal(mkDeal({ dealId:'D003', notional:500_000 }));
    expect(r3.status).toBe(DealStatus.FAILED_LIMIT); // 1.5M > 1.2M limit
  });

  it('THRESHOLD strategy does not generate hedgeRef below threshold', () => {
    const h = new FXAutoHedger({ strategy: HedgeStrategy.THRESHOLD, thresholdUSD: 2_000_000 });
    const r = h.processDeal(mkDeal({ notional: 500_000 }));
    expect(r.hedgeRef).toBeUndefined();
  });

  it('getPortfolios returns portfolio for processed currency pair', () => {
    hedger.setLimit(mkLimit());
    hedger.processDeal(mkDeal());
    const portfolios = hedger.getPortfolios();
    expect(portfolios.some(p => p.currencyPair === 'EUR/USD')).toBe(true);
  });

  it('net exposure is positive after a BUY deal', () => {
    hedger.setLimit(mkLimit());
    hedger.processDeal(mkDeal({ side:'BUY', notional:500_000 }));
    const p = hedger.getPortfolios().find(x => x.currencyPair === 'EUR/USD')!;
    expect(p.netExposure).toBeGreaterThan(0);
  });

  it('net exposure is negative after a SELL deal', () => {
    const h2 = new FXAutoHedger({ strategy: HedgeStrategy.THRESHOLD, thresholdUSD: 5_000_000 });
    h2.processDeal(mkDeal({ side:'SELL', notional:500_000 }));
    const p = h2.getPortfolios().find(x => x.currencyPair === 'EUR/USD')!;
    expect(p.netExposure).toBeLessThan(0);
  });

  it('processing time is recorded', () => {
    hedger.setLimit(mkLimit());
    const r = hedger.processDeal(mkDeal());
    expect(r.processingMs).toBeGreaterThanOrEqual(0);
  });

  it('deal without limit set still processes (no limit = unlimited)', () => {
    const r = hedger.processDeal(mkDeal()); // no limit set
    expect(r.status).toBe(DealStatus.HEDGED);
  });

  it('getLimits returns all registered limits', () => {
    hedger.setLimit(mkLimit({ customerId:'C001' }));
    hedger.setLimit(mkLimit({ customerId:'C002' }));
    expect(hedger.getLimits()).toHaveLength(2);
  });
});
