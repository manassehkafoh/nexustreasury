# Domain Model Deep Dive

The domain model is the core of NexusTreasury. Everything else — Kafka producers,
Prisma repositories, Fastify routes — exists only to serve the domain.

All domain code lives in `packages/domain/src/`.

---

## Shared Kernel (`src/shared/`)

### Branded Types (`value-objects.ts`)

Branded types prevent mixing up different ID types at compile time. You cannot
accidentally pass a `TradeId` where a `PositionId` is expected.

```typescript
// This WON'T compile — TradeId cannot be assigned to PositionId
const tradeId: TradeId = TradeId('abc-123');
const positionId: PositionId = tradeId; // ❌ Type error

// Constructor functions create branded types safely
const id = TradeId(randomUUID()); // ✅
```

### Money

`Money` uses `bigint` internally to avoid floating-point precision errors.
All financial amounts in NexusTreasury are represented as `Money`.

```typescript
const notional = Money.of(12_500_000, 'USD'); // 12.5 million USD
notional.toNumber(); // 12500000
notional.currency; // 'USD'
notional.add(Money.of(500_000, 'USD')); // 13_000_000 USD
notional.add(Money.of(100, 'EUR')); // ❌ Throws — currency mismatch
notional.toString(); // '12500000 USD'
```

### BusinessDate

Dates in treasury are business dates — not timestamps. `BusinessDate` is immutable
and carries year/month/day without timezone ambiguity.

```typescript
const t = BusinessDate.today();
const v = t.addDays(2); // Value date: T+2
t.isBefore(v); // true
t.toString(); // '2026-04-07'
t.toDate(); // native Date object
```

### DomainEvent

Every aggregate change produces a `DomainEvent`. Events are buffered in `_domainEvents[]`
and pulled by calling `pullDomainEvents()`, which clears the buffer.

```typescript
// Pattern: every command method buffers an event
amend(newNotional: Money, newPrice: number): void {
  // ... change state ...
  this._domainEvents.push(new TradeAmendedEvent(this, previousNotional));
}

// Pattern: infrastructure pulls and publishes events after persist
const trade = Trade.book(params);
await tradeRepo.save(trade);
const events = trade.pullDomainEvents(); // clears buffer
await kafkaProducer.publishDomainEvents(events);
```

---

## Trade Aggregate (`src/trading/trade.aggregate.ts`)

The central entity. Every other aggregate in the system reacts to events
produced by Trade.

### Lifecycle State Machine

```
                                     amend()
                                  ┌───────────┐
                                  ▼           │
  PENDING_VALIDATION → VALIDATED → CONFIRMED → AMENDED
         │                                     │
         │                                     │
         └──────────── cancel() ───────────────┘
                              │
                              ▼
                          CANCELLED

  CONFIRMED → settle() → SETTLED
```

**Rules enforced by invariants (throw `TradeDomainError` on violation):**

- `notional > 0` — zero or negative notional is rejected
- `valueDate >= tradeDate` — you cannot settle before you trade
- `notionalCurrency` must be exactly 3 characters (ISO 4217)
- Cannot amend a `SETTLED` or `CANCELLED` trade
- Cannot cancel a `SETTLED` trade
- Cannot confirm a non-`VALIDATED` trade
- Cannot settle a non-`CONFIRMED` trade
- Pre-deal check must be `approved: true` to book

### Domain Events Produced

| Event                 | `eventType`                     | When fired              |
| --------------------- | ------------------------------- | ----------------------- |
| `TradeBookedEvent`    | `nexus.trading.trade.booked`    | `Trade.book()` succeeds |
| `TradeAmendedEvent`   | `nexus.trading.trade.amended`   | `trade.amend()` called  |
| `TradeCancelledEvent` | `nexus.trading.trade.cancelled` | `trade.cancel()` called |
| `TradeSettledEvent`   | `nexus.trading.trade.settled`   | `trade.settle()` called |

### Factory Method: `Trade.book()`

```typescript
const trade = Trade.book({
  tenantId: TenantId('bank-001'),
  assetClass: AssetClass.FX,
  direction: TradeDirection.BUY,
  counterpartyId: CounterpartyId('cpty-001'),
  instrumentId: InstrumentId('EUR/USD'),
  bookId: BookId('fx-book-001'),
  traderId: TraderId('trader-jane'),
  notional: Money.of(5_000_000, 'USD'),
  price: 1.0842,
  tradeDate: BusinessDate.today(),
  valueDate: BusinessDate.today().addDays(2),
  preDealCheck: { approved: true, ... }
});
```

