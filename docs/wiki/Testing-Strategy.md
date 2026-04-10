# Testing Strategy

NexusTreasury uses a comprehensive, five-layer quality assurance approach covering unit tests, E2E integration tests, performance benchmarks, API contract tests, and mutation testing.

**Current totals**: 502 unit tests · 31 E2E tests · 7 benchmark suites · 2 k6 load test suites · 2 Pact contract stubs · Stryker mutation config

---

## The Testing Pyramid

```
                    ┌──────────────┐
                    │   Mutation   │  Stryker — kill score ≥ 80%
                    └──────┬───────┘
                  ┌────────┴────────┐
                  │  Contract Tests │  Pact — 2 consumers verified
                  └────────┬────────┘
              ┌────────────┴────────────┐
              │  Performance / k6       │  500 TPS SLA — 2 suites
              └────────────┬────────────┘
           ┌───────────────┴───────────────┐
           │   E2E Integration Tests       │  31 tests — 12 sections
           │   Vitest in-memory, no Docker │
           └───────────────┬───────────────┘
      ┌────────────────────┴────────────────────┐
      │          Unit Tests                     │  502 tests — 36 files
      │   Vitest 1.x — no infra required        │
      └─────────────────────────────────────────┘
```

**Philosophy**: Financial domain logic must be tested with the strictest rigor. Most bugs live in domain layer calculations (pricing, VaR, ECL, LCR). These are tested intensively with fast unit tests. The higher layers verify wiring and SLAs.

---

## Layer 1: Unit Tests

**Framework**: Vitest 1.x (ESM-native — see ADR-007)  
**Location**: `packages/*/src/**/*.test.ts`  
**Run**: `pnpm test` or `make test`  
**Count**: 502 tests across 36 files, 0 failures

### Coverage by service

| Package                               | Tests | Key Areas Covered                                        |
| ------------------------------------- | ----- | -------------------------------------------------------- |
| `@nexustreasury/domain`               | 160   | Trade invariants, Money type, BusinessDate, pricers, VaR |
| `@nexustreasury/bo-service`           | 112   | SWIFT MT/MX generation, SWIFTMatcher, nostro recon       |
| `@nexustreasury/accounting-service`   | 71    | IFRS9 classifier, ECL stages, double-entry DR=CR         |
| `@nexustreasury/risk-service`         | 47    | Pre-deal limits, VaR/sVaR, FRTB SA, Greeks               |
| `@nexustreasury/alm-service`          | 23    | LCR inflow cap, NSFR, NMD modelling, IRRBB outlier       |
| `@nexustreasury/audit-service`        | 18    | HMAC-SHA256 generation, tamper detection, replay         |
| `@nexustreasury/trade-service`        | 32    | Route handlers, sanctions screening, idempotency         |
| `@nexustreasury/collateral-service`   | 13    | Margin call arithmetic, CTD optimisation, CSA threshold  |
| `@nexustreasury/reporting-service`    | 14    | LCR ratio, NSFR ASF/RSF, IRRBB ΔEVE/Tier1                |
| `@nexustreasury/notification-service` | 12    | Event routing, channel dispatch, priority                |

### Coverage thresholds (enforced in CI)

| Metric     | Threshold | Current (domain) |
| ---------- | --------- | ---------------- |
| Lines      | 80%       | 96.83%           |
| Functions  | 80%       | 92.07%           |
| Branches   | 70%       | 88.4%            |
| Statements | 80%       | 96.12%           |

### Running unit tests

```bash
pnpm test                                              # All 502 tests
pnpm --filter @nexustreasury/domain exec vitest run   # Domain only
pnpm --filter @nexustreasury/risk-service exec vitest run --reporter verbose
make test                                              # Via Makefile
make coverage                                         # With HTML report
```

---

## Layer 2: E2E Integration Tests

**Framework**: Vitest 1.x (NOT Playwright — E2E tests run in Node.js, in-memory)  
**Location**: `tests/e2e/trade-lifecycle.test.ts`  
**Run**: `pnpm --filter @nexustreasury/e2e exec vitest run` or `make test-e2e`  
**Count**: 31 tests across 12 sections, 0 failures

> **Note**: The old Testing-Strategy doc referred to Playwright. Playwright was removed in favour of Vitest in-memory E2E tests which do not require a running Docker stack — this was an intentional design decision to make E2E tests fast and CI-friendly.

### What the E2E tests cover

