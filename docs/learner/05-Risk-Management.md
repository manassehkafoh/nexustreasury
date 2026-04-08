# Learner Guide 5: Risk Management and Limit Controls

**Prerequisites:** [Guide 4 — Position Keeping](./04-Position-Keeping.md)

**What you'll learn:** How NexusTreasury prevents excessive risk-taking through
pre-deal checks, the four levels of limit controls, how VaR works, and what
happens when a limit is breached.

---

## Why Risk Limits Exist

Without controls, a single trader could theoretically commit the bank to
billions of dollars of exposure with a single transaction. In 2012, JP Morgan's
"London Whale" lost $6.2 billion partly because risk controls were bypassed.

NexusTreasury enforces limits **before every trade is booked** (pre-deal check).
A trade that would breach a limit is rejected — not flagged after the fact.

---

## The Four Limit Levels

NexusTreasury enforces limits at four levels of specificity:

```
LEGAL_ENTITY   (whole bank — $500M total FX exposure)
    │
    └── BOOK   (specific trading desk — $50M for the FX Spot desk)
        │
        ├── TRADER   (individual — $10M per trader per day)
        │
        └── COUNTERPARTY   (per bank — $25M with Deutsche Bank AG)
```

**All four levels are checked simultaneously** before a trade is booked.
If ANY level would be breached, the trade is rejected.

---

## Pre-Deal Check — Detailed Flow

```
POST /api/v1/trades receives a booking request
       │
       ▼
PreDealCheckService.check({
  tenantId,
  counterpartyId,
  requestedExposure: Money.of(12500000, 'USD')
})
       │
       ▼
Load all applicable Limit aggregates for this tenant + counterparty
  [Limit: COUNTERPARTY_CREDIT for Deutsche Bank, $50M limit, $38M utilised]
  [Limit: BOOK, FX Spot Book, $50M limit, $22M utilised]
  [Limit: TRADER, Jane Smith, $10M limit, $4.5M today utilised]
       │
       ▼
For each limit, call: limit.checkPreDeal(requestedExposure)
  COUNTERPARTY: $38M + $12.5M = $50.5M → 101% → BREACH → rejected
       │
       ▼
Return: {
  approved: false,
  utilisationPct: 101,
  headroomAmount: Money.of(0, 'USD'),
  failureReasons: ['COUNTERPARTY_CREDIT: $50.5M > $50M limit (101%)']
}
       │
       ▼
trade-service returns 422 Unprocessable Entity to the trader
```

**Target latency: P99 < 5ms** (Redis-cached limits, gRPC transport in production)

---

## Why Did My Pre-Deal Check Fail?

The API response tells you exactly which limit was breached:

```json
{
  "approved": false,
  "utilisationPct": 103.5,
  "failureReasons": ["COUNTERPARTY_CREDIT limit for cpty-001 would be exceeded: 103.5% > 100%"],
  "headroomAmount": 0,
  "currency": "USD"
}
```

**Common reasons:**

1. **Counterparty credit limit** — you've traded too much with this counterparty
2. **Book limit** — the desk's total risk capacity is full
3. **Trader limit** — the individual trader has hit their daily limit
4. **Legal entity limit** — the bank's total exposure cap is reached

**What to do:**

- Ask your risk manager to review and optionally increase the limit
- Reduce the trade size to fit within the available headroom
- In development mode, `PassThroughPreDealCheck` always approves — use this for testing

---

## Limit Utilisation Update

After a trade is booked (not before), the risk service updates the limit utilisation.
This happens asynchronously via Kafka:

```
Trade booked → TradeBookedEvent published
     │
     └──► risk-service consumes event (future implementation)
              → limit.utiliseLimitFor(tradeNotional)
              → if utilisationPct > warningThreshold → LimitUtilisedEvent
              → if utilisationPct > 100% → LimitBreachedEvent
```

The `warningThreshold` (e.g. 80%) triggers a warning before the limit is reached.

---

## Limit Breach vs Warning

| Condition                             | Action                           | Event                |
| ------------------------------------- | -------------------------------- | -------------------- |
| utilisation < warningThreshold        | No action                        | —                    |
| warningThreshold ≤ utilisation < 100% | Warning alert                    | `LimitUtilisedEvent` |
| utilisation ≥ 100%                    | Pre-deal rejected + breach alert | `LimitBreachedEvent` |

When a breach occurs, the alert goes to:

- The risk manager's dashboard (real-time WebSocket)
- Prometheus alert `LimitBreachDetected` (severity: critical)
- Kafka topic `nexus.risk.events`

---

## Value at Risk (VaR)

VaR answers: **"What is the most the bank could lose in a day, with 99% confidence?"**

Example: VaR = USD 2,400,000 at 99% confidence over 1 day means:
_"There is a 99% probability that the bank will not lose more than $2.4M tomorrow."_

NexusTreasury uses **Historical Simulation VaR**:

1. Collect the last 250 trading days of P&L for each position
2. Sort the P&L observations from worst to best
3. The 1st percentile observation (2.5th worst day out of 250) is the 1-day 99% VaR

**Endpoint:** `GET /api/v1/risk/var?bookId=<uuid>`

**Limitations to understand:**

- VaR does not capture tail risk beyond 99% (the 1% of scenarios)
- Historical VaR assumes history will repeat (fat tails in crises are underestimated)
- NexusTreasury also calculates stressed VaR using crisis periods (2008, 2020)

---

## Adding New Limit Types

To add a new limit type (e.g. `SECTOR_CONCENTRATION`):

1. Add `SECTOR_CONCENTRATION` to the `LimitType` enum in `limit.aggregate.ts`
2. Add the invariant check in `Limit.create()` if this type needs special validation
3. Update `checkPreDeal()` to load and check limits of this type
4. Update the risk-service routes to expose management endpoints for the new type
5. Add test cases to `limit.aggregate.test.ts`

---

## Next Steps

**Next:** [Asset-Liability Management (ALM)](./06-ALM-and-Liquidity.md)

You'll learn about the bank's liquidity position — not individual trade risk,
but the bank's ability to meet its obligations over the next 30 days and 1 year.
