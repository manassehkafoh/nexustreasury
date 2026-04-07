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

// FIX HIGH-009: Domain error class for Limit context
export class LimitDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'LimitDomainError';
  }
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
    public readonly warningThreshold: Percentage,
    public readonly hardLimit: Percentage,
    private readonly _entityId: string,
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
    // FIX HIGH-009: Invariant — limit amount must be positive
    if (params.limitAmount.toNumber() <= 0) {
      throw new LimitDomainError('INVALID_LIMIT_AMOUNT', 'Limit amount must be positive');
    }
    if (params.warningThreshold.value >= 100) {
      throw new LimitDomainError(
        'INVALID_WARNING_THRESHOLD',
        'Warning threshold must be below 100%',
      );
    }

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
   * Pre-deal check — synchronous gRPC gate. Target P99 < 5ms.
   */
  checkPreDeal(request: PreDealCheckRequest): PreDealCheckResponse {
    const start = Date.now();
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
      responseTimeMs: Date.now() - start,
    };
  }

  utilise(amount: Money): void {
    // FIX HIGH-009: Invariant — cannot utilise a negative amount
    if (amount.toNumber() <= 0) {
      throw new LimitDomainError('INVALID_UTILISATION', 'Utilisation amount must be positive');
    }

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
    // FIX HIGH-009: Invariant — cannot release more than utilised
    if (amount.toNumber() > this._utilisedAmount.toNumber()) {
      throw new LimitDomainError(
        'OVER_RELEASE',
        `Cannot release ${amount.toString()} — only ${this._utilisedAmount.toString()} is utilised`,
      );
    }

    this._utilisedAmount = this._utilisedAmount.subtract(amount);
    const wasInBreach = this._inBreach;
    this._inBreach = this.utilisationPct > this.hardLimit.value;

    if (wasInBreach && !this._inBreach) {
      this._domainEvents.push(new LimitResolvedEvent(this, this.tenantId));
    }
    this._version++;
  }

  get utilisationPct(): number   { return (this._utilisedAmount.toNumber() / this.limitAmount.toNumber()) * 100; }
  get utilisedAmount(): Money    { return this._utilisedAmount; }
  get inBreach(): boolean        { return this._inBreach; }
  get version(): number          { return this._version; }

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
