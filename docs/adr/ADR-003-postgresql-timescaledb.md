# ADR-003: PostgreSQL + TimescaleDB vs Cassandra

**Status**: Accepted | **Date**: 2025-11-08 | **Deciders**: Principal Engineer, Head of Data

## Decision: PostgreSQL 16 + TimescaleDB extension

## Context
Position keeping requires both:
- **Transactional writes**: atomic trade state + position update (ACID required)
- **Time-series reads**: 250-day VaR P&L history, historical rate series

| Criterion | Cassandra | PostgreSQL + TimescaleDB | Winner |
|---|---|---|---|
| ACID transactions | No | Yes | PostgreSQL |
| Time-series compression | LSM tree | Hypertable (10× compression) | Tie |
| Row Level Security (multi-tenant) | Complex | Native (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`) | PostgreSQL |
| JOIN support | No | Yes | PostgreSQL |
| Operational complexity | High (tuning required) | Moderate | PostgreSQL |
| Prisma ORM support | No | Full | PostgreSQL |

**Critical constraint**: Multi-tenant RLS is a hard requirement (NFR-018). Cassandra has no native RLS equivalent; implementing it at the application layer would be error-prone.

## Consequences
- `position_mtm` and `pnl_history` use TimescaleDB hypertables (partitioned by `time`)
- TimescaleDB compression policy: compress chunks older than 7 days
- All multi-tenant tables have `tenant_id` column + RLS policy
- Read replicas for reporting service queries (avoid blocking trading)
