# Day 4–5 — Testing Guide

## Test pyramid

```
         ┌─────────────────────┐
         │   E2E tests (31)    │  Vitest + HTTP, full request cycle
         ├─────────────────────┤
         │  Contract tests     │  Pact consumer-driven contracts
         ├─────────────────────┤
         │  Integration tests  │  Multi-aggregate scenarios
         ├─────────────────────┤
         │  Unit tests (660+)  │  Single class / function, no IO
         └─────────────────────┘
```

## Running tests

```bash
pnpm test                            # all packages
pnpm --filter @nexustreasury/domain exec vitest run  # single package
pnpm --filter @nexustreasury/domain exec vitest run --reporter=verbose  # detailed output
```

## Unit test conventions

```typescript
// ✅ Good: one describe per class, one it per behaviour
describe('SukukPricer — Ijara', () => {
  it('premium bond: dirtyPrice > face when rental > discount', () => { ... });
  it('DV01 > 0', () => { ... });
});

// ❌ Bad: test implementation details
it('calls _computePrice 5 times', () => { ... });

// ❌ Bad: multiple assertions that could fail individually
it('everything works', () => {
  expect(a).toBe(1);
  expect(b).toBe(2);  // you won't know which failed
});
```

## Invariant tests

The `platform-health.test.ts` file in `@nexustreasury/domain` verifies cross-sprint invariants:

- FX CIP: `F = S·exp((r_d−r_f)·T)`
- Put-call parity within 0.01
- At-par IRS NPV < 1,000

These run on every build. If you break a mathematical invariant, you will see a failure here.

## Contract tests (Pact)

Consumer-driven contracts in `tests/contract/` define what events `accounting-service` expects from `trade-service`. Run:

```bash
pnpm --filter @nexustreasury/e2e exec pact-provider-verifier
```

## Performance tests (k6)

```bash
# Requires k6 installed locally
k6 run tests/performance/trade-booking.k6.js
# Target: P99 < 5ms for pre-deal check
```

## Mock strategy

All external dependencies (Bloomberg, BERT endpoint, Claude API) are mocked in tests:

```typescript
// Use unreachable URLs in tests to exercise the fallback path
const assistant = new TreasuryAIAssistant({
  apiEndpoint: 'http://localhost:99999/',
  timeoutMs: 100,
});
```

Never make real HTTP calls in unit or integration tests.
