/**
 * NexusTreasury — Core Domain Models
 * ============================================================================
 * Architecture: Domain-Driven Design (DDD)
 * Pattern: Aggregates, Value Objects, Domain Events, Repository pattern
 * Language: TypeScript 5.x with strict mode
 * Testing: Test-Driven Design (TDD) — tests accompany each domain class
 *
 * File structure:
 *   packages/domain/src/
 *     ├── shared/              — Shared kernel (base classes, value objects)
 *     ├── trading/             — Trading bounded context
 *     ├── position/            — Position bounded context
 *     ├── risk/                — Risk bounded context
 *     ├── alm/                 — ALM bounded context
 *     └── platform/            — Platform context (RBAC, audit)
 * ============================================================================
 */

// ============================================================================
// SHARED KERNEL — Base classes used across all bounded contexts
// ============================================================================

/**
 * Base class for all Domain Events.
 * Every state change in the system produces a domain event that is published
 * to Kafka for consumption by other bounded contexts.
 *
 * @example
 * class TradeCreatedEvent extends DomainEvent {
 *   constructor(public readonly trade: Trade) {
 *     super('nexus.trading.trades.created', trade.id.value)
 *   }
 * }
 */
export abstract class DomainEvent {
  /** Unique event ID for idempotency checking */
  public readonly eventId: string;
  /** ISO 8601 timestamp when event occurred */
  public readonly occurredAt: Date;
  /** Version of this event schema (for schema evolution) */
  public readonly schemaVersion: number = 1;

  constructor(
    /** Kafka topic name this event belongs to */
    public readonly eventType: string,
    /** ID of the aggregate that produced this event */
    public readonly aggregateId: string,
  ) {
    // Generate a UUID v4 for each event for deduplication
    this.eventId = crypto.randomUUID();
    this.occurredAt = new Date();
  }
}

/**
 * Branded string type for type-safe IDs.
 * Prevents accidental mixing of different ID types (TradeId vs PositionId)
 * at compile time via TypeScript's structural typing + brand pattern.
 *
 * @example
 * function getPosition(id: PositionId): Position { ... }
 * const tradeId = TradeId.create('abc-123')
 * getPosition(tradeId) // ❌ TypeScript compile error — types are incompatible
 */
type Brand<T, B extends string> = T & { readonly __brand: B };

export type TradeId = Brand<string, 'TradeId'>;
export type PositionId = Brand<string, 'PositionId'>;
export type CounterpartyId = Brand<string, 'CounterpartyId'>;
export type InstrumentId = Brand<string, 'InstrumentId'>;
export type BookId = Brand<string, 'BookId'>;
export type LegalEntityId = Brand<string, 'LegalEntityId'>;
export type TenantId = Brand<string, 'TenantId'>;
export type LimitId = Brand<string, 'LimitId'>;
export type UserId = Brand<string, 'UserId'>;

/** Helper functions to safely create branded IDs with validation */
export const TradeId = {
  create: (value: string): TradeId => {
    if (!value || value.length === 0) throw new Error('TradeId cannot be empty');
    return value as TradeId;
  },
  generate: (): TradeId => crypto.randomUUID() as TradeId,
};

export const PositionId = {
  create: (value: string): PositionId => value as PositionId,
  generate: (): PositionId => crypto.randomUUID() as PositionId,
};

/**
 * Money Value Object — represents an immutable monetary amount with currency.
 * Encapsulates business rules:
 *   - Amounts are always positive (use direction/sign separately)
 *   - Currency must be a valid 3-letter ISO 4217 code
 *   - Arithmetic preserves currency (no cross-currency operations without FX)
 *
 * @example
 * const premium = Money.of(250000, 'USD')
 * const fee = Money.of(1000, 'USD')
 * const total = premium.add(fee) // Money.of(251000, 'USD')
 */
export class Money {
  private constructor(
    private readonly _amount: number,
    private readonly _currency: string,
  ) {}

  /** Factory method — validates inputs before construction */
  static of(amount: number, currency: string): Money {
    // Validate currency is a 3-letter uppercase ISO code
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new InvalidCurrencyError(currency);
    }
    // Prevent floating-point precision issues by rounding to 10 decimal places
    return new Money(Math.round(amount * 1e10) / 1e10, currency);
  }

  /** Create a zero amount in the given currency */
  static zero(currency: string): Money {
    return Money.of(0, currency);
  }

  get amount(): number { return this._amount; }
  get currency(): string { return this._currency; }

  /** Add two Money values — currencies must match */
  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this._amount + other._amount, this._currency);
  }

  /** Subtract Money values — currencies must match */
  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this._amount - other._amount, this._currency);
  }

  /** Multiply by a scalar (e.g., price × notional) */
  multiply(factor: number): Money {
    return Money.of(this._amount * factor, this._currency);
  }

  /** Check if amount is positive (inflow) */
  isPositive(): boolean { return this._amount > 0; }

  /** Check if amount is negative (outflow) */
  isNegative(): boolean { return this._amount < 0; }

  /** Value object equality — same amount AND same currency */
  equals(other: Money): boolean {
    return this._amount === other._amount && this._currency === other._currency;
  }

  toString(): string {
    return `${this._currency} ${this._amount.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 8,
    })}`;
  }

  toJSON() {
    return { amount: this._amount, currency: this._currency };
  }

  private assertSameCurrency(other: Money): void {
    if (this._currency !== other._currency) {
      throw new CurrencyMismatchError(this._currency, other._currency);
    }
  }
}

/**
 * Percentage Value Object — represents a percentage with validation.
 * Used for rates, haircuts, runoff factors, etc.
 * Stored as decimal (0.05 = 5%), with human-readable display.
 */
export class Percentage {
  private constructor(private readonly _value: number) {}

  /**
   * @param value - decimal representation (0.05 = 5%)
   * @throws if value is NaN or outside valid range for the given context
   */
  static ofDecimal(value: number): Percentage {
    if (isNaN(value) || !isFinite(value)) {
      throw new Error(`Invalid percentage value: ${value}`);
    }
    return new Percentage(value);
  }

  /** Create from basis points (100 bps = 1% = 0.01) */
  static ofBasisPoints(bps: number): Percentage {
    return new Percentage(bps / 10000);
  }

  get value(): number { return this._value; }
  get basisPoints(): number { return Math.round(this._value * 10000); }
  get displayValue(): number { return this._value * 100; }

  equals(other: Percentage): boolean {
    return Math.abs(this._value - other._value) < 1e-10;
  }

  toString(): string {
    return `${(this._value * 100).toFixed(4)}%`;
  }
}

/**
 * BusinessDate Value Object — wraps Date with business day semantics.
 * Used for trade dates, value dates, maturity dates.
 * Enforces that dates are valid calendar dates (no undefined/NaN).
 */
export class BusinessDate {
  private constructor(private readonly _date: Date) {}

  static from(date: Date): BusinessDate {
    if (isNaN(date.getTime())) throw new Error('Invalid date');
    return new BusinessDate(new Date(date));
  }

  static fromString(dateString: string): BusinessDate {
    const date = new Date(dateString + 'T00:00:00Z');
    return BusinessDate.from(date);
  }

  static today(): BusinessDate {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return new BusinessDate(today);
  }

  get value(): Date { return new Date(this._date); }

