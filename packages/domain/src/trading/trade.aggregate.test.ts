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

// ── Additional coverage: amend, cancel, settle, confirm, accessors ──────────

const amendParams = {
  ...validBookParams,
  preDealCheck: {
    approved: true,
    limitUtilisationPct: 40,
    headroomAmount: Money.of(30_000_000, 'USD'),
    failureReasons: [],
    checkedAt: new Date(),
  },
};

describe('Trade.amend()', () => {
  it('updates notional and price, status becomes AMENDED', () => {
    const trade = Trade.book(amendParams);
    trade.pullDomainEvents();
    trade.amend(Money.of(2_000_000, 'USD'), 1.09);
    expect(trade.notional.toNumber()).toBe(2_000_000);
    expect(trade.price).toBe(1.09);
    expect(trade.status).toBe(TradeStatus.AMENDED);
  });

  it('increments version on amend', () => {
    const trade = Trade.book(amendParams);
    const v0 = trade.version;
    trade.pullDomainEvents();
    trade.amend(Money.of(2_000_000, 'USD'), 1.09);
    expect(trade.version).toBe(v0 + 1);
  });

  it('emits TradeAmendedEvent', () => {
    const trade = Trade.book(amendParams);
    trade.pullDomainEvents();
    trade.amend(Money.of(2_000_000, 'USD'), 1.09);
    const events = trade.pullDomainEvents();
    expect(events.some((e) => e.eventType === 'nexus.trading.trade.amended')).toBe(true);
  });

  it('throws when amending a settled trade', () => {
    const trade = Trade.book({ ...amendParams, preDealCheck: amendParams.preDealCheck });
    (trade as unknown as { _props: { status: string } })._props.status = TradeStatus.SETTLED;
    expect(() => trade.amend(Money.of(1, 'USD'), 1)).toThrow(TradeDomainError);
  });

  it('throws when amending a cancelled trade', () => {
    const trade = Trade.book(amendParams);
    trade.pullDomainEvents();
    trade.cancel('test');
    trade.pullDomainEvents();
    expect(() => trade.amend(Money.of(1, 'USD'), 1)).toThrow(TradeDomainError);
  });
});

describe('Trade.cancel()', () => {
  it('sets status to CANCELLED and emits event', () => {
    const trade = Trade.book(amendParams);
    trade.pullDomainEvents();
    trade.cancel('wrong counterparty');
    expect(trade.status).toBe(TradeStatus.CANCELLED);
    const events = trade.pullDomainEvents();
    expect(events.some((e) => e.eventType === 'nexus.trading.trade.cancelled')).toBe(true);
  });

  it('throws when cancelling a settled trade', () => {
    const trade = Trade.book(amendParams);
    (trade as unknown as { _props: { status: string } })._props.status = TradeStatus.SETTLED;
    expect(() => trade.cancel('reason')).toThrow(TradeDomainError);
  });
});

describe('Trade.settle()', () => {
  it('settles a confirmed trade and emits TradeSettledEvent', () => {
    const trade = Trade.book(amendParams);
    (trade as unknown as { _props: { status: string } })._props.status = TradeStatus.CONFIRMED;
    trade.pullDomainEvents();
    trade.settle();
    expect(trade.status).toBe(TradeStatus.SETTLED);
    const events = trade.pullDomainEvents();
    expect(events.some((e) => e.eventType === 'nexus.trading.trade.settled')).toBe(true);
  });

  it('throws when settling an unconfirmed trade', () => {
    const trade = Trade.book(amendParams);
    expect(() => trade.settle()).toThrow(TradeDomainError);
  });
});

describe('Trade.confirm()', () => {
  it('confirms a validated trade', () => {
    const trade = Trade.book(amendParams);
    (trade as unknown as { _props: { status: string } })._props.status = TradeStatus.VALIDATED;
    trade.pullDomainEvents();
    trade.confirm();
    expect(trade.status).toBe(TradeStatus.CONFIRMED);
  });

  it('throws when confirming a non-validated trade', () => {
    const trade = Trade.book(amendParams);
    expect(() => trade.confirm()).toThrow(TradeDomainError);
  });
});

describe('Trade accessors', () => {
  it('exposes all expected properties', () => {
    const trade = Trade.book(amendParams);
    expect(trade.id).toBeDefined();
    expect(trade.tenantId).toBeDefined();
    expect(trade.reference).toMatch(/^FX-/);
    expect(trade.assetClass).toBe(AssetClass.FX);
    expect(trade.direction).toBe(TradeDirection.BUY);
    expect(trade.counterpartyId).toBeDefined();
    expect(trade.instrumentId).toBeDefined();
    expect(trade.bookId).toBeDefined();
    expect(trade.traderId).toBeDefined();
    expect(trade.notional.toNumber()).toBe(1_000_000);
    expect(trade.price).toBe(1.0842);
    expect(trade.tradeDate).toBeDefined();
    expect(trade.valueDate).toBeDefined();
    expect(trade.maturityDate).toBeUndefined();
    expect(trade.createdAt).toBeInstanceOf(Date);
    expect(trade.version).toBeGreaterThanOrEqual(1);
  });
});

describe('Trade.pullDomainEvents()', () => {
  it('clears events after pulling', () => {
    const trade = Trade.book(amendParams);
    trade.pullDomainEvents();
    expect(trade.pullDomainEvents()).toHaveLength(0);
  });
});
