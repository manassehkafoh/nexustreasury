import { describe, it, expect } from 'vitest';
import { Position, PositionDomainError } from './position.aggregate.js';
import {
  PositionId,
  InstrumentId,
  BookId,
  TenantId,
  TraderId,
  CounterpartyId,
  Money,
  BusinessDate,
} from '../shared/value-objects.js';
import { Trade, AssetClass, TradeDirection } from '../trading/trade.aggregate.js';

const tenantId = TenantId('tenant-001');
const preDealCheck = {
  approved: true,
  limitUtilisationPct: 40,
  headroomAmount: Money.of(30_000_000, 'USD'),
  failureReasons: [],
  checkedAt: new Date(),
};

function makePosition(): Position {
  return Position.create({
    id: PositionId('pos-001'),
    tenantId,
    instrumentId: InstrumentId('instr-001'),
    bookId: BookId('book-001'),
    currency: 'USD',
    openDate: BusinessDate.today(),
  });
}

function buyTrade(notional: number): Trade {
  return Trade.book({
    tenantId,
    assetClass: AssetClass.FIXED_INCOME,
    direction: TradeDirection.BUY,
    counterpartyId: CounterpartyId('cpty-001'),
    instrumentId: InstrumentId('instr-001'),
    bookId: BookId('book-001'),
    traderId: TraderId('trader-001'),
    notional: Money.of(notional, 'USD'),
    price: 98.5,
    tradeDate: BusinessDate.today(),
    valueDate: BusinessDate.today().addDays(2),
    preDealCheck,
  });
}

describe('Position Aggregate', () => {
  it('starts at zero net quantity', () => {
    const pos = makePosition();
    expect(pos.netQuantity).toBe(0);
    expect(pos.isFlat).toBe(true);
  });

  it('getter id does not cause infinite recursion', () => {
    const pos = makePosition();
    expect(() => pos.id).not.toThrow();
    expect(pos.id).toBe('pos-001');
  });

  it('increases net quantity on BUY trade', () => {
    const pos = makePosition();
    const trade = buyTrade(1_000_000);
    pos.applyTradeBooked({ trade } as Parameters<typeof pos.applyTradeBooked>[0]);
    expect(pos.netQuantity).toBe(1_000_000);
    expect(pos.isFlat).toBe(false);
  });

  it('publishes PositionUpdatedEvent after trade applied', () => {
    const pos = makePosition();
    const trade = buyTrade(1_000_000);
    pos.applyTradeBooked({ trade } as Parameters<typeof pos.applyTradeBooked>[0]);
    const events = pos.pullDomainEvents();
    expect(events.some((e) => e.eventType === 'nexus.position.position.updated')).toBe(true);
  });

  it('revalue skips flat positions (no error, no event)', () => {
    const pos = makePosition();
    expect(() => pos.revalue(100)).not.toThrow();
    expect(pos.pullDomainEvents()).toHaveLength(0);
  });

  it('computes unrealised P&L after revalue', () => {
    const pos = makePosition();
    const trade = buyTrade(1_000_000);
    pos.applyTradeBooked({ trade } as Parameters<typeof pos.applyTradeBooked>[0]);
    pos.pullDomainEvents();
    pos.revalue(100); // price moved from 98.50 to 100
    expect(pos.unrealisedPnl.toNumber()).toBeCloseTo(1_500_000, 0);
  });
});
