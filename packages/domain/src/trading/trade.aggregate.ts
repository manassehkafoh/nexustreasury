import { randomUUID } from 'crypto';
import { DomainEvent } from '../shared/domain-event.js';
import {
  TradeId, CounterpartyId, InstrumentId, BookId, TraderId,
  TenantId, Money, BusinessDate,
} from '../shared/value-objects.js';

// ── Enums ────────────────────────────────────────────────────
export enum AssetClass {
  FX = 'FX',
  FIXED_INCOME = 'FIXED_INCOME',
  MONEY_MARKET = 'MONEY_MARKET',
  INTEREST_RATE_DERIVATIVE = 'INTEREST_RATE_DERIVATIVE',
  EQUITY = 'EQUITY',
  COMMODITY = 'COMMODITY',
  REPO = 'REPO',
  ISLAMIC_FINANCE = 'ISLAMIC_FINANCE',
}

export enum TradeDirection {
  BUY = 'BUY',
  SELL = 'SELL',
}

export enum TradeStatus {
  PENDING_VALIDATION = 'PENDING_VALIDATION',
  VALIDATED = 'VALIDATED',
  CONFIRMED = 'CONFIRMED',
  SETTLED = 'SETTLED',
  CANCELLED = 'CANCELLED',
  AMENDED = 'AMENDED',
}

// ── Domain Errors ────────────────────────────────────────────
export class TradeDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'TradeDomainError';
  }
}

// ── Domain Events ────────────────────────────────────────────
export class TradeBookedEvent extends DomainEvent {
  constructor(public readonly trade: Trade) {
    super('nexus.trading.trade.booked', trade.id, trade.tenantId);
  }
}

export class TradeAmendedEvent extends DomainEvent {
  constructor(
    public readonly trade: Trade,
    public readonly previousNotional: Money,
  ) {
    super('nexus.trading.trade.amended', trade.id, trade.tenantId);
  }
}

export class TradeCancelledEvent extends DomainEvent {
  constructor(
    public readonly trade: Trade,
    public readonly reason: string,
  ) {
    super('nexus.trading.trade.cancelled', trade.id, trade.tenantId);
  }
}

export class TradeSettledEvent extends DomainEvent {
  constructor(public readonly trade: Trade) {
    super('nexus.trading.trade.settled', trade.id, trade.tenantId);
  }
}

// ── Pre-Deal Check Result ─────────────────────────────────────
export interface PreDealCheckResult {
  readonly approved: boolean;
  readonly limitUtilisationPct: number;
  readonly headroomAmount: Money;
  readonly failureReasons: ReadonlyArray<string>;
  readonly checkedAt: Date;
}