The 12 sections wire together the full trade lifecycle across all bounded contexts, in-memory without real Kafka or PostgreSQL:

1. **Trade booking** — FX Forward booking with sanctions screening and pre-deal check
2. **Sanctions screening** — OFAC SDN + HM Treasury + UN match detection
3. **Pre-deal check** — Credit limit hierarchy, hard limit enforcement, override workflow
4. **Pricing** — Black-Scholes Greeks (Δ, Γ, Vega, Θ, Rho), Bond DV01, IRS NPV
5. **Position keeping** — Event-sourced MTM position update after booking
6. **VaR engine** — Historical VaR, √10 scaling, Expected Shortfall, Stressed VaR
7. **FRTB SA** — Delta + Vega + Curvature across 5 risk classes
8. **IFRS9 accounting** — ECL stage classification, journal DR=CR, hedge effectiveness
9. **Settlement** — SWIFT MT202 generation, nostro reconciliation, STP rate
10. **Regulatory reporting** — LCR inflow cap, NSFR ASF/RSF, IRRBB outlier test
11. **Audit trail** — HMAC-SHA256 integrity, tamper detection, SOC 2 compliance
12. **Collateral** — Margin call direction (WE_CALL/THEY_CALL/NO_CALL), CTD selection

```bash
make test-e2e                      # Run all 31 E2E tests
make bench                         # Run 7 benchmark suites (SLA verification)
```

---

## Layer 3: Performance Benchmarks (SLA Verification)

**Framework**: Vitest `bench()` built-in  
**Location**: `tests/e2e/critical-path.bench.ts`  
**Run**: `make bench` or `pnpm --filter @nexustreasury/e2e exec vitest bench --run`

The 7 benchmark suites verify that all pricing SLAs are met under load. These run in CI and fail if any SLA is exceeded:

| Benchmark                           | SLA         | Verified |
| ----------------------------------- | ----------- | -------- |
| Black-Scholes pricing (with Greeks) | P99 < 2ms   | ✅       |
| Bond DV01 + convexity               | P99 < 3ms   | ✅       |
| IRS multi-curve NPV                 | P99 < 5ms   | ✅       |
| Pre-deal credit limit check         | P99 < 5ms   | ✅       |
| HMAC-SHA256 audit record generation | P99 < 1ms   | ✅       |
| LCR inflow cap calculation          | P99 < 100ms | ✅       |
| IRRBB ΔEVE/Tier1 calculation        | P99 < 50ms  | ✅       |

---

## Layer 4: Performance / Load Tests (k6)

