/**
 * CorporateActionsService — TDD test suite
 */
import { describe, it, expect } from 'vitest';
import {
  CorporateActionsService,
  LifecycleEventType,
  LifecycleEventStatus,
} from './corporate-actions.service.js';
import { AssetClass } from '@nexustreasury/domain';

const svc = new CorporateActionsService();
const TODAY = new Date('2026-04-09');

const BOND_TRADE = {
  tradeId: 'trade-bond-001',
  tenantId: 'tenant-001',
  assetClass: AssetClass.FIXED_INCOME,
  instrumentType: 'BOND',
  direction: 'BUY' as const,
  notional: 1_000_000,
  currency: 'USD',
  couponRate: 0.05,
  frequency: 2,
  tradeRef: 'FI-20260101-A1',
  counterpartyId: 'cp-001',
  isCorporateClient: false,
};

const IRS_TRADE = {
  tradeId: 'trade-irs-001',
  tenantId: 'tenant-001',
  assetClass: AssetClass.INTEREST_RATE_DERIVATIVE,
  instrumentType: 'IRS',
  direction: 'BUY' as const, // receiver: receive float, pay fixed
  notional: 10_000_000,
  currency: 'USD',
  fixedRate: 0.04,
  floatingRate: 0.042,
  frequency: 4,
  tradeRef: 'IRS-20260101-B2',
  counterpartyId: 'cp-002',
  isCorporateClient: false,
};

// ── Coupon Payment ────────────────────────────────────────────────────────────

describe('CorporateActionsService — COUPON_PAYMENT', () => {
  it('generates one cash flow for a coupon payment', async () => {
    const result = await svc.process(BOND_TRADE, LifecycleEventType.COUPON_PAYMENT, TODAY);
    expect(result.cashFlows).toHaveLength(1);
    expect(result.status).toBe(LifecycleEventStatus.PROCESSED);
  });

  it('coupon amount = notional × rate / frequency', async () => {
    const result = await svc.process(BOND_TRADE, LifecycleEventType.COUPON_PAYMENT, TODAY);
    // 1_000_000 × 0.05 / 2 = 25_000
    expect(result.cashFlows[0]!.amount).toBeCloseTo(25_000, 2);
  });

  it('positive cash flow for BUY (receiver)', async () => {
    const result = await svc.process(BOND_TRADE, LifecycleEventType.COUPON_PAYMENT, TODAY);
    expect(result.cashFlows[0]!.amount).toBeGreaterThan(0);
  });

  it('negative cash flow for SELL (issuer/short)', async () => {
    const result = await svc.process(
      { ...BOND_TRADE, direction: 'SELL' },
      LifecycleEventType.COUPON_PAYMENT,
      TODAY,
    );
    expect(result.cashFlows[0]!.amount).toBeLessThan(0);
  });

  it('requires SWIFT for coupon payment', async () => {
    const result = await svc.process(BOND_TRADE, LifecycleEventType.COUPON_PAYMENT, TODAY);
    expect(result.cashFlows[0]!.requiresSwift).toBe(true);
  });
});

// ── Principal Repayment ───────────────────────────────────────────────────────

describe('CorporateActionsService — PRINCIPAL_REPAYMENT', () => {
  it('generates principal + final coupon cash flows', async () => {
    const result = await svc.process(BOND_TRADE, LifecycleEventType.PRINCIPAL_REPAYMENT, TODAY);
    // 2 flows: principal + final coupon
    expect(result.cashFlows).toHaveLength(2);
  });

  it('principal cash flow = notional', async () => {
    const result = await svc.process(BOND_TRADE, LifecycleEventType.PRINCIPAL_REPAYMENT, TODAY);
    const principal = result.cashFlows.find((cf) => cf.amount === BOND_TRADE.notional);
    expect(principal).toBeDefined();
  });

  it('sets newTradeStatus to MATURED', async () => {
    const result = await svc.process(BOND_TRADE, LifecycleEventType.PRINCIPAL_REPAYMENT, TODAY);
    expect(result.newTradeStatus).toBe('MATURED');
  });

  it('publishes correct Kafka event type', async () => {
    const result = await svc.process(BOND_TRADE, LifecycleEventType.PRINCIPAL_REPAYMENT, TODAY);
    expect(result.kafkaEvent['lifecycleEvent']).toBe(LifecycleEventType.PRINCIPAL_REPAYMENT);
  });
});

