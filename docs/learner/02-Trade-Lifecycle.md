# Learner Guide 2: Trade Lifecycle — From Booking to Settlement

**Prerequisites:** [Guide 1 — What Is a TMS?](./01-What-Is-a-TMS.md)

**What you'll learn:** The complete journey of a single trade through NexusTreasury,
from the moment a trader enters it to final settlement.

---

## The Complete Trade Journey

```
Trader enters deal
       │
       ▼
[1] Validation
    Zod schema check: are all fields present and correct?
       │
       ▼
[2] Pre-Deal Limit Check (P99 < 5ms)
    risk-service: would this trade breach any limits?
       │
    ┌──┴──┐
    │     │
  PASS   FAIL ──► 422 response + failureReasons
    │
    ▼
[3] Trade.book() — Domain Aggregate
    Enforces all business rules (invariants)
    Creates TradeBookedEvent
       │
       ▼
[4] Persist to PostgreSQL
    trades table + trade_events outbox table
       │
       ▼
[5] Publish to Kafka
    nexus.trading.trades topic
       │
       ├──► position-service ──► Update position
       │
       └──► bo-service ──► Await SWIFT confirmation
       │
       ▼
[6] 201 Response to trader
    { tradeId, reference: "FX-20260407-A3B2C1", status: "PENDING_VALIDATION" }
       │
       ▼
[7] WebSocket push to blotter
    Trade appears in real-time on all connected screens

--- (asynchronous from here) ---

[8] Counterparty sends SWIFT MT300
    bo-service auto-matches against the trade

[9] Trade moves to CONFIRMED
    (after validation workflow)

[10] Settlement date arrives
     Cash moves via Nostro accounts
     trade.settle() called
     Status: SETTLED
```

---

## Step-by-Step Detail

### Step 1: Validation

The API route handler calls `BookTradeSchema.safeParse(request.body)`.
If any field is invalid (wrong assetClass, negative notional, missing counterpartyId),
the response is immediately `400 Bad Request` with field-level error messages:

```json
{
  "error": "VALIDATION_ERROR",
  "message": "assetClass: Invalid enum value. Expected 'FX' | 'FIXED_INCOME' | ..."
}
```

No database calls are made. The trade is rejected before any processing begins.

### Step 2: Pre-Deal Limit Check

`PassThroughPreDealCheck` is used in development (always approves).
`GrpcPreDealCheck` is used in production (calls `risk-service:50051` via gRPC).

The check queries all counterparty limits and calculates:

- `utilisationPct` — what % of the limit would be used after this trade
- `headroomAmount` — how much more could be traded within the limit
- `approved` — true if NO limit would be exceeded

Target: P99 < 5ms (gRPC + Redis cached limits).

If `approved: false`, the response is `422 Unprocessable Entity`:

```json
{
  "approved": false,
  "failureReasons": ["COUNTERPARTY_CREDIT limit would be exceeded: 107.3% > 100%"],
  "utilisationPct": 107.3
}
```

### Step 3: Domain Aggregate — `Trade.book()`

This is where business rules are enforced. The `Trade` aggregate:

1. Validates all invariants (notional > 0, valueDate >= tradeDate, etc.)
2. Creates an immutable `TradeProps` object
3. Pushes a `TradeBookedEvent` to its internal `_domainEvents` buffer
4. Returns the new `Trade` instance

If any invariant fails, `TradeDomainError` is thrown:

```typescript
// This invariant check is inside Trade.book()
if (params.notional.toNumber() <= 0) {
  throw new TradeDomainError('INVALID_NOTIONAL', 'Notional must be positive');
}
```

### Step 4: Persistence

Two writes happen in sequence:

1. `INSERT INTO trading.trades (...)` — the trade record
2. `INSERT INTO trading.trade_events (...)` — the event outbox entry

The event outbox ensures that even if Kafka is temporarily down, the event will
eventually be published (a background process reads the outbox table and retries).

### Steps 5–7: Kafka and WebSocket

After persisting, the `TradeBookedEvent` is published to `nexus.trading.trades`.
Simultaneously, the HTTP response is sent to the trader (`201 Created`).
The `BlotterGateway` broadcasts the new trade row to all connected WebSocket clients,
so the blotter updates in real-time without the trader needing to refresh.

### Steps 8–10: Back Office and Settlement

These steps are asynchronous. The counterparty's SWIFT system sends a confirmation
(MT300 for FX, MT320 for money market) via SWIFT network to the bank's SWIFT interface,
which forwards it to `POST /api/v1/bo/swift/inbound`.

The `SWIFTMatcher` scores the message against known trades based on:

- Trade reference number match
- Counterparty BIC match
- Value date match
- Notional amount match
- Exchange rate match

Score ≥ 80 → `MATCHED` → trade can proceed to `CONFIRMED`.

On settlement date, the back-office system instructs Nostro banks to transfer funds.
`trade.settle()` is called, moving the trade to `SETTLED`.

---

## Trade Status Reference

| Status               | Meaning                                   | Next valid statuses      |
| -------------------- | ----------------------------------------- | ------------------------ |
| `PENDING_VALIDATION` | Booked, awaiting validation               | `VALIDATED`, `CANCELLED` |
| `VALIDATED`          | Passed validation checks                  | `CONFIRMED`, `CANCELLED` |
| `CONFIRMED`          | Counterparty confirmed                    | `SETTLED`, `AMENDED`     |
| `AMENDED`            | Notional/price changed after confirmation | `CONFIRMED`, `CANCELLED` |
| `CANCELLED`          | Voided — no settlement                    | _(terminal)_             |
| `SETTLED`            | Cash exchanged — complete                 | _(terminal)_             |

---

## Next Steps

**Next:** [Domain-Driven Design in NexusTreasury](./03-DDD-in-NexusTreasury.md)

This guide explains the technical architecture behind what you just saw —
why the system is structured the way it is, and how to work with it as an engineer.