  /** ISO 8601 date string (YYYY-MM-DD) */
  get isoString(): string {
    return this._date.toISOString().split('T')[0];
  }

  /** Check if this date is before another */
  isBefore(other: BusinessDate): boolean {
    return this._date < other._date;
  }

  /** Check if this date is after another */
  isAfter(other: BusinessDate): boolean {
    return this._date > other._date;
  }

  /** Days between two dates (used for accruals, day count) */
  daysBetween(other: BusinessDate): number {
    const msPerDay = 86400000;
    return Math.round((other._date.getTime() - this._date.getTime()) / msPerDay);
  }

  equals(other: BusinessDate): boolean {
    return this._date.getTime() === other._date.getTime();
  }

  toString(): string { return this.isoString; }
}

// ============================================================================
// TRADING BOUNDED CONTEXT
// ============================================================================

/**
 * Enumeration of supported asset classes.
 * Drives instrument categorization, booking rules, and risk classification.
 */
export enum AssetClass {
  FX = 'FX',
  FIXED_INCOME = 'FIXED_INCOME',
  MONEY_MARKET = 'MONEY_MARKET',
  INTEREST_RATE_DERIVATIVE = 'INTEREST_RATE_DERIVATIVE',
  EQUITY = 'EQUITY',
  COMMODITY = 'COMMODITY',
  REPO = 'REPO',
  ISLAMIC = 'ISLAMIC',
}

/**
 * Enumeration of trade direction.
 * Direction determines cash flow sign convention in all calculations.
 */
export enum TradeDirection {
  BUY = 'BUY',
  SELL = 'SELL',
  LEND = 'LEND',
  BORROW = 'BORROW',
  PAY = 'PAY',    // Pay fixed in an IRS
  RECEIVE = 'RECEIVE',  // Receive fixed in an IRS
}

/**
 * Trade Status — represents the lifecycle state of a trade.
 * Valid transitions: DRAFT → CONFIRMED → AMENDED | CANCELLED
 *                   CONFIRMED → SETTLED
 */
export enum TradeStatus {
  DRAFT = 'DRAFT',
  CONFIRMED = 'CONFIRMED',
  AMENDED = 'AMENDED',
  CANCELLED = 'CANCELLED',
  SETTLED = 'SETTLED',
  MATURED = 'MATURED',
}

/**
 * Pre-Deal Check Result Value Object.
 * Immutable result from the pre-deal limit check engine.
 * Contains decision (approved/rejected) and supporting data.
 */
export class PreDealCheckResult {
  private constructor(
    public readonly approved: boolean,
    public readonly limitId: LimitId | null,
    public readonly limitType: string | null,
    public readonly limitAmount: Money | null,
    public readonly utilisedAmount: Money | null,
    public readonly headroom: Money | null,
    public readonly overrideAllowed: boolean,
    public readonly reason: string | null,
  ) {}

  static approved(
    limitId: LimitId,
    limitAmount: Money,
    utilisedAmount: Money,
  ): PreDealCheckResult {
    return new PreDealCheckResult(
      true, limitId, null, limitAmount, utilisedAmount,
      limitAmount.subtract(utilisedAmount), false, null,
    );
  }

  static rejected(
    limitId: LimitId,
    limitType: string,
    limitAmount: Money,
    utilisedAmount: Money,
    overrideAllowed: boolean,
  ): PreDealCheckResult {
    return new PreDealCheckResult(
      false, limitId, limitType, limitAmount, utilisedAmount,
      limitAmount.subtract(utilisedAmount), overrideAllowed,
      `Trade would breach ${limitType} limit`,
    );
  }
}

/**
 * Trade Aggregate Root — the central entity of the Trading bounded context.
 *
 * Domain Rules enforced by this aggregate:
 *   1. A trade cannot be booked without a successful pre-deal check
 *   2. Value date must be on or after trade date
 *   3. Maturity date (if present) must be after value date
 *   4. Cancelled trades cannot be amended
 *   5. Settled trades cannot be cancelled
 *   6. Notional must be positive
 *
 * This class uses the event-sourcing pattern — all state changes
 * are recorded as domain events and published to Kafka.
 *
 * @example
 * const result = await preDealService.check(params)
 * const trade = Trade.book(params, result)
 * await tradeRepository.save(trade)
 * // Trade.domainEvents contains TradeCreatedEvent for Kafka publishing
 */
export class Trade {
  /** Accumulated domain events to be published after successful persistence */
  private _domainEvents: DomainEvent[] = [];

  private constructor(
    public readonly id: TradeId,
    public readonly tenantId: TenantId,
    public readonly legalEntityId: LegalEntityId,
    public readonly instrumentId: InstrumentId,
    public readonly counterpartyId: CounterpartyId,
    public readonly bookId: BookId,
    public readonly tradeRef: string,
    public readonly assetClass: AssetClass,
    private _direction: TradeDirection,
    private _notional: Money,
    private _price: number,
    private _tradeDate: BusinessDate,
    private _valueDate: BusinessDate,
    private _maturityDate: BusinessDate | null,
    private _status: TradeStatus,
    private _tradeTerms: Record<string, unknown>,
    public readonly createdBy: UserId,
    public readonly createdAt: Date,
    private _updatedAt: Date,
    private _version: number,
  ) {}

  /**
   * Factory method — the ONLY way to create a new trade.
   * Enforces all booking invariants and produces a TradeCreatedEvent.
   *
   * @param params - All parameters required to book the trade
   * @param preDealResult - Result from pre-deal check service
   * @returns A new Trade aggregate with pending domain events
   * @throws TradeBookingError if any invariant is violated
   */
  static book(
    params: {
      tenantId: TenantId;
      legalEntityId: LegalEntityId;
      instrumentId: InstrumentId;
      counterpartyId: CounterpartyId;
      bookId: BookId;
      assetClass: AssetClass;
      direction: TradeDirection;
      notional: Money;
      price: number;
      tradeDate: BusinessDate;
      valueDate: BusinessDate;
      maturityDate?: BusinessDate;
      tradeTerms?: Record<string, unknown>;
      bookedBy: UserId;
    },
    preDealResult: PreDealCheckResult,
  ): Trade {
    // Invariant 1: Pre-deal check must pass (or override explicitly approved)
    if (!preDealResult.approved) {
      throw new PreDealLimitBreachError(
        preDealResult.limitType!,
        preDealResult.limitAmount!,
        preDealResult.utilisedAmount!,
      );
    }

    // Invariant 2: Notional must be strictly positive
    if (!params.notional.isPositive()) {
      throw new TradeBookingError('Trade notional must be positive');
    }

    // Invariant 3: Value date must be on or after trade date
    if (params.valueDate.isBefore(params.tradeDate)) {
      throw new TradeBookingError(
        `Value date ${params.valueDate} cannot be before trade date ${params.tradeDate}`,
      );
    }

    // Invariant 4: Maturity date must be after value date (if provided)
    if (params.maturityDate && params.maturityDate.isBefore(params.valueDate)) {
      throw new TradeBookingError(
        `Maturity date ${params.maturityDate} cannot be before value date ${params.valueDate}`,
      );
    }

    const now = new Date();
    const trade = new Trade(
      TradeId.generate(),
      params.tenantId,
      params.legalEntityId,
      params.instrumentId,
      params.counterpartyId,
      params.bookId,
      Trade.generateTradeRef(params.assetClass, params.tradeDate),
      params.assetClass,
      params.direction,
      params.notional,
      params.price,
      params.tradeDate,
      params.valueDate,
      params.maturityDate ?? null,
      TradeStatus.CONFIRMED,
      params.tradeTerms ?? {},
      params.bookedBy,
      now,
      now,
      1,  // Initial version = 1 (optimistic locking)
    );

    // Record the TradeCreatedEvent for async Kafka publishing
    trade._domainEvents.push(new TradeCreatedEvent(trade));

    return trade;
  }

