# Database Schema Reference

NexusTreasury uses a single PostgreSQL 16 database with four isolated schemas,
one per bounded context. All models are defined in `prisma/schema.prisma`.

---

## Schema Overview

```
PostgreSQL database: nexustreasury
  ├── trading      (owned by trade-service)
  ├── position     (owned by position-service)
  ├── risk         (owned by risk-service)
  └── alm          (owned by alm-service)
```

Each schema is isolated. Services only read/write their own schema.
Cross-schema data access goes via Kafka events.

---

## trading.trades

The core trade record. One row per trade.

| Column              | Type           | Constraints                            | Description                                   |
| ------------------- | -------------- | -------------------------------------- | --------------------------------------------- |
| `id`                | UUID           | PK                                     | Surrogate key (auto-generated)                |
| `tenant_id`         | UUID           | NOT NULL, IDX                          | Multi-tenant isolation                        |
| `reference`         | VARCHAR        | UNIQUE, NOT NULL                       | Human-readable reference (FX-20260407-A3B2C1) |
| `asset_class`       | VARCHAR        | NOT NULL                               | FX, FIXED_INCOME, MONEY_MARKET, etc.          |
| `direction`         | VARCHAR        | NOT NULL                               | BUY or SELL                                   |
| `status`            | VARCHAR        | NOT NULL, DEFAULT 'PENDING_VALIDATION' | Trade lifecycle state                         |
| `counterparty_id`   | UUID           | NOT NULL, IDX                          | Counterparty identifier                       |
| `instrument_id`     | UUID           | NOT NULL                               | Instrument identifier                         |
| `book_id`           | UUID           | NOT NULL, IDX                          | Trading book                                  |
| `trader_id`         | UUID           | NOT NULL                               | Trader who booked the trade                   |
| `notional_amount`   | DECIMAL(20,6)  | NOT NULL                               | Face value                                    |
| `notional_currency` | CHAR(3)        | NOT NULL                               | ISO 4217 (USD, EUR, GBP)                      |
| `price`             | DECIMAL(20,10) | NOT NULL                               | Exchange rate or price                        |
| `trade_date`        | DATE           | NOT NULL                               | Date agreed                                   |
| `value_date`        | DATE           | NOT NULL                               | Settlement date                               |
| `maturity_date`     | DATE           | NULLABLE                               | For fixed income / money market               |
| `pre_deal_check`    | JSONB          | NULLABLE                               | Pre-deal check result snapshot                |
| `created_at`        | TIMESTAMPTZ    | NOT NULL, DEFAULT NOW()                | Record creation time                          |
| `updated_at`        | TIMESTAMPTZ    | NOT NULL, AUTO                         | Last update time                              |
| `version`           | INTEGER        | NOT NULL, DEFAULT 1                    | Optimistic concurrency                        |

**Indexes:** `(tenant_id, book_id)`, `(tenant_id, counterparty_id)`, `(tenant_id, status)`

---

## trading.trade_events

Event outbox. One row per domain event emitted by a Trade aggregate.

| Column         | Type        | Constraints              | Description                              |
| -------------- | ----------- | ------------------------ | ---------------------------------------- |
| `id`           | UUID        | PK                       | Event record ID                          |
| `trade_id`     | UUID        | NOT NULL, FK → trades.id | Parent trade                             |
| `tenant_id`    | UUID        | NOT NULL, IDX            | Multi-tenant isolation                   |
| `event_type`   | VARCHAR     | NOT NULL, IDX            | nexus.trading.trade.booked etc.          |
| `event_id`     | UUID        | UNIQUE                   | Domain event UUID (idempotency key)      |
| `payload`      | JSONB       | NOT NULL                 | Full event payload                       |
| `occurred_at`  | TIMESTAMPTZ | NOT NULL                 | When the event happened                  |
| `published_at` | TIMESTAMPTZ | NULLABLE                 | When published to Kafka (null = pending) |

**Indexes:** `(trade_id)`, `(tenant_id, event_type)`, `(published_at)` (partial, where published_at IS NULL — for outbox polling)

---

## position.positions

Current position snapshot. One row per (instrument, book, tenant) combination.

| Column                  | Type          | Constraints         | Description                                             |
| ----------------------- | ------------- | ------------------- | ------------------------------------------------------- |
| `id`                    | UUID          | PK                  | Position ID (deterministic from instrument+book+tenant) |
| `tenant_id`             | UUID          | NOT NULL, IDX       | Multi-tenant isolation                                  |
| `instrument_id`         | UUID          | NOT NULL, IDX       | Instrument being held                                   |
| `book_id`               | UUID          | NOT NULL, IDX       | Book holding the position                               |
| `currency`              | CHAR(3)       | NOT NULL            | Currency of denomination                                |
| `net_quantity`          | DECIMAL(24,6) | NOT NULL            | Net quantity (positive = long, negative = short)        |
| `average_cost_amount`   | DECIMAL(20,6) | NOT NULL            | Weighted average cost                                   |
| `mtm_value_amount`      | DECIMAL(20,6) | NOT NULL            | Mark-to-market value                                    |
| `unrealised_pnl_amount` | DECIMAL(20,6) | NOT NULL            | Unrealised P&L                                          |
| `open_date`             | DATE          | NOT NULL            | Date position was first opened                          |
| `version`               | INTEGER       | NOT NULL, DEFAULT 0 | Optimistic concurrency                                  |
| `created_at`            | TIMESTAMPTZ   | NOT NULL            | First trade event                                       |
| `updated_at`            | TIMESTAMPTZ   | NOT NULL, AUTO      | Last update time                                        |

