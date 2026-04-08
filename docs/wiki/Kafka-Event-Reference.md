# Kafka Event Reference

Every state change in NexusTreasury produces a domain event that is published to Kafka.
This document describes every topic, event type, and payload schema.

---

## Topic Directory

| Topic                      | Producer            | Consumers                                     | Purpose                    |
| -------------------------- | ------------------- | --------------------------------------------- | -------------------------- |
| `nexus.trading.trades`     | trade-service       | position-service, risk-service, bo-service    | All trade lifecycle events |
| `nexus.position.positions` | position-service    | web (dashboard)                               | Position updates           |
| `nexus.risk.events`        | risk-service        | trade-service, web                            | Limit breach alerts        |
| `nexus.alm.events`         | alm-service         | web                                           | LCR/NSFR events            |
| `nexus.marketdata.rates`   | market-data-service | risk-service, position-service, trade-service | Real-time rate ticks       |

---

## Base Event Schema

Every event shares this base structure:

```typescript
interface DomainEvent {
  eventId: string; // UUID — unique per event, used for idempotency
  eventType: string; // e.g. 'nexus.trading.trade.booked'
  aggregateId: string; // ID of the aggregate that produced this event
  tenantId: string; // Multi-tenant isolation
  occurredAt: Date; // When the event occurred (domain time)
}
```

---

## nexus.trading.trades

### TradeBookedEvent — `nexus.trading.trade.booked`

Fired when a trade is successfully booked via `Trade.book()`.

```typescript
{
  eventId:    "evt-uuid-001",
  eventType:  "nexus.trading.trade.booked",
  aggregateId: "trade-uuid-001",   // tradeId
  tenantId:   "bank-001",
  occurredAt: "2026-04-07T10:15:00.000Z",
  trade: {
    id:               "trade-uuid-001",
    reference:        "FX-20260407-A3B2C1",
    assetClass:       "FX",
    direction:        "BUY",
    status:           "PENDING_VALIDATION",
    counterpartyId:   "cpty-uuid",
    instrumentId:     "instr-uuid",
    bookId:           "book-uuid",
    traderId:         "trader-uuid",
    notional: {
      amount:   12500000,
      currency: "USD"
    },
    price:      1.0842,
    tradeDate:  "2026-04-07",
    valueDate:  "2026-04-09"
  }
}
```

**Consumers:**

- **position-service** — creates or updates the relevant position
- **bo-service** — awaits SWIFT confirmation for auto-matching
- **risk-service** (future) — updates counterparty utilisation

---

### TradeAmendedEvent — `nexus.trading.trade.amended`

Fired when `trade.amend()` is called.

```typescript
{
  eventType:  "nexus.trading.trade.amended",
  aggregateId: "trade-uuid-001",
  trade: { /* updated Trade snapshot */ },
  previousNotional: { amount: 12500000, currency: "USD" }
}
```

---

### TradeCancelledEvent — `nexus.trading.trade.cancelled`

Fired when `trade.cancel()` is called.

```typescript
{
  eventType:  "nexus.trading.trade.cancelled",
  aggregateId: "trade-uuid-001",
  trade: { /* Trade snapshot with status: CANCELLED */ },
  reason: "Incorrect counterparty"
}
```

**Consumers:**

- **position-service** — reverses the position effect via `applyCancelledTrade()`

---

### TradeSettledEvent — `nexus.trading.trade.settled`

```typescript
{
  eventType:  "nexus.trading.trade.settled",
  aggregateId: "trade-uuid-001",
  trade: { /* Trade snapshot with status: SETTLED */ }
}
```

---

## nexus.position.positions

### PositionUpdatedEvent — `nexus.position.position.updated`

```typescript
{
  eventType:  "nexus.position.position.updated",
  aggregateId: "pos-uuid-001",
  position: {
    id:               "pos-uuid-001",
    tenantId:         "bank-001",
    instrumentId:     "instr-uuid",
    bookId:           "book-uuid",
    currency:         "USD",
    netQuantity:      12500000,
    averageCostAmount: 1.0842,
    mtmValueAmount:   12550000,
    unrealisedPnlAmount: 50000
  }
}
```