  /**
   * Amend a trade — applies changes and records an amendment event.
   * @throws TradeAmendmentError if trade is in a non-amendable state
   */
  amend(
    changes: {
      notional?: Money;
      price?: number;
      valueDate?: BusinessDate;
      maturityDate?: BusinessDate;
      tradeTerms?: Record<string, unknown>;
    },
    amendedBy: UserId,
    reason: string,
  ): void {
    // Invariant: Cannot amend cancelled or settled trades
    if (this._status === TradeStatus.CANCELLED) {
      throw new TradeAmendmentError('Cannot amend a cancelled trade');
    }
    if (this._status === TradeStatus.SETTLED) {
      throw new TradeAmendmentError('Cannot amend a settled trade');
    }

    // Invariant: If notional changed, must still be positive
    if (changes.notional && !changes.notional.isPositive()) {
      throw new TradeAmendmentError('Amended notional must be positive');
    }

    // Apply changes immutably (tracking previous values for event)
    const previousState = this.snapshot();

    if (changes.notional) this._notional = changes.notional;
    if (changes.price !== undefined) this._price = changes.price;
    if (changes.valueDate) this._valueDate = changes.valueDate;
    if (changes.maturityDate) this._maturityDate = changes.maturityDate;
    if (changes.tradeTerms) this._tradeTerms = { ...this._tradeTerms, ...changes.tradeTerms };

    this._status = TradeStatus.AMENDED;
    this._updatedAt = new Date();
    this._version++;

    // Record amendment event with before/after state for audit
    this._domainEvents.push(
      new TradeAmendedEvent(this, previousState, amendedBy, reason),
    );
  }

  /**
   * Cancel a trade.
   * @throws TradeCancellationError if trade cannot be cancelled
   */
  cancel(cancelledBy: UserId, reason: string): void {
    if (this._status === TradeStatus.SETTLED) {
      throw new TradeCancellationError('Cannot cancel a settled trade');
    }
    if (this._status === TradeStatus.CANCELLED) {
      throw new TradeCancellationError('Trade is already cancelled');
    }

    this._status = TradeStatus.CANCELLED;
    this._updatedAt = new Date();
    this._version++;

    this._domainEvents.push(new TradeCancelledEvent(this, cancelledBy, reason));
  }

  /** Mark trade as settled after successful settlement confirmation */
  settle(settledAt: Date): void {
    if (this._status !== TradeStatus.CONFIRMED && this._status !== TradeStatus.AMENDED) {
      throw new Error(`Cannot settle trade in status: ${this._status}`);
    }

    this._status = TradeStatus.SETTLED;
    this._updatedAt = settledAt;
    this._version++;

    this._domainEvents.push(new TradeSettledEvent(this, settledAt));
  }

  // ── Getters (immutable access) ───────────────────────────────────────────

  get direction(): TradeDirection { return this._direction; }
  get notional(): Money { return this._notional; }
  get price(): number { return this._price; }
  get tradeDate(): BusinessDate { return this._tradeDate; }
  get valueDate(): BusinessDate { return this._valueDate; }
  get maturityDate(): BusinessDate | null { return this._maturityDate; }
  get status(): TradeStatus { return this._status; }
  get tradeTerms(): Readonly<Record<string, unknown>> { return { ...this._tradeTerms }; }
  get version(): number { return this._version; }
  get updatedAt(): Date { return this._updatedAt; }

  /** Retrieve and clear pending domain events (call after successful save) */
  get domainEvents(): ReadonlyArray<DomainEvent> {
    return [...this._domainEvents];
  }

  /** Clear domain events after they have been published to Kafka */
  clearDomainEvents(): void {
    this._domainEvents = [];
  }

  /** Calculate the trade's market value (notional × price) */
  get marketValue(): Money {
    return this._notional.multiply(this._price);
  }

  /** Snapshot of current state (for amendment event) */
  private snapshot(): Record<string, unknown> {
    return {
      notional: this._notional.toJSON(),
      price: this._price,
      valueDate: this._valueDate.isoString,
      maturityDate: this._maturityDate?.isoString,
      status: this._status,
    };
  }

  /** Generate a human-readable trade reference */
  private static generateTradeRef(assetClass: AssetClass, tradeDate: BusinessDate): string {
    const prefix = {
      [AssetClass.FX]: 'FX',
      [AssetClass.FIXED_INCOME]: 'FI',
      [AssetClass.MONEY_MARKET]: 'MM',
      [AssetClass.INTEREST_RATE_DERIVATIVE]: 'IRD',
      [AssetClass.EQUITY]: 'EQ',
      [AssetClass.COMMODITY]: 'CM',
      [AssetClass.REPO]: 'REPO',
      [AssetClass.ISLAMIC]: 'ISL',
    }[assetClass];

    // Format: FX-20260407-A3F2B1 (prefix + date + 6 random hex chars)
    const datePart = tradeDate.isoString.replace(/-/g, '');
    const uniquePart = Math.random().toString(16).substring(2, 8).toUpperCase();
    return `${prefix}-${datePart}-${uniquePart}`;
  }
}

// ============================================================================
// DOMAIN EVENTS — Trading Context
// ============================================================================

/** Published when a trade is successfully booked */
export class TradeCreatedEvent extends DomainEvent {
  constructor(public readonly trade: Trade) {
    super('nexus.trading.trades.created', trade.id);
  }
}

/** Published when a trade is amended */
export class TradeAmendedEvent extends DomainEvent {
  constructor(
    public readonly trade: Trade,
    public readonly previousState: Record<string, unknown>,
    public readonly amendedBy: UserId,
    public readonly reason: string,
  ) {
    super('nexus.trading.trades.amended', trade.id);
  }
}

/** Published when a trade is cancelled */
export class TradeCancelledEvent extends DomainEvent {
  constructor(
    public readonly trade: Trade,
    public readonly cancelledBy: UserId,
    public readonly reason: string,
  ) {
    super('nexus.trading.trades.cancelled', trade.id);
  }
}

/** Published when a trade is settled */
export class TradeSettledEvent extends DomainEvent {
  constructor(
    public readonly trade: Trade,
    public readonly settledAt: Date,
  ) {
    super('nexus.trading.trades.settled', trade.id);
  }
}

// ============================================================================
// REPOSITORY INTERFACE — Port (hexagonal architecture)
// ============================================================================

/**
 * Trade Repository Interface — defines the contract between the domain
 * and the infrastructure layer.
 *
 * Implementation (TradeRepositoryPrisma) lives in the infrastructure layer
 * and is injected at runtime via dependency injection.
 * This keeps the domain pure and testable (can mock in tests).
 */
