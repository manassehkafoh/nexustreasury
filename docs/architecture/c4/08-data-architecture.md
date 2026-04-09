# Data Architecture

PostgreSQL schemas, ERD, event sourcing store, multi-tenancy, and data classification.

## Multi-Tenancy Schema Layout

NexusTreasury uses **PostgreSQL schema-per-bounded-context** with a shared `nexus_shared`
schema for cross-cutting tables (tenants, users, audit).

```mermaid
flowchart TB
  subgraph pg["PostgreSQL 16 — NexusTreasury Database"]

    subgraph shared["nexus_shared schema"]
      tenants[tenants]
      legal_entities[legal_entities]
      users[users]
      books[books]
      instruments[instruments]
      counterparties[counterparties]
      audit_log[audit_log]
    end

    subgraph trading["nexus_trading schema"]
      trades[trades]
      cash_flows[cash_flows]
      trade_events[trade_events]
    end

    subgraph position["nexus_position schema"]
      position_events[position_events]
      position_snapshots[position_snapshots]
    end

    subgraph risk["nexus_risk schema"]
      limits[limits]
      limit_history[limit_history]
      var_results[var_results]
      frtb_results[frtb_results]
    end

    subgraph alm["nexus_alm schema"]
      gap_reports[gap_reports]
      gap_buckets[gap_buckets]
      lcr_results[lcr_results]
      nsfr_results[nsfr_results]
      irrbb_results[irrbb_results]
    end

    subgraph bo["nexus_bo schema"]
      confirmations[confirmations]
      settlements[settlements]
      reconciliations[reconciliations]
    end

    subgraph accounting["nexus_accounting schema"]
      journal_entries[journal_entries]
      accounting_periods[accounting_periods]
    end
  end

  tenants --> trades
  tenants --> position_events
  tenants --> limits
  tenants --> gap_reports
  legal_entities --> trades
  books --> trades
  instruments --> trades
  counterparties --> trades
  trades --> cash_flows
  trades --> confirmations
  trades --> settlements
  trades --> journal_entries
```

## Core Entity Relationship Diagram

```mermaid
erDiagram
  TENANT {
    uuid id PK
    string code UK
    string name
    string status
    jsonb config
    timestamp created_at
  }

  LEGAL_ENTITY {
    uuid id PK
    uuid tenant_id FK
    string code UK
    string name
    string base_currency
    string timezone
    string bic
    string lei
  }

  BOOK {
    uuid id PK
    uuid legal_entity_id FK
    string code UK
    string name
    string book_type
    string currency
    string accounting_basis
    boolean is_active
  }

  INSTRUMENT {
    uuid id PK
    string isin UK
    string asset_class
    string instrument_type
    string sub_type
    string base_currency
    jsonb terms
    timestamp maturity_date
  }

  COUNTERPARTY {
    uuid id PK
    uuid tenant_id FK
    string code UK
    string name
    string bic
    string lei
    string rating_sp
    string rating_moodys
    jsonb settlement_instructions
    boolean is_active
  }

  TRADE {
    uuid id PK
    uuid tenant_id FK
    uuid legal_entity_id FK
    uuid instrument_id FK
    uuid counterparty_id FK
    uuid book_id FK
    uuid trader_id FK
    string trade_ref UK
    string status
    string direction
    decimal notional
    string currency
    decimal price
    string trade_date
    string value_date
    string maturity_date
    jsonb trade_terms
    timestamp created_at
    timestamp updated_at
    bigint version
  }

  CASH_FLOW {
    uuid id PK
    uuid trade_id FK
    uuid legal_entity_id FK
    string flow_type
    decimal amount
    string currency
    string value_date
    string status
    string nostro_account
  }

  LIMIT {
    uuid id PK
    uuid tenant_id FK
    string limit_type
    uuid counterparty_id FK
    uuid book_id FK
    decimal limit_amount
    string currency
    decimal utilised_amount
    string status
    string effective_date
    string expiry_date
    bigint version
  }

  CONFIRMATION {
    uuid id PK
    uuid trade_id FK
    string direction
    string method
    string status
    string swift_message_id
    string message_type
    string match_status
    decimal match_score
    string uti
    string sender_lei
    jsonb discrepancies
    timestamp received_at
    timestamp matched_at
  }

  JOURNAL_ENTRY {
    uuid id PK
    uuid trade_id FK
    uuid book_id FK
    string accounting_date
    string debit_account
    string credit_account
    decimal amount
    string currency
    string gaap
    string ifrs9_category
    string event_type
    timestamp posted_at
  }

  AUDIT_LOG {
    uuid id PK
    uuid tenant_id FK
    uuid user_id FK
    string entity_type
    uuid entity_id
    string action
    jsonb before_state
    jsonb after_state
    string ip_address
    string user_agent
    timestamp occurred_at
    string checksum
  }

  TENANT ||--o{ LEGAL_ENTITY : "has"
  TENANT ||--o{ COUNTERPARTY : "owns"
  TENANT ||--o{ LIMIT : "enforces"
  LEGAL_ENTITY ||--o{ BOOK : "owns"
  LEGAL_ENTITY ||--o{ TRADE : "books"
  INSTRUMENT ||--o{ TRADE : "underlies"
  COUNTERPARTY ||--o{ TRADE : "party to"
  COUNTERPARTY ||--o{ LIMIT : "subject to"
  BOOK ||--o{ TRADE : "contains"
  BOOK ||--o{ LIMIT : "subject to"
  TRADE ||--o{ CASH_FLOW : "generates"
  TRADE ||--o{ CONFIRMATION : "has"
  TRADE ||--o{ JOURNAL_ENTRY : "creates"
```

