# Learner Guide 3: Domain-Driven Design in NexusTreasury

**Prerequisites:** [Guide 2 — Trade Lifecycle](./02-Trade-Lifecycle.md)
**Audience:** Engineers

**What you'll learn:** What Domain-Driven Design is, why NexusTreasury uses it,
and the specific patterns you'll encounter in the codebase.

---

## Why Domain-Driven Design?

Treasury systems have complex business rules:

- A trade cannot be settled before it is confirmed
- A position revaluation on a flat position should be a no-op
- An LCR breach must fire an alert even if the database write fails

Without DDD, these rules end up scattered: some in route handlers, some in SQL
triggers, some in cron jobs. When something goes wrong, no-one knows where to look.

DDD says: **all business rules live in the domain layer, and nothing else does.**
Infrastructure (databases, message queues, HTTP) is a detail. The domain is the truth.

---

## The Three Layers

```
┌──────────────────────────────────────────────────┐
│  Infrastructure Layer                            │
│  Fastify routes, Prisma repositories, Kafka      │
│  producers, WebSocket gateways                   │
│                                                  │
│  "HOW we store and transport data"               │
└─────────────────────┬────────────────────────────┘
                      │ depends on
┌─────────────────────▼────────────────────────────┐
│  Application Layer                               │
│  BookTradeCommand, PreDealCheckHandler,          │
│  LCRCalculator, SWIFTMatcher                     │
│                                                  │
│  "WHAT steps to take to accomplish a use case"   │
└─────────────────────┬────────────────────────────┘
                      │ depends on
┌─────────────────────▼────────────────────────────┐
│  Domain Layer (@nexustreasury/domain)            │
│  Trade, Position, Limit, LiquidityGapReport      │
│  Money, BusinessDate, DomainEvent                │
│                                                  │
│  "WHY the system behaves as it does"             │
│  This layer has ZERO infrastructure dependencies │
└──────────────────────────────────────────────────┘
```

The dependency arrow only points **down**. The domain layer never imports from
infrastructure. This is enforced structurally — `@nexustreasury/domain` has no
dependency on `@prisma/client`, `kafkajs`, or `fastify`.

---

## Aggregates

An **aggregate** is the core building block. It is:

- A cluster of related objects treated as one unit
- Controlled by a single root entity
- Protected by a boundary (only the aggregate can change its own state)
- The source of domain events

In NexusTreasury, the four aggregates are:
`Trade` · `Position` · `Limit` · `LiquidityGapReport`

### The Pattern (Every Aggregate Follows This)

```typescript
export class Trade {
  // 1. Private constructor — nobody can create a Trade except via factory methods
  private constructor(private readonly _props: TradeProps) {}

  // 2. Static factory method — enforces invariants before creating the object
  static book(params: BookTradeParams): Trade {
    if (params.notional.toNumber() <= 0) {
      throw new TradeDomainError('INVALID_NOTIONAL', 'Notional must be positive');
    }
    // ... more invariants ...
    const trade = new Trade({ ...params, status: TradeStatus.PENDING_VALIDATION });
    trade._domainEvents.push(new TradeBookedEvent(trade));
    return trade;
  }

  // 3. Command methods — change state and emit events
  amend(newNotional: Money, newPrice: number): void {
    if (this._props.status === TradeStatus.SETTLED) {
      throw new TradeDomainError('CANNOT_AMEND_SETTLED', '...');
    }
    // ... update state ...
    this._domainEvents.push(new TradeAmendedEvent(this, previousNotional));
  }

  // 4. Read-only accessors — expose state
  get id(): TradeId {
    return this._props.id;
  }
  get status(): TradeStatus {
    return this._props.status;
  }

  // 5. Event draining — infrastructure calls this to get events to publish
  pullDomainEvents(): DomainEvent[] {
    const events = [...this._domainEvents];
    this._domainEvents.length = 0; // clears the buffer
    return events;
  }
}
```

### Why Private Constructor?

If you could do `new Trade({ status: 'SETTLED' })` directly, you could bypass
all the invariants. The factory method is the only entry point, and it is
where invariants are enforced.