export interface TradeRepository {
  /** Persist a new or updated trade (with optimistic locking) */
  save(trade: Trade): Promise<void>;

  /** Find a trade by its unique ID */
  findById(id: TradeId): Promise<Trade | null>;

  /** Find a trade by its business reference */
  findByRef(ref: string): Promise<Trade | null>;

  /** List trades with optional filters */
  findAll(filter: {
    bookId?: BookId;
    status?: TradeStatus;
    assetClass?: AssetClass;
    fromDate?: BusinessDate;
    toDate?: BusinessDate;
    cursor?: string;
    limit?: number;
  }): Promise<{ trades: Trade[]; nextCursor: string | null }>;

  /** Get all unsettled trades for a book (for position calculation) */
  findUnsettledByBook(bookId: BookId): Promise<Trade[]>;
}

// ============================================================================
// POSITION BOUNDED CONTEXT — Event-Sourced
// ============================================================================

/**
 * Position Aggregate — maintains the current position for a book/instrument.
 *
 * DESIGN: Event-sourced aggregate. The current state is derived entirely
 * from replaying position events (TradeCreated, TradeAmended, TradeSettled).
 *
 * This ensures:
 *   - Full audit trail of every position change
 *   - Ability to rewind position to any point in time
 *   - Temporal queries ("what was my position at 14:00?")
 *
 * Snapshots are taken every 1000 events to avoid full replay on startup.
 */
export class Position {
  private _domainEvents: DomainEvent[] = [];

  private constructor(
    public readonly id: PositionId,
    public readonly bookId: BookId,
    public readonly instrumentId: InstrumentId,
    private _quantity: number,
    private _notional: Money,
    private _marketValue: Money,
    private _unrealisedPnL: Money,
    private _realisedPnL: Money,
    private _accruedInterest: Money,
    private _lastUpdated: Date,
    private _sequenceNumber: number,
  ) {}

  /** Create a new position from the first trade in a book */
  static create(
    bookId: BookId,
    instrumentId: InstrumentId,
    currency: string,
  ): Position {
    return new Position(
      PositionId.generate(),
      bookId,
      instrumentId,
      0,
      Money.zero(currency),
      Money.zero(currency),
      Money.zero(currency),
      Money.zero(currency),
      Money.zero(currency),
      new Date(),
      0,
    );
  }

  /**
   * Apply a TradeCreated event to update position.
   * BUY/LEND/RECEIVE increases quantity; SELL/BORROW/PAY decreases it.
   */
  applyTradeCreated(event: TradeCreatedEvent): void {
    const trade = event.trade;
    const sign = [TradeDirection.BUY, TradeDirection.LEND, TradeDirection.RECEIVE]
      .includes(trade.direction) ? 1 : -1;

    this._quantity += sign * trade.notional.amount;
    this._notional = this._notional.add(trade.notional.multiply(sign));
    this._lastUpdated = event.occurredAt;
    this._sequenceNumber++;

    this._domainEvents.push(new PositionUpdatedEvent(this, 'TRADE_CREATED', event.aggregateId));
  }

  /** Apply a TradeCancelled event — reverse the position change */
  applyTradeCancelled(event: TradeCancelledEvent): void {
    const trade = event.trade;
    const sign = [TradeDirection.BUY, TradeDirection.LEND, TradeDirection.RECEIVE]
      .includes(trade.direction) ? -1 : 1;  // Opposite of creation

    this._quantity += sign * trade.notional.amount;
    this._notional = this._notional.add(trade.notional.multiply(sign));
    this._lastUpdated = event.occurredAt;
    this._sequenceNumber++;

    this._domainEvents.push(new PositionUpdatedEvent(this, 'TRADE_CANCELLED', event.aggregateId));
  }

  /**
   * Revalue the position using current market price.
   * Calculates unrealised P&L as (market value - book cost).
   *
   * @param currentPrice - Current mid-market price from market data service
   * @param bookCost - Original cost basis for unrealised P&L calculation
   */
  revalue(currentPrice: number, bookCostBasis: Money): void {
    // Market value = quantity × current price
    const newMarketValue = Money.of(
      this._quantity * currentPrice,
      this._notional.currency,
    );

    // Unrealised P&L = market value - book cost
    this._unrealisedPnL = newMarketValue.subtract(bookCostBasis);
    this._marketValue = newMarketValue;
    this._lastUpdated = new Date();
    this._sequenceNumber++;

    this._domainEvents.push(new PositionRevaluedEvent(this));
  }

  // ── Getters ──────────────────────────────────────────────────────────────

  get quantity(): number { return this._quantity; }
  get notional(): Money { return this._notional; }
  get marketValue(): Money { return this._marketValue; }
  get unrealisedPnL(): Money { return this._unrealisedPnL; }
  get realisedPnL(): Money { return this._realisedPnL; }
  get accruedInterest(): Money { return this._accruedInterest; }
  get lastUpdated(): Date { return this._lastUpdated; }
  get sequenceNumber(): number { return this._sequenceNumber; }

  /** Total P&L = realised + unrealised + accrued interest */
  get totalPnL(): Money {
    return this._realisedPnL.add(this._unrealisedPnL).add(this._accruedInterest);
  }

  get domainEvents(): ReadonlyArray<DomainEvent> { return [...this._domainEvents]; }
  clearDomainEvents(): void { this._domainEvents = []; }
}

/** Published when position changes due to trade or revaluation */
export class PositionUpdatedEvent extends DomainEvent {
  constructor(
    public readonly position: Position,
    public readonly changeReason: string,
    public readonly sourceTradeId: string,
  ) {
    super('nexus.positions.updated', position.id);
  }
}

export class PositionRevaluedEvent extends DomainEvent {
  constructor(public readonly position: Position) {
    super('nexus.positions.revalued', position.id);
  }
}

// ============================================================================
// ALM BOUNDED CONTEXT — Liquidity Gap
// ============================================================================

/**
 * Standard BCBS liquidity time buckets for cash flow ladder and gap reports.
 * Based on BCBS 238 (LCR) and BCBS 295 (NSFR) standard time buckets.
 */
export enum LiquidityTimeBucket {
  OVERNIGHT = 'OVERNIGHT',           // O/N (1 day)
  TWO_TO_SEVEN_DAYS = '2-7D',        // 2-7 days
  EIGHT_TO_FOURTEEN_DAYS = '8-14D',  // 8-14 days
  FIFTEEN_TO_ONE_MONTH = '15D-1M',   // 15 days to 1 month
  ONE_TO_THREE_MONTHS = '1-3M',      // 1-3 months
  THREE_TO_SIX_MONTHS = '3-6M',      // 3-6 months
  SIX_TO_TWELVE_MONTHS = '6-12M',    // 6-12 months
  ONE_TO_TWO_YEARS = '1-2Y',         // 1-2 years
  TWO_TO_FIVE_YEARS = '2-5Y',        // 2-5 years
  FIVE_TO_TEN_YEARS = '5-10Y',       // 5-10 years
  OVER_TEN_YEARS = '10Y+',           // Over 10 years
}

/**
 * ALM Scenario enumeration.
 * Following Moorad Choudhry's framework from The Principles of Banking:
 *   - Contractual: Pure contractual cash flows (no behavioral adjustments)
 *   - Behavioural: Adjusted for behavioral assumptions (NMD runoff, prepayments)
 *   - Stressed: Basel III 30-day stress (combination of idiosyncratic + market stress)
 */