**Indexes:** `(tenant_id, book_id)`, `(tenant_id, instrument_id)`

---

## position.position_events

Full event log for position changes. Used for audit and point-in-time replay.

| Column        | Type        | Constraints                      | Description                          |
| ------------- | ----------- | -------------------------------- | ------------------------------------ |
| `id`          | UUID        | PK                               | Event record ID                      |
| `position_id` | UUID        | NOT NULL, FK → positions.id, IDX | Parent position                      |
| `tenant_id`   | UUID        | NOT NULL, IDX                    | Multi-tenant isolation               |
| `event_type`  | VARCHAR     | NOT NULL, IDX                    | nexus.position.position.updated etc. |
| `event_id`    | UUID        | UNIQUE                           | Idempotency key                      |
| `payload`     | JSONB       | NOT NULL                         | Full event payload                   |
| `occurred_at` | TIMESTAMPTZ | NOT NULL                         | Event time                           |
| `sequence`    | INTEGER     | NOT NULL                         | Monotonic sequence per position      |

**Indexes:** `(position_id, sequence)`, `(tenant_id, event_type)`

---

## risk.limits

Limit configuration. One row per limit (by type/level/entity/tenant).

| Column              | Type          | Constraints                  | Description                                     |
| ------------------- | ------------- | ---------------------------- | ----------------------------------------------- |
| `id`                | UUID          | PK                           | Limit ID                                        |
| `tenant_id`         | UUID          | NOT NULL, IDX                | Multi-tenant isolation                          |
| `limit_type`        | VARCHAR       | NOT NULL                     | COUNTERPARTY_CREDIT, BOOK, TRADER, LEGAL_ENTITY |
| `level`             | VARCHAR       | NOT NULL                     | COUNTERPARTY, BOOK, TRADER, LEGAL_ENTITY        |
| `entity_id`         | VARCHAR       | NOT NULL, IDX                | ID of the entity being limited                  |
| `limit_amount`      | DECIMAL(20,6) | NOT NULL                     | Maximum allowed exposure                        |
| `limit_currency`    | CHAR(3)       | NOT NULL                     | Currency of the limit                           |
| `utilised_amount`   | DECIMAL(20,6) | NOT NULL, DEFAULT 0          | Current utilisation                             |
| `warning_threshold` | DECIMAL(5,2)  | NOT NULL                     | Warning percentage (e.g. 80.00)                 |
| `in_breach`         | BOOLEAN       | NOT NULL, DEFAULT FALSE, IDX | True when utilised > 100%                       |
| `version`           | INTEGER       | NOT NULL, DEFAULT 1          | Optimistic concurrency                          |
| `created_at`        | TIMESTAMPTZ   | NOT NULL                     | Creation time                                   |
| `updated_at`        | TIMESTAMPTZ   | NOT NULL, AUTO               | Last update time                                |

**Indexes:** `(tenant_id, entity_id)`, `(tenant_id, in_breach)`

---

## risk.var_snapshots

VaR calculation results. Time-series — one row per calculation.

| Column          | Type            | Description                         |
| --------------- | --------------- | ----------------------------------- |
| `id`            | UUID PK         | Snapshot ID                         |
| `tenant_id`     | UUID            | Multi-tenant                        |
| `book_id`       | UUID nullable   | Null = portfolio-level VaR          |
| `var_amount`    | DECIMAL(20,6)   | VaR amount                          |
| `currency`      | CHAR(3)         | Base currency                       |
| `confidence`    | DECIMAL(5,4)    | Confidence level (0.9900 = 99%)     |
| `horizon`       | INTEGER         | Horizon in days                     |
| `method`        | VARCHAR         | HISTORICAL, PARAMETRIC, MONTE_CARLO |
| `calculated_at` | TIMESTAMPTZ IDX | When calculated                     |

---

## alm.liquidity_gap_reports

Liquidity analysis results. One row per report generation.

| Column             | Type         | Description                             |
| ------------------ | ------------ | --------------------------------------- |
| `id`               | UUID PK      | Report ID                               |
| `tenant_id`        | UUID IDX     | Multi-tenant                            |
| `as_of_date`       | DATE IDX     | Report as-of date                       |
| `scenario`         | VARCHAR      | CONTRACTUAL, STRESSED_30D, etc.         |
| `currency`         | CHAR(3)      | Report currency                         |
| `lcr_ratio`        | DECIMAL(8,4) | LCR as percentage                       |
| `nsfr_ratio`       | DECIMAL(8,4) | NSFR as percentage                      |
| `is_lcr_breached`  | BOOLEAN IDX  | True when LCR < 100%                    |
| `is_nsfr_breached` | BOOLEAN      | True when NSFR < 100%                   |
| `buckets_json`     | JSONB        | CashFlowBucket[] for all 9 time buckets |
| `lcr_json`         | JSONB        | Full LCRComponents snapshot             |
| `nsfr_json`        | JSONB        | Full NSFRComponents snapshot            |
| `generated_at`     | TIMESTAMPTZ  | Generation timestamp                    |

---

## Prisma Migration Commands

```bash
# Create a new migration after schema changes
pnpm exec prisma migrate dev --name <description>

# Apply pending migrations (staging / production)
pnpm exec prisma migrate deploy

# Check migration status
pnpm exec prisma migrate status

# Regenerate Prisma client after schema changes
pnpm exec prisma generate --schema=prisma/schema.prisma

# Open Prisma Studio (GUI database browser)
pnpm exec prisma studio
```
