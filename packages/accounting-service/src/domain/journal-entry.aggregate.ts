/**
 * @module accounting-service/domain/journal-entry.aggregate
 *
 * JournalEntry — the core aggregate root of the Accounting bounded context.
 *
 * Design rules (enforced by invariants):
 *  1. Double-entry: Σ(DR amounts) = Σ(CR amounts) — always.
 *  2. Immutability: once POSTED, a JournalEntry cannot be mutated.
 *     Corrections are made by posting a reversal entry (same lines, flipped DR/CR).
 *  3. Multi-currency: a single JE can span multiple currencies (common for FX trades).
 *     The balance constraint applies per-currency: Σ(DR_ccy) = Σ(CR_ccy) for each ccy.
 *  4. Tenancy: every JE belongs to exactly one tenant (multi-tenancy enforced at DB layer).
 *
 * Event sourcing: posting emits JournalEntryPostedEvent consumed by the GL read model.
 *
 * @see IAS 1 §§ 82–105 — Statement of Comprehensive Income presentation
 * @see IFRS 9 §5.7    — Presentation of financial instruments
 */

import { randomUUID } from 'crypto';
import { DomainEvent, type TenantId, type TradeId } from '@nexustreasury/domain';
import {
  AccountId,
  EntryDirection,
  JournalEntryId,
  JournalEntryStatus,
  type IFRS9Category,
} from './value-objects.js';

// ── Journal Entry Line ────────────────────────────────────────────────────────

/**
 * A single debit or credit line within a journal entry.
 * Lines are immutable once the entry is posted.
 */
export interface JournalEntryLine {
  readonly lineId: string;
  readonly accountId: AccountId;
  readonly accountCode: string;
  readonly accountName: string;
  readonly direction: EntryDirection;
  /** Absolute amount (always positive; direction conveys sign) */
  readonly amount: number;
  readonly currency: string; // ISO 4217
  readonly description?: string;
}

// ── Domain Events ─────────────────────────────────────────────────────────────

export class JournalEntryPostedEvent extends DomainEvent {
  constructor(
    public readonly journalEntry: JournalEntry,
    public readonly sourceTradeId: TradeId | null,
  ) {
    super('nexus.accounting.journal-entry.posted', journalEntry.id, journalEntry.tenantId);
  }
}

export class JournalEntryReversedEvent extends DomainEvent {
  constructor(
    public readonly originalEntryId: JournalEntryId,
    public readonly reversalEntry: JournalEntry,
  ) {
    super('nexus.accounting.journal-entry.reversed', reversalEntry.id, reversalEntry.tenantId);
  }
}

// ── Domain Errors ─────────────────────────────────────────────────────────────

export class AccountingDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AccountingDomainError';
  }
}

// ── JournalEntry Aggregate Root ───────────────────────────────────────────────

/** Input for constructing a single entry line */
export interface LineInput {
  accountCode: string;
  accountName: string;
  direction: EntryDirection;
  amount: number; // positive float
  currency: string;
  description?: string;
}

/** Input for creating a new journal entry */
export interface CreateJournalEntryInput {
  tenantId: TenantId;
  sourceTradeId?: TradeId;
  valueDate: Date;
  postingDate: Date;
  description: string;
  lines: LineInput[];
  /** IFRS9 category for instrument-level tagging */
  ifrs9Category?: IFRS9Category;
  /** Source system reference (e.g. 'TRADE-SERVICE', 'POSITION-SERVICE') */
  sourceSystem: string;
  /** External reference for cross-system linking */
  externalRef?: string;
  /** AI-generated narrative (optional — from accounting-explanation AI hook) */
  aiNarrative?: string;
}

export class JournalEntry {
  readonly id: JournalEntryId;
  readonly tenantId: TenantId;
  readonly sourceTradeId: TradeId | null;
  readonly valueDate: Date;
  readonly postingDate: Date;
  readonly description: string;
  readonly ifrs9Category?: IFRS9Category;
  readonly sourceSystem: string;
  readonly externalRef?: string;
  readonly aiNarrative?: string;
  readonly createdAt: Date;

  private _status: JournalEntryStatus;
  private _lines: JournalEntryLine[];
  private _events: DomainEvent[];
  private _reversalOf?: JournalEntryId;

  private constructor(
    id: JournalEntryId,
    input: Omit<CreateJournalEntryInput, 'lines'>,
    lines: JournalEntryLine[],
  ) {
    this.id = id;
    this.tenantId = input.tenantId;
    this.sourceTradeId = input.sourceTradeId ?? null;
    this.valueDate = input.valueDate;
    this.postingDate = input.postingDate;
    this.description = input.description;
    this.ifrs9Category = input.ifrs9Category;
    this.sourceSystem = input.sourceSystem;
    this.externalRef = input.externalRef;
    this.aiNarrative = input.aiNarrative;
    this.createdAt = new Date();
    this._status = JournalEntryStatus.DRAFT;
    this._lines = lines;
    this._events = [];
  }

  // ── Factory ───────────────────────────────────────────────────────────────

  /**
   * Create a new DRAFT journal entry.
   *
   * Lines are validated for:
   *  - At least one debit and one credit line
   *  - Per-currency balance: Σ(DR_ccy) = Σ(CR_ccy) ± 0.005 (half-cent tolerance)
   *  - No zero-amount lines
   *  - No negative amounts
   */
  static create(input: CreateJournalEntryInput): JournalEntry {
    JournalEntry.validateLines(input.lines);

    const lines: JournalEntryLine[] = input.lines.map((l) => ({
      lineId: randomUUID(),
      accountId: AccountId(l.accountCode),
      accountCode: l.accountCode,
      accountName: l.accountName,
      direction: l.direction,
      amount: l.amount,
      currency: l.currency,
      description: l.description,
    }));

    return new JournalEntry(JournalEntryId(randomUUID()), input, lines);
  }

