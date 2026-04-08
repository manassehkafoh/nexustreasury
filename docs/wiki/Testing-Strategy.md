# Testing Strategy

NexusTreasury uses a three-layer testing pyramid: unit tests at the base,
integration tests in the middle, and E2E tests at the top.

---

## The Testing Pyramid

```
          ┌─────────────┐
          │    E2E      │  ~20 tests
          │  Playwright │  Full user flows
          └──────┬──────┘
         ┌───────┴───────┐
         │  Integration  │  ~50 tests
         │  docker-compose│  Real Kafka, Postgres
         └───────┬───────┘
      ┌──────────┴──────────┐
      │    Unit Tests       │  ~200+ tests
      │    Vitest + mocks   │  No infra needed
      └─────────────────────┘
```

**Philosophy:** Most bugs live in business logic (domain layer). Test that layer
extensively with fast unit tests. Use integration tests to verify wiring.
Use E2E tests to verify user-facing flows.

---

## Unit Tests

**Framework:** Vitest v1.6
**Location:** `src/**/*.test.ts` in each package
**Runs:** `pnpm test` or `pnpm --filter @nexustreasury/<package> test`

### Domain Tests

The domain layer is tested in pure isolation — no mocks of infrastructure needed:

```typescript
// packages/domain/src/trading/trade.aggregate.test.ts
it('throws TradeDomainError when booking with negative notional', () => {
  expect(() =>
    Trade.book({
      ...validParams,
      notional: Money.of(-100, 'USD'),
    }),
  ).toThrow(TradeDomainError);
});
```

**Coverage thresholds (enforced in CI):**

| Metric     | Threshold |
| ---------- | --------- |
| Lines      | 80%       |
| Functions  | 80%       |
| Branches   | 70%       |
| Statements | 80%       |

**Current domain coverage:** 96.83% lines / 92.07% functions

### Service Tests

Service tests mock infrastructure and focus on application logic:

```typescript
// Test a route handler without real Kafka or Postgres
vi.mock('../infrastructure/kafka/producer.js', () => ({
  KafkaProducer: vi.fn().mockImplementation(() => ({
    connect: vi.fn(),
    publishDomainEvents: vi.fn(),
  })),
}));
```

Infrastructure files (health routes, Kafka producers, Prisma repositories)
are excluded from unit coverage — they require real connections and are
tested via integration tests.

---

## Integration Tests

Integration tests run against real infrastructure via Docker Compose.
They verify that the whole stack works together: service → Kafka → database.

**Running integration tests:**

```bash
docker-compose up -d postgres kafka redis
pnpm --filter @nexustreasury/trade-service test:integration
```

**Key integration scenarios:**

1. POST /trades → Kafka event produced → position-service updates position
2. SWIFT message received → SWIFTMatcher → trade confirmed
3. LCR calculation → report stored → LCR breach alert fired

---

## End-to-End Tests (E2E)

**Framework:** Playwright
**Location:** `packages/web/tests/e2e/`
**Runs:** `pnpm test:e2e` (requires full docker-compose stack)

**Key E2E scenarios:**

1. Trader logs in → books an FX trade → trade appears in blotter
2. Trade booked → position updates in real-time on dashboard
3. LCR ratio displayed correctly on liquidity dashboard
4. Risk limit breach → alert shown on risk panel

---

## Test Data and Factories

All tests use consistent factory functions to build test data:

```typescript
// Domain test factories (in test files)
const validBookParams = {
  tenantId: TenantId('tenant-001'),
  assetClass: AssetClass.FX,
  direction: TradeDirection.BUY,
  counterpartyId: CounterpartyId('3fa85f64-5717-4562-b3fc-2c963f66afa6'),
  instrumentId: InstrumentId('7a1b2c3d-4e5f-6789-abcd-ef0123456789'),
  bookId: BookId('1234abcd-ab12-1234-1234-123412341234'),
  traderId: TraderId('abcd1234-1234-abcd-abcd-abcd12341234'),
  notional: Money.of(1_000_000, 'USD'),
  price: 1.0842,
  tradeDate: BusinessDate.today(),
  valueDate: BusinessDate.today().addDays(2),
  preDealCheck: {
    approved: true,
    limitUtilisationPct: 50,
    headroomAmount: Money.of(10_000_000, 'USD'),
    failureReasons: [],
    checkedAt: new Date(),
  },
};
```

For API tests, use the Postman collection at `docs/NexusTreasury_API_Collection.postman_collection.json`.

---

## Writing Good Tests

### Do

- Test behaviour, not implementation (test what, not how)
- One assertion per test (or related assertions in one logical test)
- Name tests as sentences: `it('returns 400 when notional is negative')`
- Test invariant violations: every `throw` in the domain should have a test
- Test the event output: `expect(events.some(e => e.eventType === '...')).toBe(true)`

### Don't

- Test TypeScript's type system (the compiler handles that)
- Mock the domain layer (test it directly — it has no external dependencies)
- Write tests that require a live database for unit tests
- Leave `it.only` or `it.skip` in committed code

---

## Coverage Reporting

```bash
# Generate and view coverage report
pnpm test:coverage
open coverage/index.html   # interactive HTML report

# Check specific package
pnpm --filter @nexustreasury/domain test:coverage
```

Coverage reports are uploaded to Codecov in CI (optional — requires `CODECOV_TOKEN` secret).
