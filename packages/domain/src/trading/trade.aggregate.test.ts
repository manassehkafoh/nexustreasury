import { describe, it, expect } from 'vitest';
import {
  Trade,
  AssetClass,
  TradeDirection,
  TradeStatus,
  TradeDomainError,
} from './trade.aggregate.js';
import {
  TenantId,
  CounterpartyId,
  InstrumentId,
  BookId,
  TraderId,
  Money,
  BusinessDate,
} from '../shared/value-objects.js';

const validBookParams = {
  tenantId: TenantId('tenant-001'),
  assetClass: AssetClass.FX,
  direction: TradeDirection.BUY,
  counterpartyId: CounterpartyId('cpty-001'),
  instrumentId: InstrumentId('instr-001'),
  bookId: BookId('book-001'),
  traderId: TraderId('trader-001'),
  notional: Money.of(1_000_000, 'USD'),
  price: 1.0842,
  tradeDate: BusinessDate.today(),
  valueDate: BusinessDate.today().addDays(2),
  preDealCheck: {
    approved: true,
    limitUtilisationPct: 45,
    headroomAmount: Money.of(27_500_000, 'USD'),
    failureReasons: [],
    checkedAt: new Date(),
  },
};

describe('Trade Aggregate', () => {
  describe('book()', () => {
    it('creates a trade when pre-deal check passes', () => {
      const trade = Trade.book(validBookParams);
      expect(trade.status).toBe(TradeStatus.PENDING_VALIDATION);
      expect(trade.assetClass).toBe(AssetClass.FX);
      expect(trade.notional.toNumber()).toBe(1_000_000);
    });

    it('throws when pre-deal check fails', () => {
      expect(() =>
        Trade.book({
          ...validBookParams,
          preDealCheck: {
            approved: false,
            limitUtilisationPct: 105,
            headroomAmount: Money.of(0, 'USD'),
            failureReasons: ['Counterparty limit exceeded'],
            checkedAt: new Date(),
          },
        }),
      ).toThrow(TradeDomainError);
    });

    it('throws when notional is zero', () => {
      expect(() => Trade.book({ ...validBookParams, notional: Money.of(0, 'USD') })).toThrow(
        TradeDomainError,
      );
    });

    it('publishes TradeBookedEvent after booking', () => {
      const trade = Trade.book(validBookParams);
      const events = trade.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0]?.eventType).toBe('nexus.trading.trade.booked');
    });
  });

  describe('cancel()', () => {
    it('cancels a pending trade', () => {
      const trade = Trade.book(validBookParams);
      trade.pullDomainEvents(); // clear
      trade.cancel('Dealer error');
      expect(trade.status).toBe(TradeStatus.CANCELLED);
      const events = trade.pullDomainEvents();
      expect(events[0]?.eventType).toBe('nexus.trading.trade.cancelled');
    });

    it('throws when cancelling settled trade', () => {
      const trade = Trade.book(validBookParams);
      // Force to confirmed+settled via casting
      (trade as unknown as { _props: { status: TradeStatus } })._props.status =
        TradeStatus.VALIDATED;
      trade.confirm();
      trade.settle();
      expect(() => trade.cancel('too late')).toThrow(TradeDomainError);
    });
  });

  describe('Money value object', () => {
    it('adds correctly without floating point errors', () => {
      const a = Money.of(0.1, 'USD');
      const b = Money.of(0.2, 'USD');
      expect(a.add(b).toNumber()).toBe(0.3);
    });

    it('rejects cross-currency operations', () => {
      const usd = Money.of(100, 'USD');
      const eur = Money.of(100, 'EUR');
      expect(() => usd.add(eur)).toThrow('Currency mismatch');
    });
  });
});
