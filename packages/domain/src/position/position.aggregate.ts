import { DomainEvent } from '../shared/domain-event.js';
import {
  PositionId, InstrumentId, BookId, TenantId, Money, BusinessDate,
} from '../shared/value-objects.js';
import { TradeBookedEvent, TradeCancelledEvent } from '../trading/trade.aggregate.js';

export class PositionUpdatedEvent extends DomainEvent {
  constructor(public readonly position: Position) {
    super('nexus.position.position.updated', position.id, position.tenantId);
  }
}

export class PositionRevaluedEvent extends DomainEvent {
  constructor(
    public readonly position: Position,
    public readonly previousMtm: Money,
  ) {
    super('nexus.position.position.revalued', position.id, position.tenantId);
  }
}

/**
 * Event-sourced Position aggregate.
 * Rebuilt by replaying domain events — enables point-in-time queries.
 */
export class Position {
  private _netQuantity: number = 0;
  private _averageCost: Money;
  private _mtmValue: Money;
  private _unrealisedPnl: Money;
  private _version: number = 0;
  private readonly _domainEvents: DomainEvent[] = [];

  private constructor(
    public readonly id: PositionId,
    public readonly tenantId: TenantId,
    public readonly instrumentId: InstrumentId,
    public readonly bookId: BookId,
    public readonly currency: string,
    public readonly openDate: BusinessDate,
  ) {
    this._averageCost    = Money.of(0, currency);
    this._mtmValue       = Money.of(0, currency);
    this._unrealisedPnl  = Money.of(0, currency);
  }

  static create(params: {
    id: PositionId;
    tenantId: TenantId;
    instrumentId: InstrumentId;
    bookId: BookId;
    currency: string;
    openDate: BusinessDate;
  }): Position {
    return new Position(
      params.id,
      params.tenantId,
      params.instrumentId,
      params.bookId,
      params.currency,
      params.openDate,
    );
  }

  applyTradeBooked(event: TradeBookedEvent): void {
    const qty = event.trade.direction === 'BUY'
      ? event.trade.notional.toNumber()
      : -event.trade.notional.toNumber();

    const newTotal = this._netQuantity + qty;

    if (this._netQuantity === 0 || Math.sign(qty) === Math.sign(this._netQuantity)) {
      // Adding to existing position — recalculate weighted average cost
      const newCost =
        (this._averageCost.toNumber() * this._netQuantity + event.trade.price * qty) /
        newTotal;
      this._averageCost = Money.of(newCost, this.currency);
    }

    this._netQuantity = newTotal;
    this._version++;
    this._domainEvents.push(new PositionUpdatedEvent(this));
  }

  applyCancelledTrade(event: TradeCancelledEvent): void {
    const qty = event.trade.direction === 'BUY'
      ? -event.trade.notional.toNumber()   // reverse the BUY
      : event.trade.notional.toNumber();    // reverse the SELL

    this._netQuantity += qty;
    this._version++;
    this._domainEvents.push(new PositionUpdatedEvent(this));
  }

  revalue(currentMarketPrice: number): void {
    const previousMtm = this._mtmValue;
    const newMtm = Money.of(this._netQuantity * currentMarketPrice, this.currency);
    const costBasis = Money.of(this._netQuantity * this._averageCost.toNumber(), this.currency);

    this._mtmValue = newMtm;
    this._unrealisedPnl = newMtm.subtract(costBasis);
    this._version++;

    this._domainEvents.push(new PositionRevaluedEvent(this, previousMtm));
  }

  get id(): PositionId                   { return this.id; }
  get netQuantity(): number              { return this._netQuantity; }
  get averageCost(): Money               { return this._averageCost; }
  get mtmValue(): Money                  { return this._mtmValue; }
  get unrealisedPnl(): Money             { return this._unrealisedPnl; }
  get version(): number                  { return this._version; }
  get isFlat(): boolean                  { return this._netQuantity === 0; }

  pullDomainEvents(): DomainEvent[] {
    const events = [...this._domainEvents];
    this._domainEvents.length = 0;
    return events;
  }
}

export interface PositionRepository {
  findById(id: PositionId, tenantId: TenantId): Promise<Position | null>;
  findByBook(bookId: BookId, tenantId: TenantId): Promise<Position[]>;
  findByInstrument(instrumentId: InstrumentId, tenantId: TenantId): Promise<Position[]>;
  save(position: Position): Promise<void>;
  update(position: Position): Promise<void>;
}