---

## Value Objects

A **value object** has no identity — two `Money` objects with the same amount
and currency are considered equal. Value objects are immutable.

```typescript
// Money is a value object
const a = Money.of(1000, 'USD');
const b = Money.of(1000, 'USD');
// a and b are "equal" even though they are different object instances

// Value objects return new instances from operations
const c = a.add(b); // c = 2000 USD, a and b are unchanged
```

Contrast with aggregates, which have identity:

```typescript
// Two trades with the same fields are NOT the same trade — they have different IDs
const t1 = Trade.book({ ...params });
const t2 = Trade.book({ ...params });
t1.id !== t2.id; // always true
```

---

## Domain Events

A **domain event** records that something happened. It is immutable (past tense),
named in the language of the business (not tech).

```
✅ TradeBookedEvent       — business language
❌ TradeInsertedEvent     — database language
❌ TradeCreatedEvent      — too generic
```

Events travel from domain → application → infrastructure:

```
Trade.book()
  └─► pushes TradeBookedEvent to _domainEvents buffer

BookTradeCommand.execute()
  ├── 1. calls tradeRepo.save(trade)     → database
  └── 2. calls producer.publish(events) → Kafka
                           ▲
                           events come from trade.pullDomainEvents()
```

This pattern ensures: **events are published only after the database write succeeds.**
If the database write fails, the event is never published. No ghost events.

---

## Repository Pattern

The domain defines **what** needs to be persisted. Infrastructure decides **how**.

```typescript
// In @nexustreasury/domain — the interface (no Prisma here)
export interface TradeRepository {
  findById(id: TradeId, tenantId: TenantId): Promise<Trade | null>;
  findByBookId(bookId: BookId, tenantId: TenantId): Promise<Trade[]>;
  save(trade: Trade): Promise<void>;
  update(trade: Trade): Promise<void>;
}

// In trade-service/src/infrastructure/postgres — the implementation
export class PrismaTradeRepository implements TradeRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async save(trade: Trade): Promise<void> {
    await this.prisma.trade.create({ data: this.toCreateRow(trade) });
  }
}
```

This means the domain is fully testable without a real database:

```typescript
const mockRepo: TradeRepository = {
  save: vi.fn().mockResolvedValue(undefined),
  // ...
};
const command = new BookTradeCommand(mockRepo, preDealCheck, kafkaProducer);
```

---

## Bounded Contexts

A **bounded context** is a boundary within which a domain model has a specific meaning.
In the `risk` context, a `Limit` is a credit exposure cap. In the `alm` context,
a `Limit` might mean a regulatory minimum. Different concepts — same word.

NexusTreasury has four bounded contexts with strict isolation:

```
Trading (trade-service)
  → publishes: TradeBookedEvent

Position (position-service)
  → consumes: TradeBookedEvent
  → never reads from trading.trades table directly

Risk (risk-service)
  → consumes: TradeBookedEvent (future)
  → maintains its own Limit model

ALM (alm-service)
  → generates reports on demand
  → does not subscribe to trade events (uses batch input)
```

**Cross-context communication is always via Kafka events — never via shared database tables.**

---

## Practical Cheatsheet

| If you need to...         | Where to look                                         |
| ------------------------- | ----------------------------------------------------- |
| Add a business rule       | `packages/domain/src/{context}/{aggregate}.ts`        |
| Change how data is stored | `packages/{service}/src/infrastructure/postgres/`     |
| Add a new API endpoint    | `packages/{service}/src/routes/{name}.routes.ts`      |
| Add a new domain event    | Aggregate file + domain index.ts export               |
| Test a business rule      | `packages/domain/src/{context}/{aggregate}.test.ts`   |
| Test an API endpoint      | `packages/{service}/src/routes/{name}.routes.test.ts` |

---

## Next Steps

**Next:** [Position Keeping Explained](./04-Position-Keeping.md)

You'll see how the `Position` aggregate is built up from trade events, and why
this matters for risk management and MTM reporting.