### Extending: Adding a New Asset Class

1. Add the enum value to `AssetClass` in `trade.aggregate.ts`
2. Add any asset-class-specific invariants to `Trade.book()`
3. Add the value to the `BookTradeSchema` Zod enum in `trade.routes.ts`
4. Update the OpenAPI spec at `packages/trade-service/openapi/trade-service.yaml`
5. Add a test case to `trade.aggregate.test.ts`

---

## Position Aggregate (`src/position/position.aggregate.ts`)

Event-sourced. Rebuilt by replaying `TradeBookedEvent` and `TradeCancelledEvent`.

### What "event-sourced" means here

The `Position` aggregate does not recalculate from scratch on every query.
Instead, the position-service maintains a **snapshot** in the `positions` table
and updates it whenever a trade event arrives via Kafka.

The snapshot stores: `netQuantity`, `averageCostAmount`, `mtmValueAmount`,
`unrealisedPnlAmount`, and `version`.

### Average Cost Calculation

When a BUY trade arrives for an existing long position:

```
newAvgCost = (oldAvgCost × oldQty + newPrice × newQty) / (oldQty + newQty)
```

When the direction reverses (adding a SELL to a long position), the average
cost is not recalculated — only the quantity changes.

### MTM and Unrealised P&L

`revalue(currentMarketPrice)` is called when a new market rate arrives:

```
mtmValue     = netQuantity × currentMarketPrice
unrealisedPnl = mtmValue − (netQuantity × averageCost)
```

A flat position (`netQuantity === 0`) is skipped — `revalue()` is a no-op.

---

## Limit Aggregate (`src/risk/limit.aggregate.ts`)

Enforces exposure controls before every trade booking.

### Limit Levels

```
LEGAL_ENTITY  — Applies to the whole institution
    └── BOOK  — Applies to a specific trading book
        └── TRADER  — Applies to an individual trader
        └── COUNTERPARTY — Applies to one counterparty
```

### Pre-Deal Check Flow

```typescript
// 1. Load applicable limits for the counterparty
const limits = await limitRepo.findByCounterparty(counterpartyId, tenantId);

// 2. For each limit, check if the new trade would breach it
for (const limit of limits) {
  const result = limit.checkPreDeal({ counterpartyId, requestedExposure, tenantId });
  if (!result.approved) failures.push(...result.failureReasons);
}

// 3. Return combined result
return { approved: failures.length === 0, headroom, utilisationPct, ... };
```

### Invariants

- Limit amount must be positive (throws `LimitDomainError('INVALID_LIMIT_AMOUNT')`)
- Warning threshold must be < 100% (throws `LimitDomainError('INVALID_WARNING_THRESHOLD')`)
- Utilisation amount must be positive (throws `LimitDomainError('INVALID_UTILISATION')`)
- Cannot release more than is utilised (throws `LimitDomainError('OVER_RELEASE')`)

---

## LiquidityGapReport Aggregate (`src/alm/liquidity-gap.aggregate.ts`)

Generated on-demand or on schedule. Immutable once created.

### What it Calculates

1. **Cash flow gaps** across 9 BCBS time buckets (Overnight → Over 5 Years)
2. **Cumulative gaps** — running total of inflows minus outflows
3. **LCR ratio** = Total HQLA after haircuts / Net stress outflows over 30 days
4. **NSFR ratio** = Available Stable Funding / Required Stable Funding

### Basel III HQLA Haircuts

```
Level 1 assets (cash, CB deposits, govvies): 0% haircut
Level 2A assets (agency, covered bonds):    15% haircut
Level 2B assets (corp bonds, equities):     25% haircut

Caps (applied after haircuts):
  Level 2 total ≤ 40% of total HQLA
  Level 2B total ≤ 15% of total HQLA
```

### Compliance Thresholds

| Ratio | Minimum required | Alert threshold                                   |
| ----- | ---------------- | ------------------------------------------------- |
| LCR   | 100%             | < 110% triggers warning, < 100% triggers critical |
| NSFR  | 100%             | < 100% triggers critical                          |
