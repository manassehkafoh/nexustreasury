# Learner Guide 4: Position Keeping Explained

**Prerequisites:** [Guide 3 — DDD in NexusTreasury](./03-DDD-in-NexusTreasury.md)

**What you'll learn:** What a position is, how it is calculated, how NexusTreasury
keeps positions updated in real time, and why accuracy matters for risk and P&L.

---

## What Is a Position?

A **position** is the net quantity of an instrument that a book currently holds.

| Time  | Event               | Quantity    | Running Position |
| ----- | ------------------- | ----------- | ---------------- |
| 09:00 | Buy USD 10,000,000  | +10,000,000 | +10,000,000      |
| 10:30 | Buy USD 5,000,000   | +5,000,000  | +15,000,000      |
| 11:15 | Sell USD 3,000,000  | -3,000,000  | +12,000,000      |
| 14:00 | Sell USD 12,000,000 | -12,000,000 | 0 (flat)         |

A position of zero is called **flat**. A positive quantity is a **long** position
(you own the asset). A negative quantity is a **short** position (you owe the asset).

---

## What a Position Tracks

Each `Position` aggregate stores:

| Field                 | Meaning                                                    |
| --------------------- | ---------------------------------------------------------- |
| `netQuantity`         | Current net quantity (long is positive, short is negative) |
| `averageCostAmount`   | Weighted average price of the long position                |
| `mtmValueAmount`      | Current market value at today's price                      |
| `unrealisedPnlAmount` | Profit/loss if the position were closed right now          |
| `currency`            | The currency in which MTM is expressed                     |
| `version`             | Optimistic concurrency counter                             |

---

## How Positions Are Updated

NexusTreasury does not recalculate positions on demand. Instead, position-service
listens to Kafka and updates positions **in real time** as trades are booked.

```
Trader books FX trade
       │
       ▼
trade-service publishes TradeBookedEvent
  to nexus.trading.trades (Kafka)
       │
       ▼
position-service consumes the event
  (PositionKafkaConsumer.onTradeBooked)
       │
       ▼
Load existing Position from DB (or create new)
       │
       ▼
position.applyTradeBooked(event)
  → update netQuantity
  → recalculate averageCost
  → emit PositionUpdatedEvent
       │
       ▼
Save updated Position to PostgreSQL
```

The typical latency from trade booking to position update is **50–200ms**
(Kafka propagation + position-service processing time).

---

## Average Cost Calculation

**Why do we track average cost?**

If you buy 100 units at $10 and then buy 50 more at $12, your total cost is $1,600
for 150 units. Your average cost is $10.67 per unit, not $12. This matters because:

1. **P&L is calculated against average cost** — if the market price is $11,
   your unrealised P&L per unit is $11 - $10.67 = $0.33
2. **It correctly handles partial sells** — if you sell 50 units, the average
   cost of the remaining 100 units is still $10.67

**Formula (weighted average cost):**

```
new average cost = (old average cost × old quantity + new trade price × new quantity)
                   ─────────────────────────────────────────────────────────────────
                              (old quantity + new quantity)
```

**Example:**

| Event         | Qty        | Price  | Average Cost       | Net Position |
| ------------- | ---------- | ------ | ------------------ | ------------ |
| Initial state | —          | —      | —                  | 0            |
| Buy 1,000,000 | +1,000,000 | 1.0842 | 1.0842             | 1,000,000    |
| Buy 500,000   | +500,000   | 1.0891 | 1.0858             | 1,500,000    |
| Sell 200,000  | -200,000   | —      | 1.0858 (unchanged) | 1,300,000    |

---

## Mark-to-Market (MTM) Revaluation

MTM answers: **"What is my position worth right now?"**

```
MTM Value     = netQuantity × currentMarketPrice
Unrealised P&L = MTM Value − (netQuantity × averageCostAmount)
```

**Example:**

- Long 1,300,000 EUR/USD at average cost 1.0858
- Current market rate: 1.0920
- MTM Value = 1,300,000 × 1.0920 = **USD 1,419,600**
- Unrealised P&L = 1,419,600 − (1,300,000 × 1.0858) = **+USD 8,060**

Revaluation is triggered whenever `market-data-service` publishes a new rate
to `nexus.marketdata.rates`. The position-service consumes this and calls
`position.revalue(newPrice)` for each affected position.

---

## Flat Positions

A position with `netQuantity === 0` is called **flat**.

- Flat positions are skipped in MTM revaluation (no-op)
- `isFlat` getter returns `true`
- P&L is zero for a flat position

When a position goes flat (buy and sell quantities match perfectly), the
`unrealisedPnlAmount` becomes zero. Any P&L was realised when the offsetting
trade was executed.

---

## Event Sourcing vs Snapshot

NexusTreasury uses a **hybrid approach**:

| Approach  | How it works            | Used for                           |
| --------- | ----------------------- | ---------------------------------- |
| Snapshot  | Store the current state | Fast queries (position dashboard)  |
| Event log | Store every trade event | Audit trail, point-in-time queries |

The `position_events` table stores every trade event for complete auditability.
The `positions` table stores the latest snapshot for fast reads.

---

## Common Questions

**Q: Why does my position show a different value than expected?**
Check if all trade events have been processed by the consumer.
See the [Troubleshooting Guide](../wiki/Troubleshooting.md#position-not-updating).

**Q: Can a position go negative?**
Yes — a short position has a negative `netQuantity`. This is valid for
asset classes that support short selling (equities, commodities, some fixed income).

**Q: What happens when I cancel a trade?**
`position-service` consumes `TradeCancelledEvent` and calls `position.applyCancelledTrade()`,
reversing the position effect. The average cost and MTM are recalculated.

---

## Next Steps

**Next:** [Risk Management and Limit Controls](./05-Risk-Management.md)

You'll learn how the system uses positions to enforce risk limits, what
pre-deal checks are, and how VaR is calculated.