export enum ALMScenario {
  CONTRACTUAL = 'CONTRACTUAL',
  BEHAVIOURAL = 'BEHAVIOURAL',
  STRESSED_30D = 'STRESSED_30D',      // Basel III LCR stress scenario
  STRESSED_IDIOSYNCRATIC = 'STRESSED_IDIOSYNCRATIC',
  STRESSED_MARKET_WIDE = 'STRESSED_MARKET_WIDE',
  STRESSED_COMBINED = 'STRESSED_COMBINED',
}

/**
 * CashFlowBucket Value Object — represents cash flows in a single time bucket.
 * Positive = inflows (asset maturities, interest received)
 * Negative = outflows (liability maturities, interest paid)
 */
export class CashFlowBucket {
  constructor(
    public readonly bucket: LiquidityTimeBucket,
    public readonly inflows: Money,
    public readonly outflows: Money,
  ) {}

  /** Net cash flow for this bucket (positive = net inflow) */
  get netCashFlow(): Money {
    return this.inflows.add(this.outflows.multiply(-1));
  }

  toString(): string {
    return `[${this.bucket}] In: ${this.inflows} | Out: ${this.outflows} | Net: ${this.netCashFlow}`;
  }
}

/**
 * LiquidityGapReport — represents the full liquidity gap across all time buckets.
 * The cumulative gap (sum of all preceding bucket net flows) is the key metric
 * for identifying funding mismatches as described in Choudhry's ALM framework.
 *
 * A negative cumulative gap indicates a funding requirement at that horizon.
 */
export class LiquidityGapReport {
  private constructor(
    public readonly legalEntityId: LegalEntityId,
    public readonly reportDate: BusinessDate,
    public readonly scenario: ALMScenario,
    public readonly currency: string,
    public readonly buckets: ReadonlyArray<CashFlowBucket>,
  ) {}

  static create(
    legalEntityId: LegalEntityId,
    reportDate: BusinessDate,
    scenario: ALMScenario,
    currency: string,
    buckets: CashFlowBucket[],
  ): LiquidityGapReport {
    if (buckets.length === 0) {
      throw new Error('Liquidity gap report must have at least one time bucket');
    }
    return new LiquidityGapReport(legalEntityId, reportDate, scenario, currency, buckets);
  }

  /** Get the cumulative gap at a specific time bucket */
  getCumulativeGap(bucket: LiquidityTimeBucket): Money {
    let cumulative = Money.zero(this.currency);
    for (const b of this.buckets) {
      cumulative = cumulative.add(b.netCashFlow);
      if (b.bucket === bucket) break;
    }
    return cumulative;
  }

  /** Total inflows across all buckets */
  get totalInflows(): Money {
    return this.buckets.reduce(
      (sum, b) => sum.add(b.inflows),
      Money.zero(this.currency),
    );
  }

  /** Total outflows across all buckets */
  get totalOutflows(): Money {
    return this.buckets.reduce(
      (sum, b) => sum.add(b.outflows),
      Money.zero(this.currency),
    );
  }

  /** Net liquidity position (positive = surplus, negative = deficit) */
  get netLiquidityPosition(): Money {
    return this.totalInflows.subtract(this.totalOutflows);
  }

  /** Identify the first bucket where cumulative gap turns negative */
  get firstNegativeCumulativeGapBucket(): LiquidityTimeBucket | null {
    let cumulative = Money.zero(this.currency);
    for (const b of this.buckets) {
      cumulative = cumulative.add(b.netCashFlow);
      if (cumulative.isNegative()) return b.bucket;
    }
    return null;  // No negative gap — fully funded
  }

  toJSON() {
    let cumulativeGap = Money.zero(this.currency);
    return {
      legalEntityId: this.legalEntityId,
      reportDate: this.reportDate.isoString,
      scenario: this.scenario,
      currency: this.currency,
      buckets: this.buckets.map(b => {
        cumulativeGap = cumulativeGap.add(b.netCashFlow);
        return {
          bucket: b.bucket,
          inflows: b.inflows.amount,
          outflows: b.outflows.amount,
          netCashFlow: b.netCashFlow.amount,
          cumulativeGap: cumulativeGap.amount,
        };
      }),
      totalInflows: this.totalInflows.amount,
      totalOutflows: this.totalOutflows.amount,
      netLiquidityPosition: this.netLiquidityPosition.amount,
    };
  }
}

// ============================================================================
// RISK BOUNDED CONTEXT
// ============================================================================

/**
 * Limit Aggregate — represents a risk limit for a counterparty, book, or trader.
 *
 * Hierarchy: Legal Entity → Book → Trader → Counterparty
 * Limit types: Credit, Market, Concentration, Settlement, Intraday
 *
 * Key domain rule: A limit breach triggers an event that flows through
 * the system to prevent the trade from booking (via pre-deal check).
 */
export class Limit {
  private _domainEvents: DomainEvent[] = [];

  private constructor(
    public readonly id: LimitId,
    public readonly tenantId: TenantId,
    public readonly limitType: string,
    public readonly counterpartyId: CounterpartyId | null,
    public readonly bookId: BookId | null,
    private _limitAmount: Money,
    private _utilisedAmount: Money,
    private _status: 'ACTIVE' | 'BREACHED' | 'SUSPENDED',
    public readonly effectiveDate: BusinessDate,
    public readonly expiryDate: BusinessDate | null,
  ) {}

  static create(params: {
    tenantId: TenantId;
    limitType: string;
    counterpartyId?: CounterpartyId;
    bookId?: BookId;
    limitAmount: Money;
    effectiveDate: BusinessDate;
    expiryDate?: BusinessDate;
  }): Limit {
    if (!params.limitAmount.isPositive()) {
      throw new Error('Limit amount must be positive');
    }

    return new Limit(
      crypto.randomUUID() as LimitId,
      params.tenantId,
      params.limitType,
      params.counterpartyId ?? null,
      params.bookId ?? null,
      params.limitAmount,
      Money.zero(params.limitAmount.currency),
      'ACTIVE',
      params.effectiveDate,
      params.expiryDate ?? null,
    );
  }

  /**
   * Check whether a new trade amount would breach this limit.
   * Returns the pre-deal check result for the trade service to act on.
   */
  checkPreDeal(requestedAmount: Money): PreDealCheckResult {
    const projectedUtilisation = this._utilisedAmount.add(requestedAmount);

    if (projectedUtilisation.amount > this._limitAmount.amount) {
      // Limit would be breached
      return PreDealCheckResult.rejected(
        this.id,
        this.limitType,
        this._limitAmount,
        this._utilisedAmount,
        false,  // Override not allowed by default — configurable
      );
    }

    return PreDealCheckResult.approved(
      this.id,
      this._limitAmount,
      this._utilisedAmount,
    );
  }

  /** Update utilisation after trade is booked */
  utilise(amount: Money): void {
    this._utilisedAmount = this._utilisedAmount.add(amount);

    // Check if limit is now breached (could happen from concurrent trades)
    if (this._utilisedAmount.amount > this._limitAmount.amount) {
      this._status = 'BREACHED';
      this._domainEvents.push(new LimitBreachedEvent(this));
    }
  }

