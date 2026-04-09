# ADR-010: Collateral Management as Separate Bounded Context

**Status**: Accepted  
**Date**: 2026-02-05  
**Deciders**: Principal Engineer, Head of Treasury Operations

## Context

Collateral management could live in: (a) `bo-service` alongside settlement, or (b) its own `collateral-service`.

## Decision

Create **`collateral-service`** as a separate bounded context (port 4010).

## Rationale

| Criterion | In bo-service | Separate service | Winner |
|---|---|---|---|
| Domain complexity | CSA/GMRA/GMSLA each have distinct legal frameworks | Isolated domain model | Separate |
| Availability requirement | BO processes settle in batch windows | Margin calls are real-time EOD | Separate |
| Data retention | Settlement instructions: 7 years | CSA agreements: contract lifetime (10-50y) | Separate |
| Team ownership | BO Ops team | Collateral/Treasury team | Separate |
| Regulatory audit scope | MiFID II trade reporting | EMIR margin rules, UMR Phase 6 | Separate |
| Scale profile | Bursty at settlement cut-off | Bursty at EOD mark-to-market | Different |

The key distinction: `bo-service` is responsible for **what happened** (settlement outcomes).
`collateral-service` is responsible for **what must happen** (margin obligations computed from MTM).
These are fundamentally different bounded contexts with different invariants and regulatory obligations.

## Consequences

- `collateral-service` owns: CollateralAgreement aggregate, MarginCall value object, CTD optimisation
- Cross-context communication: `nexus.risk.var-result` Kafka event triggers collateral recalculation
- Portfolio-level MTM → `collateral-service` → margin call → `bo-service` generates MT202 payment
- UMR Phase 6 compliance (initial margin for uncleared derivatives) implemented in `collateral-service`