// ── Trade Aggregate Root ──────────────────────────────────────
export interface TradeProps {
  id: TradeId;
  tenantId: TenantId;
  reference: string;
  assetClass: AssetClass;
  direction: TradeDirection;
  status: TradeStatus;
  counterpartyId: CounterpartyId;
  instrumentId: InstrumentId;
  bookId: BookId;
  traderId: TraderId;
  notional: Money;
  price: number;
  tradeDate: BusinessDate;
  valueDate: BusinessDate;
  maturityDate?: BusinessDate | undefined;
  preDealCheck?: PreDealCheckResult;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export class Trade {
  private readonly _domainEvents: DomainEvent[] = [];

  private constructor(private readonly _props: TradeProps) {}

  // ── Factory ──────────────────────────────────────────────
  static book(params: {
    tenantId: TenantId;
    assetClass: AssetClass;
    direction: TradeDirection;
    counterpartyId: CounterpartyId;
    instrumentId: InstrumentId;
    bookId: BookId;
    traderId: TraderId;
    notional: Money;
    price: number;
    tradeDate: BusinessDate;
    valueDate: BusinessDate;
    maturityDate?: BusinessDate | undefined;
    preDealCheck: PreDealCheckResult;
  }): Trade {
    // Invariant: pre-deal check must pass before booking
    if (!params.preDealCheck.approved) {
      throw new TradeDomainError(
        'PRE_DEAL_FAILED',
        `Trade rejected: ${params.preDealCheck.failureReasons.join(', ')}`,
      );
    }

    // Invariant: notional must be positive
    if (params.notional.toNumber() <= 0) {
      throw new TradeDomainError('INVALID_NOTIONAL', 'Notional must be positive');
    }

    // Invariant: value date >= trade date
    if (params.valueDate.isBefore(params.tradeDate)) {
      throw new TradeDomainError(
        'INVALID_VALUE_DATE',
        'Value date cannot be before trade date',
      );
    }

    const now = new Date();
    const props: TradeProps = {
      id: TradeId(randomUUID()),
      tenantId: params.tenantId,
      reference: Trade.generateReference(params.assetClass),
      assetClass: params.assetClass,
      direction: params.direction,
      status: TradeStatus.PENDING_VALIDATION,
      counterpartyId: params.counterpartyId,
      instrumentId: params.instrumentId,
      bookId: params.bookId,
      traderId: params.traderId,
      notional: params.notional,
      price: params.price,
      tradeDate: params.tradeDate,
      valueDate: params.valueDate,
      maturityDate: params.maturityDate,
      preDealCheck: params.preDealCheck,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    const trade = new Trade(props);
    trade._domainEvents.push(new TradeBookedEvent(trade));
    return trade;
  }

  // ── Commands ─────────────────────────────────────────────
  amend(newNotional: Money, newPrice: number): void {
    if (this._props.status === TradeStatus.SETTLED) {
      throw new TradeDomainError('CANNOT_AMEND_SETTLED', 'Cannot amend a settled trade');
    }
    if (this._props.status === TradeStatus.CANCELLED) {
      throw new TradeDomainError('CANNOT_AMEND_CANCELLED', 'Cannot amend a cancelled trade');
    }

    const previousNotional = this._props.notional;
    (this._props as { notional: Money }).notional = newNotional;
    (this._props as { price: number }).price = newPrice;
    (this._props as { status: TradeStatus }).status = TradeStatus.AMENDED;
    (this._props as { updatedAt: Date }).updatedAt = new Date();
    (this._props as { version: number }).version += 1;

    this._domainEvents.push(new TradeAmendedEvent(this, previousNotional));
  }

  cancel(reason: string): void {
    if (this._props.status === TradeStatus.SETTLED) {
      throw new TradeDomainError('CANNOT_CANCEL_SETTLED', 'Cannot cancel a settled trade');
    }
    (this._props as { status: TradeStatus }).status = TradeStatus.CANCELLED;
    (this._props as { updatedAt: Date }).updatedAt = new Date();
    (this._props as { version: number }).version += 1;
    this._domainEvents.push(new TradeCancelledEvent(this, reason));
  }

  settle(): void {
    if (this._props.status !== TradeStatus.CONFIRMED) {
      throw new TradeDomainError(
        'CANNOT_SETTLE_UNCONFIRMED',
        'Trade must be confirmed before settlement',
      );
    }
    (this._props as { status: TradeStatus }).status = TradeStatus.SETTLED;
    (this._props as { updatedAt: Date }).updatedAt = new Date();
    (this._props as { version: number }).version += 1;
    this._domainEvents.push(new TradeSettledEvent(this));
  }

  confirm(): void {
    if (this._props.status !== TradeStatus.VALIDATED) {
      throw new TradeDomainError(
        'CANNOT_CONFIRM_UNVALIDATED',
        'Trade must be validated before confirmation',
      );
    }
    (this._props as { status: TradeStatus }).status = TradeStatus.CONFIRMED;
    (this._props as { updatedAt: Date }).updatedAt = new Date();
    (this._props as { version: number }).version += 1;
  }

  // ── Accessors ────────────────────────────────────────────
  get id(): TradeId             { return this._props.id; }
  get tenantId(): TenantId      { return this._props.tenantId; }
  get reference(): string       { return this._props.reference; }
  get assetClass(): AssetClass  { return this._props.assetClass; }
  get direction(): TradeDirection { return this._props.direction; }
  get status(): TradeStatus     { return this._props.status; }
  get counterpartyId(): CounterpartyId { return this._props.counterpartyId; }
  get instrumentId(): InstrumentId { return this._props.instrumentId; }
  get bookId(): BookId          { return this._props.bookId; }
  get traderId(): TraderId      { return this._props.traderId; }
  get notional(): Money         { return this._props.notional; }
  get price(): number           { return this._props.price; }
  get tradeDate(): BusinessDate { return this._props.tradeDate; }
  get valueDate(): BusinessDate { return this._props.valueDate; }
  get maturityDate(): BusinessDate | undefined { return this._props.maturityDate; }
  get version(): number         { return this._props.version; }
  get createdAt(): Date         { return this._props.createdAt; }

  pullDomainEvents(): DomainEvent[] {
    const events = [...this._domainEvents];
    this._domainEvents.length = 0;
    return events;
  }

  private static generateReference(assetClass: AssetClass): string {
    const prefix = assetClass.slice(0, 2).toUpperCase();
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const suffix = randomUUID().slice(0, 6).toUpperCase();
    return `${prefix}-${date}-${suffix}`;
  }
}

// ── Repository Interface ──────────────────────────────────────
export interface TradeRepository {
  findById(id: TradeId, tenantId: TenantId): Promise<Trade | null>;
  findByBookId(bookId: BookId, tenantId: TenantId): Promise<Trade[]>;
  save(trade: Trade): Promise<void>;
  update(trade: Trade): Promise<void>;
}