  /** Release utilisation when trade is cancelled or matures */
  release(amount: Money): void {
    this._utilisedAmount = this._utilisedAmount.subtract(amount);

    // Restore ACTIVE status if breach was released
    if (this._status === 'BREACHED' &&
        this._utilisedAmount.amount <= this._limitAmount.amount) {
      this._status = 'ACTIVE';
      this._domainEvents.push(new LimitBreachResolvedEvent(this));
    }
  }

  get limitAmount(): Money { return this._limitAmount; }
  get utilisedAmount(): Money { return this._utilisedAmount; }
  get headroom(): Money { return this._limitAmount.subtract(this._utilisedAmount); }
  get utilisationRate(): Percentage {
    return Percentage.ofDecimal(this._utilisedAmount.amount / this._limitAmount.amount);
  }
  get status(): string { return this._status; }
  get domainEvents(): ReadonlyArray<DomainEvent> { return [...this._domainEvents]; }
  clearDomainEvents(): void { this._domainEvents = []; }
}

export class LimitBreachedEvent extends DomainEvent {
  constructor(public readonly limit: Limit) {
    super('nexus.risk.limit-breach', limit.id);
  }
}

export class LimitBreachResolvedEvent extends DomainEvent {
  constructor(public readonly limit: Limit) {
    super('nexus.risk.limit-breach-resolved', limit.id);
  }
}

// ============================================================================
// DOMAIN ERRORS — Specific, informative errors for clean error handling
// ============================================================================

export class NexusDomainError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class InvalidCurrencyError extends NexusDomainError {
  constructor(currency: string) {
    super(`Invalid currency code: ${currency}. Must be a 3-letter ISO 4217 code.`, 'INVALID_CURRENCY');
  }
}

export class CurrencyMismatchError extends NexusDomainError {
  constructor(expected: string, actual: string) {
    super(`Currency mismatch: expected ${expected}, got ${actual}`, 'CURRENCY_MISMATCH');
  }
}

export class TradeBookingError extends NexusDomainError {
  constructor(message: string) {
    super(message, 'TRADE_BOOKING_ERROR');
  }
}

export class PreDealLimitBreachError extends NexusDomainError {
  constructor(
    public readonly limitType: string,
    public readonly limitAmount: Money,
    public readonly utilisedAmount: Money,
  ) {
    super(
      `Trade rejected: ${limitType} limit of ${limitAmount} would be breached. ` +
      `Current utilisation: ${utilisedAmount}`,
      'PRE_DEAL_LIMIT_BREACH',
    );
  }
}

export class TradeAmendmentError extends NexusDomainError {
  constructor(message: string) {
    super(message, 'TRADE_AMENDMENT_ERROR');
  }
}

export class TradeCancellationError extends NexusDomainError {
  constructor(message: string) {
    super(message, 'TRADE_CANCELLATION_ERROR');
  }
}

// ============================================================================
// UNIT TESTS (TDD) — Tests for core domain models
// Tests use Jest. Run with: pnpm test:unit
// ============================================================================

/*
 * FILE: packages/domain/src/__tests__/trade.test.ts
 *
 * import { Trade, Money, BusinessDate, TradeDirection, AssetClass, PreDealCheckResult } from '../trading'
 *
 * describe('Trade Domain Model', () => {
 *
 *   describe('Trade.book()', () => {
 *
 *     const validParams = {
 *       tenantId: TenantId.create('tenant-001'),
 *       legalEntityId: LegalEntityId.create('le-001'),
 *       instrumentId: InstrumentId.create('inst-001'),
 *       counterpartyId: CounterpartyId.create('cp-001'),
 *       bookId: BookId.create('fx-book-01'),
 *       assetClass: AssetClass.FX,
 *       direction: TradeDirection.BUY,
 *       notional: Money.of(10_000_000, 'USD'),
 *       price: 1.0845,
 *       tradeDate: BusinessDate.fromString('2026-04-07'),
 *       valueDate: BusinessDate.fromString('2026-04-09'),
 *       bookedBy: UserId.create('user-001'),
 *     }
 *
 *     const approvedCheck = PreDealCheckResult.approved(
 *       LimitId.create('limit-001'),
 *       Money.of(50_000_000, 'USD'),
 *       Money.of(20_000_000, 'USD'),
 *     )
 *
 *     it('should book a valid FX trade successfully', () => {
 *       const trade = Trade.book(validParams, approvedCheck)
 *
 *       expect(trade.status).toBe(TradeStatus.CONFIRMED)
 *       expect(trade.notional.amount).toBe(10_000_000)
 *       expect(trade.notional.currency).toBe('USD')
 *       expect(trade.direction).toBe(TradeDirection.BUY)
 *       expect(trade.domainEvents).toHaveLength(1)
 *       expect(trade.domainEvents[0]).toBeInstanceOf(TradeCreatedEvent)
 *     })
 *
 *     it('should reject booking when pre-deal check fails', () => {
 *       const rejectedCheck = PreDealCheckResult.rejected(
 *         LimitId.create('limit-001'),
 *         'CREDIT',
 *         Money.of(50_000_000, 'USD'),
 *         Money.of(48_000_000, 'USD'),
 *         false,
 *       )
 *       expect(() => Trade.book(validParams, rejectedCheck))
 *         .toThrow(PreDealLimitBreachError)
 *     })
 *
 *     it('should reject booking when value date is before trade date', () => {
 *       const invalidParams = {
 *         ...validParams,
 *         valueDate: BusinessDate.fromString('2026-04-06'), // Before trade date
 *       }
 *       expect(() => Trade.book(invalidParams, approvedCheck))
 *         .toThrow(TradeBookingError)
 *     })
 *
 *     it('should reject booking with negative notional', () => {
 *       const invalidParams = {
 *         ...validParams,
 *         notional: Money.of(-1_000_000, 'USD'),
 *       }
 *       expect(() => Trade.book(invalidParams, approvedCheck))
 *         .toThrow(TradeBookingError)
 *     })
 *
 *     it('should generate a valid trade reference', () => {
 *       const trade = Trade.book(validParams, approvedCheck)
 *       expect(trade.tradeRef).toMatch(/^FX-\d{8}-[A-F0-9]{6}$/)
 *     })
 *   })
 *
 *   describe('Trade.cancel()', () => {
 *     it('should cancel a confirmed trade and publish TradeCancelledEvent', () => {
 *       const trade = Trade.book(validParams, approvedCheck)
 *       trade.clearDomainEvents()
 *
 *       trade.cancel(UserId.create('user-002'), 'Client request')
 *
 *       expect(trade.status).toBe(TradeStatus.CANCELLED)
 *       expect(trade.domainEvents[0]).toBeInstanceOf(TradeCancelledEvent)
 *     })
 *
 *     it('should not allow cancelling an already cancelled trade', () => {
 *       const trade = Trade.book(validParams, approvedCheck)
 *       trade.cancel(UserId.create('user-001'), 'First cancellation')
 *       expect(() => trade.cancel(UserId.create('user-001'), 'Second cancellation'))
 *         .toThrow(TradeCancellationError)
 *     })
 *   })
 * })
 *
 * describe('Money Value Object', () => {
 *   it('should add two same-currency amounts', () => {
 *     const a = Money.of(100, 'USD')
 *     const b = Money.of(50, 'USD')
 *     expect(a.add(b).amount).toBe(150)
 *     expect(a.add(b).currency).toBe('USD')
 *   })
 *
 *   it('should throw on cross-currency addition', () => {
 *     const a = Money.of(100, 'USD')
 *     const b = Money.of(100, 'EUR')
 *     expect(() => a.add(b)).toThrow(CurrencyMismatchError)
 *   })
 *
 *   it('should reject invalid currency codes', () => {
 *     expect(() => Money.of(100, 'us')).toThrow(InvalidCurrencyError)
 *     expect(() => Money.of(100, 'USDD')).toThrow(InvalidCurrencyError)
 *     expect(() => Money.of(100, '123')).toThrow(InvalidCurrencyError)
 *   })
 * })
 *
 * describe('LiquidityGapReport', () => {
 *   it('should calculate cumulative gap correctly', () => {
 *     const buckets = [
 *       new CashFlowBucket(LiquidityTimeBucket.OVERNIGHT, Money.of(100, 'USD'), Money.of(-150, 'USD')),
 *       new CashFlowBucket(LiquidityTimeBucket.TWO_TO_SEVEN_DAYS, Money.of(200, 'USD'), Money.of(-100, 'USD')),
 *     ]
 *     const report = LiquidityGapReport.create(
 *       LegalEntityId.create('le-001'),
 *       BusinessDate.fromString('2026-04-07'),
 *       ALMScenario.CONTRACTUAL,
 *       'USD',
 *       buckets,
 *     )
 *
 *     // O/N bucket: net = 100 - 150 = -50, cumulative = -50
 *     expect(report.getCumulativeGap(LiquidityTimeBucket.OVERNIGHT).amount).toBe(-50)
 *     // 2-7D bucket: net = 200 - 100 = +100, cumulative = -50 + 100 = +50
 *     expect(report.getCumulativeGap(LiquidityTimeBucket.TWO_TO_SEVEN_DAYS).amount).toBe(50)
 *
 *     // First negative bucket is O/N
 *     expect(report.firstNegativeCumulativeGapBucket).toBe(LiquidityTimeBucket.OVERNIGHT)
 *   })
 * })
 */

