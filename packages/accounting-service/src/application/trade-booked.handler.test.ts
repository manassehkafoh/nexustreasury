/**
 * TradeBookedHandler — TDD test suite
 *
 * Verifies journal entry generation for each asset class:
 *  - Bond BUY (AMC): Dr Bond Asset | Cr Trade Date Clearing
 *  - Bond SELL: reversed
 *  - Money Market placement: Dr MM Placement | Cr Nostro
 *  - MM borrowing: Dr Nostro | Cr MM Borrowings
 *  - FX Spot BUY: Dr Nostro (base ccy) | Cr Nostro (term ccy) [multi-ccy]
 *  - IRS at-par: no entries
 *  - IRS with premium: Dr IRS Asset | Cr Nostro
 *  - Repo: Dr Nostro | Cr Repo Liability
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AssetClass } from '@nexustreasury/domain';
import { TradeBookedHandler, type TradeBookedEvent } from './trade-booked.handler.js';
import { ChartOfAccounts } from '../domain/chart-of-accounts.js';
import { type JournalEntryRepository } from '../domain/journal-entry.aggregate.js';
import { JournalEntryStatus, EntryDirection, IFRS9Category } from '../domain/value-objects.js';

// ── Mock Repository ───────────────────────────────────────────────────────────

class InMemoryJERepository implements JournalEntryRepository {
  public entries: import('../domain/journal-entry.aggregate.js').JournalEntry[] = [];

  async save(e: import('../domain/journal-entry.aggregate.js').JournalEntry) {
    this.entries.push(e);
  }
  async findById() {
    return null;
  }
  async findByTradeId() {
    return [];
  }
  async findByDateRange() {
    return [];
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseEvent: TradeBookedEvent = {
  eventType: 'nexus.trading.trade.booked',
  tradeId: 'trade-001',
  tenantId: 'tenant-001',
  assetClass: AssetClass.FIXED_INCOME,
  instrumentType: 'BOND',
  direction: 'BUY',
  notional: 1_000_000,
  currency: 'USD',
  tradeDate: '2026-04-09',
  valueDate: '2026-04-11',
  bookId: 'book-htc',
  traderId: 'trader-001',
  counterpartyId: 'cp-001',
};

// ── Test Setup ────────────────────────────────────────────────────────────────

let repo: InMemoryJERepository;
let handler: TradeBookedHandler;

beforeEach(() => {
  repo = new InMemoryJERepository();
  handler = new TradeBookedHandler(ChartOfAccounts.standard(), repo);
});

// ── Fixed Income ──────────────────────────────────────────────────────────────

describe('TradeBookedHandler — Bond BUY (AMC)', () => {
  it('generates one journal entry', async () => {
    const entries = await handler.handle(baseEvent);
    expect(entries).toHaveLength(1);
  });

  it('entry is posted', async () => {
    const [je] = await handler.handle(baseEvent);
    expect(je.status).toBe(JournalEntryStatus.POSTED);
  });

  it('entry is balanced (DR = CR = 1,000,000)', async () => {
    const [je] = await handler.handle(baseEvent);
    expect(je.debitTotal('USD')).toBeCloseTo(1_000_000, 2);
    expect(je.creditTotal('USD')).toBeCloseTo(1_000_000, 2);
  });

  it('debits the bond asset account', async () => {
    const [je] = await handler.handle(baseEvent);
    const drLine = je.lines.find((l) => l.direction === EntryDirection.DEBIT);
    expect(drLine?.accountCode).toBe('1300'); // Bond AMC
  });

  it('credits the trade date clearing account', async () => {
    const [je] = await handler.handle(baseEvent);
    const crLine = je.lines.find((l) => l.direction === EntryDirection.CREDIT);
    expect(crLine?.accountCode).toBe('8100'); // Trade Date Clearing
  });

  it('entry is saved to repository', async () => {
    await handler.handle(baseEvent);
    expect(repo.entries).toHaveLength(1);
  });
});

describe('TradeBookedHandler — Bond SELL', () => {
  it('reverses DR/CR direction for a sell', async () => {
    const [je] = await handler.handle({ ...baseEvent, direction: 'SELL' });
    const crLine = je.lines.find((l) => l.direction === EntryDirection.CREDIT);
    expect(crLine?.accountCode).toBe('1300'); // Bond credited on sale
  });
});

// ── Money Market ──────────────────────────────────────────────────────────────

describe('TradeBookedHandler — Money Market Placement', () => {
  it('generates balanced entry: Dr MM Placement | Cr Nostro', async () => {
    const [je] = await handler.handle({
      ...baseEvent,
      assetClass: AssetClass.MONEY_MARKET,
      instrumentType: 'DEPOSIT',
    });
    const drLine = je.lines.find((l) => l.direction === EntryDirection.DEBIT);
    const crLine = je.lines.find((l) => l.direction === EntryDirection.CREDIT);
    expect(drLine?.accountCode).toBe('1500'); // MM Placement
    expect(crLine?.accountCode).toBe('1100'); // Nostro
  });

  it('generates balanced entry for MM borrowing (SELL direction)', async () => {
    const [je] = await handler.handle({
      ...baseEvent,
      assetClass: AssetClass.MONEY_MARKET,
      instrumentType: 'DEPOSIT',
      direction: 'SELL',
    });
    const drLine = je.lines.find((l) => l.direction === EntryDirection.DEBIT);
    const crLine = je.lines.find((l) => l.direction === EntryDirection.CREDIT);
    expect(drLine?.accountCode).toBe('1100'); // Nostro — cash in
    expect(crLine?.accountCode).toBe('2300'); // MM Borrowings
  });
});

// ── IRS ───────────────────────────────────────────────────────────────────────

describe('TradeBookedHandler — IRS at par (no premium)', () => {
  it('generates no journal entries for at-market IRS (NPV = 0)', async () => {
    const entries = await handler.handle({
      ...baseEvent,
      assetClass: AssetClass.INTEREST_RATE_DERIVATIVE,
      instrumentType: 'IRS',
      price: 0, // at-market
    });
    expect(entries).toHaveLength(0);
  });
});

// ── FX Spot ───────────────────────────────────────────────────────────────────

describe('TradeBookedHandler — FX Spot', () => {
  it('generates multi-currency balanced entry', async () => {
    const [je] = await handler.handle({
      ...baseEvent,
      assetClass: AssetClass.FX,
      instrumentType: 'SPOT',
      direction: 'BUY',
      notional: 1_000_000,
      currency: 'EUR',
      counterpartyCurrency: 'USD',
      price: 1.0842, // EURUSD
    });
    // Check EUR balance
    expect(je.debitTotal('EUR')).toBeCloseTo(1_000_000, 2);
    expect(je.creditTotal('EUR')).toBeCloseTo(1_000_000, 2);
    // Check USD balance
    const usdAmount = 1_000_000 * 1.0842;
    expect(je.debitTotal('USD')).toBeCloseTo(usdAmount, 2);
    expect(je.creditTotal('USD')).toBeCloseTo(usdAmount, 2);
  });
});

// ── Repo ──────────────────────────────────────────────────────────────────────

describe('TradeBookedHandler — Repo', () => {
  it('generates Dr Nostro | Cr Settlement Payable for repo (sell securities)', async () => {
    const [je] = await handler.handle({
      ...baseEvent,
      assetClass: AssetClass.REPO,
      instrumentType: 'REPO',
      direction: 'SELL',
    });
    const drLine = je.lines.find((l) => l.direction === EntryDirection.DEBIT);
    const crLine = je.lines.find((l) => l.direction === EntryDirection.CREDIT);
    expect(drLine?.accountCode).toBe('1100'); // Nostro — cash received
    expect(crLine?.accountCode).toBe('2900'); // Repo liability
  });
});