### PositionRevaluedEvent — `nexus.position.position.revalued`

```typescript
{
  eventType:  "nexus.position.position.revalued",
  aggregateId: "pos-uuid-001",
  position:  { /* Position snapshot with updated MTM */ },
  previousMtm: { amount: 12520000, currency: "USD" }
}
```

---

## nexus.risk.events

### LimitBreachedEvent — `nexus.risk.limit.breached`

```typescript
{
  eventType:  "nexus.risk.limit.breached",
  aggregateId: "limit-uuid-001",
  limit: {
    id:              "limit-uuid-001",
    limitType:       "COUNTERPARTY_CREDIT",
    level:           "COUNTERPARTY",
    limitAmount:     50000000,
    utilisedAmount:  51250000,
    utilisationPct:  102.5,
    inBreach:        true
  },
  requestedAmount: { amount: 5000000, currency: "USD" }
}
```

**Action required:** Risk manager must review and either increase the limit
or instruct the trader to reduce exposure.

### LimitUtilisedEvent — `nexus.risk.limit.utilised`

Fired on every utilisation update (not just breaches). Useful for
building real-time utilisation dashboards.

### LimitResolvedEvent — `nexus.risk.limit.resolved`

Fired when utilisation drops back below the hard limit (e.g., after a trade cancellation).

---

## nexus.alm.events

### LiquidityGapReportGeneratedEvent — `nexus.alm.liquidity-gap.generated`

```typescript
{
  eventType:  "nexus.alm.liquidity-gap.generated",
  aggregateId: "rpt-uuid-001",
  report: {
    id:       "rpt-uuid-001",
    scenario: "CONTRACTUAL",
    lcr: { lcrRatio: 161.11, isCompliant: true },
    nsfr: { nsfrRatio: 117.65, isCompliant: true }
  }
}
```

### LCRBreachEvent — `nexus.alm.lcr.breach`

```typescript
{
  eventType:  "nexus.alm.lcr.breach",
  aggregateId: "evt-uuid",
  lcr: {
    lcrRatio:         89.4,
    isCompliant:      false,
    totalHQLA:        805000000,
    netCashOutflows30d: 900000000
  }
}
```

**Action required:** ALM team must immediately review the liquidity position.
This is a regulatory breach if LCR < 100% persists for more than 30 days.

---

## nexus.marketdata.rates

### MarketRate (not a domain event — a raw data message)

```typescript
{
  instrument:  "EURUSD",
  bid:         1.08415,
  ask:         1.08425,
  mid:         1.08420,
  currency:    "USD",
  tenor:       "SPOT",
  timestamp:   "2026-04-07T10:15:03.421Z",
  source:      "BLOOMBERG"   // or REFINITIV, MOCK
}
```

**Published every 5 seconds per instrument.**
**Instruments currently published:**
`EURUSD` · `GBPUSD` · `USDJPY` · `USDGHS` · `USDNGN` · `EURGBP` · `XAUUSD`

---

## Event Idempotency

All event consumers should use `eventId` for deduplication.

```typescript
// Example: position-service idempotent event processing
await consumer.run({
  eachMessage: async ({ message }) => {
    const event = JSON.parse(message.value.toString());
    // Check if already processed (store eventId in processed_events table)
    if (await alreadyProcessed(event.eventId)) return;
    await processEvent(event);
    await markProcessed(event.eventId);
  },
});
```

---

## Kafka Topic Configuration

| Setting              | Value       | Rationale                           |
| -------------------- | ----------- | ----------------------------------- |
| Replication factor   | 3           | Survives 2 broker failures          |
| Min in-sync replicas | 2           | Prevents data loss on writes        |
| Retention            | 7 days      | Allows replay for up to a week      |
| Producer idempotent  | true        | Exactly-once at the producer        |
| Consumer group       | per-service | Each service manages its own offset |