// =============================================================================
// SPRINT 9–12 DOMAIN MODEL ADDITIONS
// =============================================================================

// ── Islamic Finance Value Objects (Sprint 9) ─────────────────────────────────

export enum IslamicInstrumentType {
  MURABAHA = 'MURABAHA',
  IJARA = 'IJARA',
  WAKALA = 'WAKALA',
  DIMINISHING_MUSHARAKAH = 'DIMINISHING_MUSHARAKAH',
  SUKUK_IJARA = 'SUKUK_IJARA',
  SUKUK_MURABAHA = 'SUKUK_MURABAHA',
}

export interface IslamicTradeTerms {
  instrumentType: IslamicInstrumentType;
  profitRate: Percentage;       // No interest — profit rate only
  assetDescription: string;     // Underlying halal asset
  shariahAdvisorId: string;
  profitSchedule: Array<{ date: BusinessDate; amount: Money }>;
}

// ── Capital Stress Testing (Sprint 10) ───────────────────────────────────────

export enum StressScenario {
  BASELINE = 'BASELINE',
  MILD_STRESS = 'MILD_STRESS',
  MODERATE_STRESS = 'MODERATE_STRESS',
  SEVERE_STRESS = 'SEVERE_STRESS',
  EXTREME_STRESS = 'EXTREME_STRESS',
}

export interface CapitalStressInput {
  tenantId: TenantId;
  scenarioType: StressScenario;
  cet1Gross: number;
  at1Capital: number;
  tier2Capital: number;
  creditRiskExposures: Array<{ exposure: number; riskWeight: number }>;
  marketRiskPositions: Array<{ notional: number; volatility: number }>;
  opRisk: { avgGrossIncome: number; bicMultiplier: number; lossComponent: number };
  ccybRate: number;
  gsibSurcharge: number;
  srepAddOn: number;
  liquidityBuffer: number;
  quarterlyNetCashOutflow: number;
}

export interface CapitalStressResult {
  scenarioType: StressScenario;
  totalRWA: number;
  cet1RatioPct: number;
  tier1RatioPct: number;
  totalCapRatioPct: number;
  capitalHeadroom: number;
  isCompliant: boolean;
  survivalHorizonDays: number;
  cfpTriggerBreached: boolean;
  generatedAt: Date;
}

// ── FX Hedging (Sprint 10) ────────────────────────────────────────────────────

export enum HedgeStrategy {
  STATIC = 'STATIC',
  DYNAMIC = 'DYNAMIC',
  ROLLING = 'ROLLING',
  SELECTIVE = 'SELECTIVE',
}

export interface FXHedgeRequest {
  tenantId: TenantId;
  exposureCurrency: string;
  baseCurrency: string;
  notionalAmount: number;
  hedgeRatio: number;             // 0.0–1.0
  strategy: HedgeStrategy;
  spreadLockBps: number;          // Portal deal spread lock
  maturityDate: BusinessDate;
}

export interface FXHedgeResult {
  hedgeId: string;
  strategy: HedgeStrategy;
  hedgedNotional: number;
  unhedgedNotional: number;
  forwardRate: number;
  spreadLocked: number;
  effectiveCost: number;
  coveredInterestParityCheck: boolean;
}

// ── COREP / FINREP (Sprint 10) ────────────────────────────────────────────────

export interface COREPInput {
  tenantId: TenantId;
  reportingDate: BusinessDate;
  cet1Gross: number;
  at1Capital: number;
  tier2Capital: number;
  creditRiskExposures: Array<{ exposure: number; riskWeight: number }>;
  marketRiskPositions: Array<{ notional: number; volatility: number }>;
  opRisk: { avgGrossIncome: number; bicMultiplier: number; lossComponent: number };
  ccybRate: number;
  gsibSurcharge: number;
  srepAddOn: number;
}

export interface COREPOutput {
  reportingDate: BusinessDate;
  totalRWA: number;
  cet1RatioPct: number;
  tier1RatioPct: number;
  totalCapRatioPct: number;
  capitalHeadroom: number;
  isCompliant: boolean;
  regulatoryMinimumPct: number;
  generatedAt: Date;
}

export interface FinrepBalanceSheetInput {
  tenantId: TenantId;
  reportingDate: BusinessDate;
  cash: number;
  loansAMC: number;
  loansNonPerform: number;
  tradingAssets: number;
  otherAssets: number;
  deposits: number;
  borrowings: number;
  otherLiabilities: number;
  cet1Capital: number;
  retainedEarnings: number;
  otherEquity: number;
}

export interface FinrepPLInput {
  netInterestIncome: number;
  feeIncome: number;
  tradingIncome: number;
  operatingExpenses: number;
  eclCharges: number;
  taxRate: number;
}

// ── AI Treasury Assistant (Sprint 11) ────────────────────────────────────────

export enum QueryCategory {
  FX_EXPOSURE = 'FX_EXPOSURE',
  LIMIT_UTILISATION = 'LIMIT_UTILISATION',
  IRRBB_ANALYSIS = 'IRRBB_ANALYSIS',
  LIQUIDITY_RATIOS = 'LIQUIDITY_RATIOS',
  CAPITAL_POSITION = 'CAPITAL_POSITION',
  TRADE_BLOTTER = 'TRADE_BLOTTER',
  PROFITABILITY = 'PROFITABILITY',
  GENERAL = 'GENERAL',
}

