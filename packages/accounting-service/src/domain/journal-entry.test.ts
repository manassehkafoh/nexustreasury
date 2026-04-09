/**
 * JournalEntry aggregate — TDD test suite
 *
 * Verifies:
 *  1. Double-entry balance constraint (per-currency)
 *  2. State machine: DRAFT → POSTED → REVERSED
 *  3. Reversal creates exact offset entry
 *  4. Domain events emitted correctly
 *  5. Guard clauses reject invalid inputs
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TenantId, TradeId } from '@nexustreasury/domain';
import {
  JournalEntry,
  JournalEntryPostedEvent,
  JournalEntryReversedEvent,
  AccountingDomainError,
} from './journal-entry.aggregate.js';
import { EntryDirection, IFRS9Category, JournalEntryStatus } from './value-objects.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const TENANT = TenantId('t-001');
const TRADE_ID = TradeId('trade-abc');

function simpleBondEntry(amount = 1_000_000, ccy = 'USD') {
  return JournalEntry.create({
    tenantId: TENANT,
    sourceTradeId: TRADE_ID,
    valueDate: new Date('2026-04-09'),
    postingDate: new Date('2026-04-09'),
    description: 'Bond purchase — AMC',
    ifrs9Category: IFRS9Category.AMORTISED_COST,
    sourceSystem: 'TEST',
    lines: [
      {
        accountCode: '1300',
        accountName: 'Bond Asset — AMC',
        direction: EntryDirection.DEBIT,
        amount,
        currency: ccy,
      },
      {
        accountCode: '8100',
        accountName: 'Trade Date Clearing',
        direction: EntryDirection.CREDIT,
        amount,
        currency: ccy,
      },
    ],
  });
}

// ── Double-Entry Invariant ────────────────────────────────────────────────────

describe('JournalEntry — double-entry invariant', () => {
  it('accepts a balanced two-line entry', () => {
    expect(() => simpleBondEntry()).not.toThrow();
  });

  it('accepts a multi-line balanced entry', () => {
    expect(() =>
      JournalEntry.create({
        tenantId: TENANT,
        valueDate: new Date(),
        postingDate: new Date(),
        description: 'Multi-line entry',
        sourceSystem: 'TEST',
        lines: [
          {
            accountCode: '1300',
            accountName: 'Bond',
            direction: EntryDirection.DEBIT,
            amount: 600_000,
            currency: 'USD',
          },
          {
            accountCode: '1310',
            accountName: 'Bond',
            direction: EntryDirection.DEBIT,
            amount: 400_000,
            currency: 'USD',
          },
          {
            accountCode: '8100',
            accountName: 'Clear',
            direction: EntryDirection.CREDIT,
            amount: 1_000_000,
            currency: 'USD',
          },
        ],
      }),
    ).not.toThrow();
  });

  it('rejects an out-of-balance entry (diff > 0.005)', () => {
    expect(() =>
      JournalEntry.create({
        tenantId: TENANT,
        valueDate: new Date(),
        postingDate: new Date(),
        description: 'Unbalanced',
        sourceSystem: 'TEST',
        lines: [
          {
            accountCode: '1300',
            accountName: 'Bond',
            direction: EntryDirection.DEBIT,
            amount: 1_000_000,
            currency: 'USD',
          },
          {
            accountCode: '8100',
            accountName: 'Clear',
            direction: EntryDirection.CREDIT,
            amount: 999_990,
            currency: 'USD',
          },
        ],
      }),
    ).toThrow(AccountingDomainError);
  });

  it('accepts a near-balanced entry within half-cent tolerance (diff = 0.004)', () => {
    expect(() =>
      JournalEntry.create({
        tenantId: TENANT,
        valueDate: new Date(),
        postingDate: new Date(),
        description: 'Within tolerance',
        sourceSystem: 'TEST',
        lines: [
          {
            accountCode: '1300',
            accountName: 'Bond',
            direction: EntryDirection.DEBIT,
            amount: 1_000_000.004,
            currency: 'USD',
          },
          {
            accountCode: '8100',
            accountName: 'Clear',
            direction: EntryDirection.CREDIT,
            amount: 1_000_000,
            currency: 'USD',
          },
        ],
      }),
    ).not.toThrow();
  });

  it('validates balance per-currency (FX multi-currency entry)', () => {
    expect(() =>
      JournalEntry.create({
        tenantId: TENANT,
        valueDate: new Date(),
        postingDate: new Date(),
        description: 'FX Spot',
        sourceSystem: 'TEST',
        lines: [
          {
            accountCode: '1100',
            accountName: 'Nostro USD',
            direction: EntryDirection.DEBIT,
            amount: 1_084_200,
            currency: 'USD',
          },
          {
            accountCode: '1100',
            accountName: 'Nostro EUR',
            direction: EntryDirection.CREDIT,
            amount: 1_000_000,
            currency: 'EUR',
          },
          {
            accountCode: '1100',
            accountName: 'Nostro EUR',
            direction: EntryDirection.DEBIT,
            amount: 1_000_000,
            currency: 'EUR',
          },
          {
            accountCode: '1100',
            accountName: 'Nostro USD',
            direction: EntryDirection.CREDIT,
            amount: 1_084_200,
            currency: 'USD',
          },
        ],
      }),
    ).not.toThrow();
  });

  it('rejects entry with no debit lines', () => {
    expect(() =>
      JournalEntry.create({
        tenantId: TENANT,
        valueDate: new Date(),
        postingDate: new Date(),
        description: 'No debits',
        sourceSystem: 'TEST',
        lines: [
          {
            accountCode: '8100',
            accountName: 'Clear',
            direction: EntryDirection.CREDIT,
            amount: 100,
            currency: 'USD',
          },
          {
            accountCode: '1300',
            accountName: 'Bond',
            direction: EntryDirection.CREDIT,
            amount: 100,
            currency: 'USD',
          },
        ],
      }),
    ).toThrow(AccountingDomainError);
  });

  it('rejects zero-amount line', () => {
    expect(() =>
      JournalEntry.create({
        tenantId: TENANT,
        valueDate: new Date(),
        postingDate: new Date(),
        description: 'Zero amount',
        sourceSystem: 'TEST',
        lines: [
          {
            accountCode: '1300',
            accountName: 'Bond',
            direction: EntryDirection.DEBIT,
            amount: 0,
            currency: 'USD',
          },
          {
            accountCode: '8100',
            accountName: 'Clear',
            direction: EntryDirection.CREDIT,
            amount: 0,
            currency: 'USD',
          },
        ],
      }),
    ).toThrow(AccountingDomainError);
  });

  it('rejects single-line entry', () => {
    expect(() =>
      JournalEntry.create({
        tenantId: TENANT,
        valueDate: new Date(),
        postingDate: new Date(),
        description: 'Single line',
        sourceSystem: 'TEST',
        lines: [
          {
            accountCode: '1300',
            accountName: 'Bond',
            direction: EntryDirection.DEBIT,
            amount: 100,
            currency: 'USD',
          },
        ],
      }),
    ).toThrow(AccountingDomainError);
  });
});

// ── State Machine ─────────────────────────────────────────────────────────────

describe('JournalEntry — state machine', () => {
  it('starts in DRAFT status', () => {
    const je = simpleBondEntry();
    expect(je.status).toBe(JournalEntryStatus.DRAFT);
  });

  it('moves to POSTED after post()', () => {
    const je = simpleBondEntry();
    je.post();
    expect(je.status).toBe(JournalEntryStatus.POSTED);
  });

  it('cannot post an already-posted entry', () => {
    const je = simpleBondEntry();
    je.post();
    expect(() => je.post()).toThrow(AccountingDomainError);
  });

  it('emits JournalEntryPostedEvent on post()', () => {
    const je = simpleBondEntry();
    je.post();
    const events = je.drainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toBeInstanceOf(JournalEntryPostedEvent);
    expect((events[0] as JournalEntryPostedEvent).journalEntry.id).toBe(je.id);
  });

  it('drainEvents() clears events after drain', () => {
    const je = simpleBondEntry();
    je.post();
    je.drainEvents();
    expect(je.drainEvents()).toHaveLength(0);
  });
});

// ── Reversal ──────────────────────────────────────────────────────────────────

describe('JournalEntry — reversal', () => {
  it('creates a reversal entry that exactly offsets the original', () => {
    const original = simpleBondEntry(500_000);
    original.post();

    const reversal = original.reverse('Data entry error');

    expect(reversal.status).toBe(JournalEntryStatus.POSTED);
    expect(original.status).toBe(JournalEntryStatus.REVERSED);

    // Reversal lines have opposite directions
    const origLines = original.lines;
    const revLines = reversal.lines;
    expect(revLines).toHaveLength(origLines.length);

    for (let i = 0; i < origLines.length; i++) {
      expect(revLines[i].amount).toBe(origLines[i].amount);
      expect(revLines[i].currency).toBe(origLines[i].currency);
      expect(revLines[i].direction).not.toBe(origLines[i].direction);
    }
  });

  it('net effect of original + reversal is zero (DR total = CR total = 0)', () => {
    const original = simpleBondEntry(1_000_000);
    original.post();
    const reversal = original.reverse('Correction');

    const totalDR = original.debitTotal() + reversal.debitTotal();
    const totalCR = original.creditTotal() + reversal.creditTotal();

    // Each side: 1M (original) + 1M (reversal) = 2M
    expect(totalDR).toBeCloseTo(2_000_000, 2);
    expect(totalCR).toBeCloseTo(2_000_000, 2);
  });

  it('cannot reverse a DRAFT entry', () => {
    const je = simpleBondEntry();
    expect(() => je.reverse('Should fail')).toThrow(AccountingDomainError);
  });

  it('reversal emits JournalEntryReversedEvent', () => {
    const je = simpleBondEntry();
    je.post();
    je.drainEvents(); // clear posted event

    const reversal = je.reverse('Correction');
    const events = reversal.drainEvents();

    const reversedEvt = events.find(
      (e) => e instanceof JournalEntryReversedEvent,
    ) as JournalEntryReversedEvent;
    expect(reversedEvt).toBeDefined();
    expect(reversedEvt.originalEntryId).toBe(je.id);
  });
});

// ── Queries ───────────────────────────────────────────────────────────────────

describe('JournalEntry — query helpers', () => {
  it('debitTotal and creditTotal return correct sums', () => {
    const je = simpleBondEntry(750_000);
    expect(je.debitTotal('USD')).toBeCloseTo(750_000, 2);
    expect(je.creditTotal('USD')).toBeCloseTo(750_000, 2);
  });

  it('currencies() returns distinct currencies', () => {
    const je = JournalEntry.create({
      tenantId: TENANT,
      valueDate: new Date(),
      postingDate: new Date(),
      description: 'Multi-ccy',
      sourceSystem: 'TEST',
      lines: [
        {
          accountCode: '1100',
          accountName: 'Nostro USD',
          direction: EntryDirection.DEBIT,
          amount: 1_000,
          currency: 'USD',
        },
        {
          accountCode: '1100',
          accountName: 'Nostro EUR',
          direction: EntryDirection.CREDIT,
          amount: 900,
          currency: 'EUR',
        },
        {
          accountCode: '1100',
          accountName: 'Nostro EUR',
          direction: EntryDirection.DEBIT,
          amount: 900,
          currency: 'EUR',
        },
        {
          accountCode: '1100',
          accountName: 'Nostro USD',
          direction: EntryDirection.CREDIT,
          amount: 1_000,
          currency: 'USD',
        },
      ],
    });
    const ccys = je.currencies().sort();
    expect(ccys).toEqual(['EUR', 'USD']);
  });
});