**Framework**: [k6](https://k6.io) (Grafana k6 load testing tool)  
**Location**: `tests/performance/`  
**Run**: `make k6` (local, 10 VUs / 30s) or full run via GitHub Actions  
**Trigger**: Automatically after every staging deployment (`performance-tests.yml` workflow)

### Test suites

**`trade-booking.k6.js`** — Validates 500 TPS SLA under sustained load:

- Scenario 1: Steady state — 50 VUs for 5 minutes
- Scenario 2: Ramp up — 0 → 100 VUs over 4 minutes
- Scenario 3: Spike — 10 → 200 RPS burst in 20 seconds
- Custom metrics: `nt_trade_booking_duration`, `nt_pre_deal_check_duration`, `nt_trades_booked`
- Thresholds: P99 < 200ms (booking), P99 < 10ms (pre-deal), error rate < 0.1%

**`lcr-report.k6.js`** — Validates LCR report concurrency:

- 10 VUs for 2 minutes (10 concurrent regulatory reports)
- Threshold: P99 < 30 seconds

```bash
# Install k6: https://k6.io/docs/getting-started/installation/
make k6                                          # Quick 30s local run
k6 run tests/performance/trade-booking.k6.js    # Full 5m run
k6 run tests/performance/trade-booking.k6.js \
  -e BASE_URL=https://trade.staging.nexustreasury.io/api/v1 \
  -e JWT_TOKEN=$TOKEN --vus 50 --duration 5m
```

CI reports are uploaded to GitHub Actions artifacts and optionally pushed to Grafana Cloud.

---

## Layer 5: Pact Consumer-Driven Contract Tests

**Framework**: [@pact-foundation/pact](https://docs.pact.io/) v12 (PactV4)  
**Location**: `tests/contract/`  
**Run**: `make pact` (requires pact npm package installed)  
**Broker**: `https://pact.nexustreasury.io` (Sprint 7 deliverable)  
**Pipeline**: `.github/workflows/contract-tests.yml`

Contract tests prevent breaking changes at the Kafka event boundary. Consumers define the exact JSON shape they require; producers must satisfy all consumer contracts before deploying.

### Active contracts

| Consumer               | Producer        | Kafka Topic                   | Status  |
| ---------------------- | --------------- | ----------------------------- | ------- |
| `accounting-service`   | `trade-service` | `nexus.trading.trades.booked` | ✅ Stub |
| `notification-service` | `risk-service`  | `nexus.risk.limit-breach`     | ✅ Stub |

### CI workflow

```
consumer tests (parallel)
  └─ accounting-service pact → publish to Broker
  └─ notification-service pact → publish to Broker
provider verification (after consumers pass)
  └─ trade-service verifies all consumer pacts → publishes result
can-i-deploy gate (main branch only)
  └─ pact-broker can-i-deploy --to-environment production
```

---

## Layer 6: Mutation Testing (Stryker)

**Framework**: [@stryker-mutator/core](https://stryker-mutator.io/) v8.6  
**Config**: `stryker.config.ts`  
**Run**: `make test:mutation` or `npx stryker run`  
**Target kill score**: ≥ 80% (Sprint 7 deliverable)

Mutation testing verifies that tests are _meaningful_ — not just that they pass, but that they catch real bugs. Stryker introduces artificial bugs (mutants) and checks whether tests fail. A kill score > 80% means your tests catch 4 in 5 real bugs.

### Source packages mutated

- `packages/domain/src/**` — Domain aggregates, value objects, pricers
- `packages/accounting-service/src/domain/**` — IFRS9 classifier, ECL
- `packages/accounting-service/src/application/**` — Journal entry service
- `packages/risk-service/src/application/**` — Pre-deal check, VaR calculator
- `packages/collateral-service/src/domain/**` — Margin call arithmetic

### Thresholds

| Score  | Meaning                            |
| ------ | ---------------------------------- |
| ≥ 80%  | ✅ Green — tests are strong        |
| 70–79% | ⚠️ Warning — improve test quality  |
| < 65%  | ❌ CI failure — tests are too weak |

### Reading reports

```bash
make test:mutation                          # Run mutation tests
open reports/mutation/mutation-report.html  # View survivors
```

Survivors (mutants that weren't killed) represent untested code paths. Each survivor entry shows the exact mutation and which source line was affected. Prioritise killing survivors in financial calculation code first.

---

## CI/CD Integration

All test layers run in the CI pipeline defined in `.github/workflows/ci.yml`:

```
pnpm install → typecheck → lint → unit tests (502) → E2E tests (31) → benchmarks (7)
                                                           ↓
                                                    Docker matrix build (12 images)
                                                           ↓
                                                    CodeQL SAST + Snyk SCA

Post-staging deployment (cd-staging.yml triggers):
  → performance-tests.yml → k6 trade-booking SLA
  → Newman API smoke tests (all 17 collection requests)

On main branch (contract-tests.yml):
  → Pact consumers → Pact provider → can-i-deploy gate
```

---

## Writing Tests

### Unit test conventions

```typescript
// ✅ Test behaviour, not implementation
it('rejects trade booking when notional is negative', () => {
  expect(() => Trade.book({ ...validParams, notional: Money.of(-100, 'USD') })).toThrow(
    TradeDomainError,
  );
});

// ✅ Test domain events
it('publishes TradeBooked event on successful booking', () => {
  const trade = Trade.book(validParams);
  expect(trade.domainEvents.some((e) => e.eventType === 'TradeBooked')).toBe(true);
});

// ❌ Do not test the TypeScript type system
// ❌ Do not mock the domain layer in domain tests
// ❌ Do not leave it.only or it.skip in committed code
```

### Benchmark conventions

```typescript
// Verify SLA at bench time — fails CI if P99 exceeds threshold
bench(
  'Black-Scholes pricing P99 < 2ms',
  () => {
    BlackScholesPricer.price({ ...validOption });
  },
  { time: 1000 },
);
```

### k6 test conventions

- Use `--env` flags for environment-specific URLs — no hardcoded hosts
- Randomise payloads to avoid cache skew (random notional, currency, price jitter)
- Always include a `setup()` health check before the main scenarios start
- Export `options.thresholds` — failing thresholds cause non-zero exit codes in CI