// ── IRS Swap Reset ────────────────────────────────────────────────────────────

describe('CorporateActionsService — SWAP_RESET', () => {
  it('generates one net cash flow for swap reset', async () => {
    const result = await svc.process(IRS_TRADE, LifecycleEventType.SWAP_RESET, TODAY);
    expect(result.cashFlows).toHaveLength(1);
  });

  it('net cash flow = (floatRate - fixedRate) × notional / freq for receiver', async () => {
    const result = await svc.process(IRS_TRADE, LifecycleEventType.SWAP_RESET, TODAY);
    // (0.042 - 0.040) × 10_000_000 / 4 = 0.002 × 10M / 4 = 5_000
    expect(result.cashFlows[0]!.amount).toBeCloseTo(5_000, 1);
  });

  it('payer gets negative net cash flow when float > fixed', async () => {
    const result = await svc.process(
      { ...IRS_TRADE, direction: 'SELL' },
      LifecycleEventType.SWAP_RESET,
      TODAY,
    );
    expect(result.cashFlows[0]!.amount).toBeCloseTo(-5_000, 1);
  });
});

// ── Option Expiry / Maturity ──────────────────────────────────────────────────

describe('CorporateActionsService — option / maturity events', () => {
  it('option expiry generates no cash flows', async () => {
    const result = await svc.process(
      { ...BOND_TRADE, assetClass: AssetClass.FX, instrumentType: 'OPTION' },
      LifecycleEventType.FX_OPTION_EXPIRY,
      TODAY,
    );
    expect(result.cashFlows).toHaveLength(0);
    expect(result.newTradeStatus).toBe('EXPIRED');
  });

  it('option exercise status is EXERCISED', async () => {
    const result = await svc.process(
      { ...BOND_TRADE, assetClass: AssetClass.FX, instrumentType: 'OPTION' },
      LifecycleEventType.FX_OPTION_EXERCISE,
      TODAY,
    );
    expect(result.newTradeStatus).toBe('EXERCISED');
  });
});

// ── Deposit Maturity ─────────────────────────────────────────────────────────

describe('CorporateActionsService — DEPOSIT_MATURITY', () => {
  const MM_TRADE = {
    ...BOND_TRADE,
    assetClass: AssetClass.MONEY_MARKET,
    instrumentType: 'DEPOSIT',
    couponRate: 0.04,
    frequency: undefined,
  };

  it('generates one cash flow with principal + interest', async () => {
    const result = await svc.process(MM_TRADE, LifecycleEventType.DEPOSIT_MATURITY, TODAY);
    expect(result.cashFlows).toHaveLength(1);
    // 1_000_000 + 1_000_000 × 0.04 = 1_040_000
    expect(result.cashFlows[0]!.amount).toBeCloseTo(1_040_000, 0);
  });

  it('sets newTradeStatus to MATURED', async () => {
    const result = await svc.process(MM_TRADE, LifecycleEventType.DEPOSIT_MATURITY, TODAY);
    expect(result.newTradeStatus).toBe('MATURED');
  });
});

// ── Kafka Event Structure ─────────────────────────────────────────────────────

describe('CorporateActionsService — Kafka event', () => {
  it('Kafka event contains all required fields', async () => {
    const result = await svc.process(BOND_TRADE, LifecycleEventType.COUPON_PAYMENT, TODAY);
    expect(result.kafkaEvent['eventId']).toBeTruthy();
    expect(result.kafkaEvent['tradeId']).toBe('trade-bond-001');
    expect(result.kafkaEvent['tenantId']).toBe('tenant-001');
    expect(result.kafkaEvent['lifecycleEvent']).toBe(LifecycleEventType.COUPON_PAYMENT);
    expect(Array.isArray(result.kafkaEvent['cashFlows'])).toBe(true);
  });
});
