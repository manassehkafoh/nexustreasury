# Day 2–3 — Domain Model Deep Dive

## Aggregates you'll work with most

### LimitAggregate (`risk-service`)
The pre-deal check gate. Every trade booking calls `Limit.checkPreDeal()` synchronously before writing the trade. The `Limit` class enforces the invariant that projected utilisation never silently exceeds 100% of the hard limit — it throws `LimitDomainError` instead.

```typescript
// Correct pattern: create → check → utilise
const limit = Limit.create({ limitType: LimitType.COUNTERPARTY_CREDIT, ... });
const result = limit.checkPreDeal({ requestedExposure: Money.of(500_000, 'USD'), tenantId });
if (!result.approved) throw new Error(result.failureReasons[0]);
limit.utilise(Money.of(500_000, 'USD'));
const events = limit.pullDomainEvents(); // drain and dispatch to Kafka
```

### LiquidityGapReport (`alm-service`)
Immutable value object created by `LiquidityGapReport.generate()`. Contains the full LCR/NSFR calculation from raw bucket inflows/outflows. Never mutate — create a new report for each reporting period.

### PricingEngine (`domain`)
The main pricing facade. Accepts all instrument types via typed input interfaces. Behind the scenes delegates to specialised pricers (FXPricer, BondPricer, IRSPricer, BarrierOptionPricer, SukukPricer, VannaVolgaPricer). Always instantiate a single engine per request context — it is not thread-safe across concurrent requests in the same instance.

---

## Value objects

Value objects have no identity — two Money objects with the same amount and currency are equal. Never expose mutable state.

```typescript
const usd = Money.of(1_000_000, 'USD');
const eur = Money.of(850_000, 'EUR');
// usd.add(eur) → throws Error: currency mismatch
const total = usd.add(Money.of(500_000, 'USD')); // → Money { amount: 1_500_000, currency: 'USD' }
```

Key value objects: `Money`, `YieldCurve`, `Percentage`, `BusinessDate`, `TenantId`, `CounterpartyId`.

---

## Domain events

Every aggregate produces domain events that are drained and published to Kafka:

```typescript
// After an aggregate mutation, always drain events
limit.utilise(Money.of(1_200_000, 'USD')); // triggers LimitBreachedEvent
const events = limit.pullDomainEvents();
for (const event of events) {
  await kafkaProducer.send(event.eventType, event);
}
```

Never skip event draining. The audit trail and downstream services depend on every event being published.

---

## Bounded context rules

1. **domain** is the shared kernel — no service-specific imports allowed inside it
2. **Never import from one service package into another** — use events (Kafka) or shared domain types
3. **Repository interfaces** live in domain; implementations live in the service's `infrastructure/` folder
4. **Application handlers** orchestrate domain objects + repository + Kafka — no business logic in handlers