## Event Store Schema (Position Service)

The position service uses **event sourcing**: position state is never updated directly.
Instead, an ordered sequence of domain events is appended. The current state is derived
by replaying events from the last snapshot.

```mermaid
erDiagram
  POSITION_EVENT {
    uuid id PK
    uuid aggregate_id
    string aggregate_type
    bigint sequence_number
    string event_type
    jsonb payload
    string correlation_id
    string causation_id
    uuid created_by
    timestamp occurred_at
    string checksum
  }

  POSITION_SNAPSHOT {
    uuid id PK
    uuid aggregate_id
    bigint sequence_number
    jsonb state
    timestamp snapshot_at
  }

  POSITION_EVENT ||--o| POSITION_SNAPSHOT : "snapshotted at seq % 50"
```

### Snapshot Strategy

```mermaid
flowchart LR
  A[Event 1] --> B[Event 2]
  B --> C[...]
  C --> D[Event 50\nSnapshot created]
  D --> E[Event 51]
  E --> F[...]
  F --> G[Event 100\nSnapshot created]
  G --> H[Event 101]

  style D fill:#2d6a4f,color:#fff
  style G fill:#2d6a4f,color:#fff

  note["On load: read latest snapshot\nthen replay events since that seq\nmax 50 events to replay"] -.-> H
```

## TimescaleDB: Time-Series Tables

Market data history and P&L time series are stored in TimescaleDB hypertables:

| Table                       | Hypertable Dimension | Chunk Size | Retention | Use                             |
| --------------------------- | -------------------- | ---------- | --------- | ------------------------------- |
| `market_data.rate_history`  | `timestamp`          | 1 day      | 5 years   | Historical VaR (250-day window) |
| `market_data.curve_history` | `timestamp`          | 1 week     | 5 years   | IRRBB historical scenarios      |
| `trading.pnl_history`       | `position_date`      | 1 month    | 7 years   | P&L time series, SOC 2 evidence |
| `risk.var_history`          | `calculated_at`      | 1 day      | 3 years   | FRTB back-testing               |

## Data Classification

| Classification   | Examples                                 | Controls                                      |
| ---------------- | ---------------------------------------- | --------------------------------------------- |
| **CONFIDENTIAL** | Trade terms, counterparty names, LEI/BIC | Vault encryption, RLS, audit log              |
| **RESTRICTED**   | PnL, VaR, limit utilisations             | Role-based access, no export without approval |
| **INTERNAL**     | Market rates, instrument terms           | Internal only, no external sharing            |
| **PUBLIC**       | Instrument ISIN, currency codes          | No special controls                           |

### Column-Level Encryption (Vault Transit)

Sensitive fields encrypted before storage using Vault Transit (AES-256-GCM):

| Table            | Column                     | Classification | Key                      |
| ---------------- | -------------------------- | -------------- | ------------------------ |
| `trades`         | `notional`, `price`        | CONFIDENTIAL   | `nexus-trade-financials` |
| `counterparties` | `settlement_instructions`  | CONFIDENTIAL   | `nexus-counterparty-pii` |
| `users`          | `email`, `phone`           | CONFIDENTIAL   | `nexus-user-pii`         |
| `audit_log`      | `ip_address`, `user_agent` | RESTRICTED     | `nexus-audit-meta`       |

## Row-Level Security (PostgreSQL RLS)

Every table in `nexus_trading`, `nexus_position`, `nexus_risk`, `nexus_alm`, and
`nexus_bo` enforces tenant isolation via PostgreSQL Row-Level Security policies:

```sql
-- Example: Trade table RLS policy
CREATE POLICY nexus_tenant_isolation ON nexus_trading.trades
  USING (tenant_id = current_setting('nexus.tenant_id')::uuid);

-- Set per-connection before queries
SET nexus.tenant_id = '{tenantId}';
```

This guarantees that even if application-level tenant filtering is bypassed, the
database layer prevents cross-tenant data access.

## Database HA Architecture

```mermaid
flowchart TB
  subgraph patroni["Patroni HA Cluster (3 nodes)"]
    primary["Primary\nReads + Writes\n5432"]
    standby1["Standby 1\nRead Replica\nAsync replication"]
    standby2["Standby 2\nRead Replica\nAsync replication"]
  end

  subgraph ha_proxy["HAProxy (connection routing)"]
    haproxy["HAProxy\nPrimary: port 5000\nReplica: port 5001"]
  end

  subgraph etcd["etcd (leader election)"]
    etcd1[etcd node 1]
    etcd2[etcd node 2]
    etcd3[etcd node 3]
  end

  services["NexusTreasury\nMicroservices"] -->|Write + Read| haproxy
  haproxy -->|Write| primary
  haproxy -->|Read| standby1
  haproxy -->|Read| standby2
  primary -->|WAL streaming| standby1
  primary -->|WAL streaming| standby2
  patroni -.->|Leader election| etcd

  style primary fill:#2d6a4f,color:#fff
```

| Parameter                         | Value         | Purpose                        |
| --------------------------------- | ------------- | ------------------------------ |
| `max_connections`                 | 500           | Per-node connection limit      |
| `shared_buffers`                  | 4GB           | 25% of RAM for caching         |
| `wal_level`                       | `replica`     | Enable streaming replication   |
| `synchronous_commit`              | `local`       | Performance — async to standby |
| `checkpoint_completion_target`    | `0.9`         | Spread checkpoint I/O          |
| `TimescaleDB chunk_time_interval` | 1 day (rates) | Optimal for daily queries      |
