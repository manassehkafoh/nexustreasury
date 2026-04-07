import { randomUUID } from 'crypto';
import { DomainEvent } from '../shared/domain-event.js';
import { LimitId, CounterpartyId, BookId, TenantId, Money, Percentage } from '../shared/value-objects.js';

export enum LimitType {
  COUNTERPARTY_CREDIT = 'COUNTERPARTY_CREDIT',
  MARKET_VAR          = 'MARKET_VAR',
  CONCENTRATION       = 'CONCENTRATION',
  SETTLEMENT          = 'SETTLEMENT',
  ISSUER              = 'ISSUER',
}

export enum LimitLevel {
  LEGAL_ENTITY = 'LEGAL_ENTITY',
  BOOK         = 'BOOK',
  TRADER       = 'TRADER',
  COUNTERPARTY = 'COUNTERPARTY',
}

export class LimitBreachedEvent extends DomainEvent {
  constructor(
    public readonly limit: Limit,
    public readonly requestedAmount: Money,
    tenantId: TenantId,
  ) {
    super('nexus.risk.limit.breached', limit.id, tenantId);
  }
}

export class LimitUtilisedEvent extends DomainEvent {
  constructor(public readonly limit: Limit, tenantId: TenantId) {
    super('nexus.risk.limit.utilised', limit.id, tenantId);
  }
}

export class LimitResolvedEvent extends DomainEvent {
  constructor(public readonly limit: Limit, tenantId: TenantId) {
    super('nexus.risk.limit.resolved', limit.id, tenantId);
  }
}

export interface PreDealCheckRequest {
  readonly counterpartyId?: CounterpartyId;
  readonly bookId?: BookId;
  readonly requestedExposure: Money;
  readonly tenantId: TenantId;
}

export interface PreDealCheckResponse {
  readonly approved: boolean;
  readonly currentUtilisation: Money;
  readonly utilisationPct: number;
  readonly headroom: Money;
  readonly failureReasons: string[];
  readonly checkedAt: Date;
  readonly responseTimeMs: number;
}

export class Limit {
  private _utilisedAmount: Money;
  private _inBreach: boolean = false;
  private _version: number = 1;
  private readonly _domainEvents: DomainEvent[] = [];

  private constructor(
    public readonly id: LimitId,
    public readonly tenantId: TenantId,
    public readonly limitType: LimitType,
    public readonly level: LimitLevel,
    public readonly limitAmount: Money,
    public readonly warningThreshold: Percentage,  // e.g. 80% triggers warning
    public readonly hardLimit: Percentage,          // e.g. 100% hard block
    private readonly _entityId: string,            // counterpartyId or bookId
  ) {
    this._utilisedAmount = Money.of(0, limitAmount.currency);
  }

  static create(params: {
    tenantId: TenantId;
    limitType: LimitType;
    level: LimitLevel;
    limitAmount: Money;
    warningThreshold: Percentage;
    entityId: string;
  }): Limit {
    return new Limit(
      LimitId(randomUUID()),
      params.tenantId,
      params.limitType,
      params.level,
      params.limitAmount,
      params.warningThreshold,
      Percentage.of(100),
      params.entityId,
    );
  }

  /**
   * Pre-deal check — synchronous gRPC call gate. Target P99 < 5ms.
   */
  checkPreDeal(request: PreDealCheckRequest): PreDealCheckResponse {
    const start = performance.now();
    const projected = this._utilisedAmount.add(request.requestedExposure);
    const projectedPct = (projected.toNumber() / this.limitAmount.toNumber()) * 100;
    const headroom = this.limitAmount.subtract(this._utilisedAmount);
    const failures: string[] = [];

    if (projectedPct > this.hardLimit.value) {
      failures.push(
        `${this.limitType} limit would be exceeded: ${projectedPct.toFixed(2)}% > ${this.hardLimit.value}%`,
      );
    }

    return {
      approved: failures.length === 0,
      currentUtilisation: this._utilisedAmount,
      utilisationPct: projectedPct,
      headroom,
      failureReasons: failures,
      checkedAt: new Date(),
      responseTimeMs: performance.now() - start,
    };
  }

  utilise(amount: Money): void {
    this._utilisedAmount = this._utilisedAmount.add(amount);
    const utilisationPct = (this._utilisedAmount.toNumber() / this.limitAmount.toNumber()) * 100;

    if (utilisationPct > this.hardLimit.value && !this._inBreach) {
      this._inBreach = true;
      this._domainEvents.push(new LimitBreachedEvent(this, amount, this.tenantId));
    } else {
      this._domainEvents.push(new LimitUtilisedEvent(this, this.tenantId));
    }
    this._version++;
  }

  release(amount: Money): void {
    const released = this._utilisedAmount.subtract(amount);
    this._utilisedAmount = Money.of(Math.max(0, released.toNumber()), amount.currency);

    const wasInBreach = this._inBreach;
    this._inBreach = this.utilisationPct > this.hardLimit.value;

    if (wasInBreach && !this._inBreach) {
      this._domainEvents.push(new LimitResolvedEvent(this, this.tenantId));
    }
    this._version++;
  }

  get utilisationPct(): number {
    return (this._utilisedAmount.toNumber() / this.limitAmount.toNumber()) * 100;
  }

  get utilisedAmount(): Money   { return this._utilisedAmount; }
  get inBreach(): boolean       { return this._inBreach; }
  get version(): number         { return this._version; }

  pullDomainEvents(): DomainEvent[] {
    const events = [...this._domainEvents];
    this._domainEvents.length = 0;
    return events;
  }
}

export interface LimitRepository {
  findById(id: LimitId, tenantId: TenantId): Promise<Limit | null>;
  findByCounterparty(counterpartyId: CounterpartyId, tenantId: TenantId): Promise<Limit[]>;
  findByBook(bookId: BookId, tenantId: TenantId): Promise<Limit[]>;
  findAllInBreach(tenantId: TenantId): Promise<Limit[]>;
  save(limit: Limit): Promise<void>;
  update(limit: Limit): Promise<void>;
}