  // ── Command: post ─────────────────────────────────────────────────────────

  /**
   * Post (commit) the journal entry to the general ledger.
   * Once posted, the entry is immutable. Use reverse() to correct errors.
   */
  post(): void {
    if (this._status !== JournalEntryStatus.DRAFT) {
      throw new AccountingDomainError(
        'JE_NOT_DRAFT',
        `Cannot post journal entry ${this.id}: status is ${this._status}`,
      );
    }
    this._status = JournalEntryStatus.POSTED;
    this._events.push(new JournalEntryPostedEvent(this, this.sourceTradeId));
  }

  // ── Command: reverse ──────────────────────────────────────────────────────

  /**
   * Create a reversal entry that exactly offsets this journal entry.
   * Each line has its DR/CR direction flipped.
   * Both the original and reversal are marked REVERSED.
   */
  reverse(reason: string): JournalEntry {
    if (this._status !== JournalEntryStatus.POSTED) {
      throw new AccountingDomainError(
        'JE_NOT_POSTED',
        `Cannot reverse journal entry ${this.id}: status is ${this._status}`,
      );
    }

    const reversalLines: LineInput[] = this._lines.map((l) => ({
      accountCode: l.accountCode,
      accountName: l.accountName,
      direction:
        l.direction === EntryDirection.DEBIT ? EntryDirection.CREDIT : EntryDirection.DEBIT,
      amount: l.amount,
      currency: l.currency,
      description: `REVERSAL: ${l.description ?? ''}`.trim(),
    }));

    const reversal = JournalEntry.create({
      tenantId: this.tenantId,
      sourceTradeId: this.sourceTradeId ?? undefined,
      valueDate: this.valueDate,
      postingDate: new Date(),
      description: `REVERSAL of ${this.id}: ${reason}`,
      lines: reversalLines,
      ifrs9Category: this.ifrs9Category,
      sourceSystem: this.sourceSystem,
      externalRef: this.externalRef,
    });

    reversal._reversalOf = this.id;
    this._status = JournalEntryStatus.REVERSED;

    reversal.post();
    reversal._events.push(new JournalEntryReversedEvent(this.id, reversal));

    return reversal;
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  get status(): JournalEntryStatus {
    return this._status;
  }
  get lines(): readonly JournalEntryLine[] {
    return this._lines;
  }
  get reversalOf(): JournalEntryId | undefined {
    return this._reversalOf;
  }

  /** Drain and clear accumulated domain events (call after publishing to Kafka) */
  drainEvents(): DomainEvent[] {
    const events = [...this._events];
    this._events = [];
    return events;
  }

  /** Debit total for a given currency (or all currencies if omitted) */
  debitTotal(currency?: string): number {
    return this._lines
      .filter((l) => l.direction === EntryDirection.DEBIT && (!currency || l.currency === currency))
      .reduce((sum, l) => sum + l.amount, 0);
  }

  /** Credit total for a given currency */
  creditTotal(currency?: string): number {
    return this._lines
      .filter(
        (l) => l.direction === EntryDirection.CREDIT && (!currency || l.currency === currency),
      )
      .reduce((sum, l) => sum + l.amount, 0);
  }

  /** Distinct currencies used in this entry */
  currencies(): string[] {
    return [...new Set(this._lines.map((l) => l.currency))];
  }

  // ── Invariant Validation ──────────────────────────────────────────────────

  /**
   * Validate double-entry balance per currency.
   * Throws AccountingDomainError if any currency's DR ≠ CR.
   */
  private static validateLines(lines: LineInput[]): void {
    if (lines.length < 2) {
      throw new AccountingDomainError('JE_MIN_LINES', 'A journal entry requires at least 2 lines');
    }

    const hasDR = lines.some((l) => l.direction === EntryDirection.DEBIT);
    const hasCR = lines.some((l) => l.direction === EntryDirection.CREDIT);
    if (!hasDR || !hasCR) {
      throw new AccountingDomainError(
        'JE_MISSING_DIRECTION',
        'A journal entry must have at least one debit line and one credit line',
      );
    }

    for (const line of lines) {
      if (line.amount <= 0) {
        throw new AccountingDomainError(
          'JE_NEGATIVE_AMOUNT',
          `Line amount must be positive; got ${line.amount} on account ${line.accountCode}`,
        );
      }
    }

    // Per-currency balance check
    const currencies = [...new Set(lines.map((l) => l.currency))];
    for (const ccy of currencies) {
      const dr = lines
        .filter((l) => l.currency === ccy && l.direction === EntryDirection.DEBIT)
        .reduce((s, l) => s + l.amount, 0);
      const cr = lines
        .filter((l) => l.currency === ccy && l.direction === EntryDirection.CREDIT)
        .reduce((s, l) => s + l.amount, 0);

      if (Math.abs(dr - cr) > 0.005) {
        throw new AccountingDomainError(
          'JE_OUT_OF_BALANCE',
          `Journal entry out of balance for ${ccy}: DR=${dr.toFixed(4)}, CR=${cr.toFixed(4)}, diff=${(dr - cr).toFixed(4)}`,
        );
      }
    }
  }
}

// ── Repository Interface ──────────────────────────────────────────────────────

export interface JournalEntryRepository {
  save(entry: JournalEntry): Promise<void>;
  findById(id: JournalEntryId): Promise<JournalEntry | null>;
  findByTradeId(tradeId: TradeId, tenantId: TenantId): Promise<JournalEntry[]>;
  findByDateRange(from: Date, to: Date, tenantId: TenantId): Promise<JournalEntry[]>;
}
