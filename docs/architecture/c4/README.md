# NexusTreasury — C4 Architecture Models

> **Version**: 2.0 | **Date**: 2026-04-09 | **Status**: QA-Approved  
> **2,038 lines** across **13 diagram files** covering all four C4 levels, deployment, security, data, and Kafka topology.

The C4 model (Context → Containers → Components → Code) provides four zoom levels of
architecture documentation. Each level is self-contained and targets a different audience.

## Documents in This Folder

| File                                                           | C4 Level   | Audience               | Key Diagrams                                      |
| -------------------------------------------------------------- | ---------- | ---------------------- | ------------------------------------------------- |
| [01-system-context.md](./01-system-context.md)                 | Level 1    | Everyone               | System context, external integrations             |
| [02-container.md](./02-container.md)                           | Level 2    | Architects, Tech Leads | All 11 services, event bus, data stores           |
| [03-components-trade.md](./03-components-trade.md)             | Level 3    | Developers             | Trade booking, pre-deal checks, WebSocket blotter |
| [03-components-position.md](./03-components-position.md)       | Level 3    | Developers             | Event sourcing, position replay, P&L              |
| [03-components-risk.md](./03-components-risk.md)               | Level 3    | Developers             | VaR, FRTB, XVA, limit management                  |
| [03-components-alm.md](./03-components-alm.md)                 | Level 3    | Developers             | LCR, NSFR, IRRBB, FTP, liquidity gap              |
| [03-components-bo.md](./03-components-bo.md)                   | Level 3    | Developers             | SWIFT MX/MT parser, confirmation matching         |
| [03-components-market-data.md](./03-components-market-data.md) | Level 3    | Developers             | Bloomberg/LSEG adapters, rate cache, curves       |
| [04-code-domain.md](./04-code-domain.md)                       | Level 4    | Developers             | DDD aggregates, value objects, domain events      |
| [05-deployment.md](./05-deployment.md)                         | Deployment | Platform Engineers     | Kubernetes topology, GitOps pipeline              |
| [06-security.md](./06-security.md)                             | Security   | CISO, Platform         | Zero Trust, mTLS, RBAC, Vault, audit              |
| [07-kafka-topology.md](./07-kafka-topology.md)                 | Event Flow | Developers, Architects | 13 topics, consumer groups, EOS config            |
| [08-data-architecture.md](./08-data-architecture.md)           | Data       | Data Architects        | ERD, event store, TimescaleDB, RLS                |

## Platform at a Glance

**NexusTreasury** is a cloud-native, event-driven Treasury Management System (TMS) for
banks and financial institutions. It is built on Domain-Driven Design (DDD) with 8
bounded contexts deployed as independent microservices.

### Core Capabilities

| Capability                         | Services            | Regulation        |
| ---------------------------------- | ------------------- | ----------------- |
| FX/MM/IRS/Equity trade capture     | Trade Service       | —                 |
| Real-time P&L (event-sourced)      | Position Service    | IFRS 9            |
| VaR, FRTB, XVA, limits             | Risk Service        | Basel IV / FRTB   |
| LCR, NSFR, IRRBB, FTP              | ALM Service         | BCBS 238/295/368  |
| SWIFT MX (ISO 20022) confirmations | Back Office Service | EMIR / Dodd-Frank |
| Bloomberg/LSEG market data         | Market Data Service | —                 |
| Immutable audit trail              | Audit Service       | SOC 2 Type II     |

### Technology Stack

| Concern       | Choice                                        |
| ------------- | --------------------------------------------- |
| Runtime       | Node.js 24 + TypeScript                       |
| Architecture  | DDD + Event Sourcing + CQRS                   |
| Event Bus     | Apache Kafka (500+ TPS, exactly-once)         |
| Database      | PostgreSQL 16 + Patroni HA + TimescaleDB      |
| Frontend      | Next.js 15 + React 18 (WebSocket blotter)     |
| Kubernetes    | K8s + Cilium eBPF (Zero Trust L7 policies)    |
| GitOps        | GitHub Actions CI + ArgoCD CD                 |
| Secrets       | HashiCorp Vault (dynamic creds, PKI, KMS)     |
| Observability | Prometheus + Grafana + Jaeger + OpenTelemetry |
| SWIFT         | ISO 20022 MX (fxtr/pacs/camt) + legacy MT     |
