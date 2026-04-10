# NexusTreasury Architecture Decision Records

Architecture Decision Records (ADRs) capture the significant engineering decisions made during the design and build of NexusTreasury, including the context, options considered, and the rationale for each decision.

## Complete ADR Register

| ADR                                                    | Title                                      | Date     | Status   |
| ------------------------------------------------------ | ------------------------------------------ | -------- | -------- |
| [ADR-001](./ADR-001-monorepo-pnpm-turborepo.md)        | Monorepo with pnpm Workspaces + Turborepo  | Nov 2025 | Accepted |
| [ADR-002](./ADR-002-fastify-vs-express-nestjs.md)      | Fastify 5 vs Express vs NestJS             | Nov 2025 | Accepted |
| [ADR-003](./ADR-003-postgresql-timescaledb.md)         | PostgreSQL + TimescaleDB vs Cassandra      | Nov 2025 | Accepted |
| [ADR-004](./ADR-004-kafka-vs-rabbitmq.md)              | Apache Kafka vs RabbitMQ vs NATS           | Nov 2025 | Accepted |
| [ADR-005](./ADR-005-keycloak-identity.md)              | Keycloak vs Auth0 vs AWS Cognito           | Nov 2025 | Accepted |
| [ADR-006](./ADR-006-typescript-strict-mode.md)         | TypeScript Strict Mode Throughout          | Nov 2025 | Accepted |
| [ADR-007](./ADR-007-vitest-vs-jest.md)                 | Vitest vs Jest                             | Nov 2025 | Accepted |
| [ADR-008](./ADR-008-typescript-pricing-vs-quantlib.md) | Custom TypeScript Pricing vs QuantLib WASM | Jan 2026 | Accepted |
| [ADR-009](./ADR-009-audit-hmac-vs-blockchain.md)       | HMAC-SHA256 Audit Trail vs Blockchain      | Jan 2026 | Accepted |
| [ADR-010](./ADR-010-collateral-bounded-context.md)     | Collateral as Separate Bounded Context     | Feb 2026 | Accepted |

## How to Write an ADR

Use this template:

```markdown
# ADR-NNN: Title

**Status**: Proposed / Accepted / Deprecated / Superseded by ADR-XXX
**Date**: YYYY-MM-DD
**Deciders**: Names of decision-makers

## Context

What is the problem being addressed?

## Decision

What was chosen?

## Rationale

Comparison table with winner column.

## Consequences

What changes as a result of this decision?
```

## Proposing a New ADR

1. Copy the template above into a new file: `ADR-011-short-title.md`
2. Fill in the context, options, and your recommendation
3. Open a PR with `[ADR]` in the title for review by Principal Engineers
4. Update this README table after the ADR is accepted