export interface TreasuryDataContext {
  snapshotDate: string;
  lcrRatio?: number;
  nsfrRatio?: number;
  cet1RatioPct?: number;
  niiYTD?: number;
  tradingPnlYTD?: number;
  largestFxExposure?: { currency: string; notional: number };
  activeLimitBreaches?: number;
}

export interface AssistantQuery {
  tenantId: TenantId | string;
  userId: UserId | string;
  question: string;
  context?: TreasuryDataContext;
  sessionId?: string;
}

export interface AssistantResponse {
  answer: string;
  category: QueryCategory;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  dataSourced: boolean;
  citedMetrics: string[];
  followUpQuestions: string[];
  disclaimers: string[];
  processingMs: number;
  modelVersion: string;
}

// ── Report Builder (Sprint 11) ────────────────────────────────────────────────

export enum ReportTemplate {
  TRADE_BLOTTER = 'TRADE_BLOTTER',
  POSITION_SUMMARY = 'POSITION_SUMMARY',
  PNL_ATTRIBUTION = 'PNL_ATTRIBUTION',
  RISK_EXPOSURE = 'RISK_EXPOSURE',
  LIMIT_UTILISATION = 'LIMIT_UTILISATION',
  LIQUIDITY_DASHBOARD = 'LIQUIDITY_DASHBOARD',
  REGULATORY_CAPITAL = 'REGULATORY_CAPITAL',
  COUNTERPARTY_EXPOSURE = 'COUNTERPARTY_EXPOSURE',
}

export enum ReportDimension {
  PRODUCT = 'PRODUCT',
  CURRENCY = 'CURRENCY',
  BOOK = 'BOOK',
  ENTITY = 'ENTITY',
  COUNTERPARTY = 'COUNTERPARTY',
  TIME = 'TIME',
  REGULATORY_ENTITY = 'REGULATORY_ENTITY',
}

export interface ReportDefinition {
  reportId: string;
  tenantId: TenantId | string;
  template: ReportTemplate;
  dimensions: ReportDimension[];
  filters: Record<string, string[]>;
  schedule?: { cron: string; deliveryEmail?: string };
  createdBy: UserId | string;
  createdAt: Date;
}

export interface ReportRun {
  runId: string;
  reportId: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  startedAt?: Date;
  completedAt?: Date;
  rowCount?: number;
  outputUrl?: string;
  error?: string;
}

// ── Financial Planning (Sprint 11–12) ─────────────────────────────────────────

export interface BudgetRequest {
  tenantId: TenantId | string;
  fiscalYear: number;
  scenarioName: string;
  revenueProjections: Array<{ quarter: number; amount: number; currency: string }>;
  costProjections: Array<{ quarter: number; amount: number; category: string }>;
  capitalAdequacyTarget: number;   // CET1 ratio %
  liquidityTarget: number;          // LCR %
}

export interface BudgetVarianceReport {
  tenantId: TenantId | string;
  fiscalYear: number;
  period: string;
  budgetedRevenue: number;
  actualRevenue: number;
  revenueVariancePct: number;
  budgetedCost: number;
  actualCost: number;
  costVariancePct: number;
  status: 'ON_TRACK' | 'AT_RISK' | 'BREACHED';
}

// ── Platform Operations (Sprint 12) ───────────────────────────────────────────

export interface DisasterRecoveryConfig {
  primaryRegion: string;
  standbyRegions: string[];
  rtoTargetMs: number;        // Recovery Time Objective — default 900000 (15min)
  rpoTargetMs: number;        // Recovery Point Objective — default 300000 (5min)
  healthProbeIntervalMs: number;
  failoverThreshold: number;  // Consecutive failures before auto-failover
  latencyThresholdMs: number;
}

export interface DRTestResult {
  testId: string;
  runAt: Date;
  primaryRegion: string;
  standbyRegion: string;
  rtoMeasuredMs: number;
  rpoMeasuredMs: number;
  rtoTargetMs: number;
  rpoTargetMs: number;
  overallPassed: boolean;
  findings: string[];
  soc2EvidenceKey?: string; // S3 Object Lock key
}

export interface SecretRotationConfig {
  secretName: string;
  rotationIntervalDays: number;
  dualValidationWindowMs: number;  // JWT: 30min overlap window
  vaultPath: string;
  notifySlackChannel?: string;
}

export interface FinOpsCostRecord {
  tenantId: TenantId | string;
  periodStart: Date;
  periodEnd: Date;
  cpuCostUsd: number;
  memoryCostUsd: number;
  storageCostUsd: number;
  networkCostUsd: number;
  totalCostUsd: number;
  costPerTrade?: number;
  costPerReport?: number;
}

export interface SOC2Evidence {
  controlId: string;           // e.g. CC6.1, CC7.4
  criterionName: string;
  evidenceType: 'AUTOMATED' | 'MANUAL';
  collectedAt: Date;
  retentionUntil: Date;        // 7 years for SOC 2
  draataControlId?: string;
  vantaControlId?: string;
  s3ObjectLockKey: string;
  passFail: 'PASS' | 'FAIL' | 'EXCEPTION';
  details: Record<string, unknown>;
}

// ── Regulatory Submission (Sprint 10–12) ─────────────────────────────────────

export enum RegulatoryFramework {
  EBA_COREP = 'EBA_COREP',
  EBA_FINREP = 'EBA_FINREP',
  CBUTT_ALMA = 'CBUTT_ALMA',
  BOG_ANNUAL = 'BOG_ANNUAL',
  CBN_PRUDENTIAL = 'CBN_PRUDENTIAL',
}

export enum SubmissionStatus {
  DRAFT = 'DRAFT',
  QUEUED = 'QUEUED',
  SUBMITTED = 'SUBMITTED',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  REJECTED = 'REJECTED',
  FAILED = 'FAILED',
}

export interface RegulatorySubmission {
  submissionId: string;
  tenantId: TenantId | string;
  framework: RegulatoryFramework;
  reportingPeriod: string;    // e.g. "2026-Q1"
  status: SubmissionStatus;
  submittedAt?: Date;
  acknowledgedAt?: Date;
  rejectionReason?: string;
  xbrlPayloadUrl?: string;
  apiEndpoint: string;
  dualSubmission: boolean;    // true = both API and file upload portal
}

// ── SWIFT ISO 20022 (Sprint 10) ───────────────────────────────────────────────

export enum SWIFTMigrationMode {
  LEGACY_MT_ONLY = 'LEGACY_MT_ONLY',
  DUAL_RUN = 'DUAL_RUN',       // Both MT and ISO 20022 MX in parallel
  MX_ONLY = 'MX_ONLY',
}

export interface SWIFTISO20022Message {
  messageType: 'pacs.008' | 'pacs.009' | 'pain.001' | 'camt.053';
  businessMessageIdentifier: string;
  creationDateTime: Date;
  numberOfTransactions: number;
  settlementMethod: 'INDA' | 'INGA' | 'COVE' | 'CLRG';
  payload: Record<string, unknown>;
  mtLegacyReference?: string;  // Original MT103/MT202 reference for dual-run
}
