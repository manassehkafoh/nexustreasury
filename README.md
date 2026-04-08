# NexusTreasury

> **Cloud-Native Treasury Management Platform** — Real-time, event-driven, SOC 2 compliant.
> The next-generation alternative to Calypso, Murex, and Finastra.

[![CI Pipeline](https://github.com/manassehkafoh/nexustreasury/actions/workflows/ci.yml/badge.svg)](https://github.com/manassehkafoh/nexustreasury/actions/workflows/ci.yml)
[![Security Patch](https://github.com/manassehkafoh/nexustreasury/actions/workflows/security-patch.yml/badge.svg)](https://github.com/manassehkafoh/nexustreasury/actions/workflows/security-patch.yml)

---

## Architecture

NexusTreasury is built on **Domain-Driven Design** with **8 independent microservices**, each owning its own database schema, communicating via **Apache Kafka** event streaming.

```
packages/
├── domain/               ← Shared DDD kernel (aggregates, value objects, domain events)
├── trade-service/        ← Trade booking, amendment, cancellation  [port 4001]
├── position-service/     ← Event-sourced real-time position management [port 4002]
├── risk-service/         ← Pre-deal checks, VaR, limit management  [port 4003]
├── alm-service/          ← LCR, NSFR, liquidity gap, IRRBB  [port 4004]
├── bo-service/           ← SWIFT, settlement, Nostro recon  [port 4005]
├── market-data-service/  ← Bloomberg/Refinitiv rate publishing  [port 4006]
└── web/                  ← Next.js 14 dealing room frontend  [port 3000]
```

## Tech Stack

| Layer             | Technology                                          |
| ----------------- | --------------------------------------------------- |
| **Language**      | TypeScript 5.4 (strict mode throughout)             |
| **API Framework** | Fastify 4 (REST + OpenAPI 3.0)                      |
| **Frontend**      | Next.js 14, React 18, Tailwind CSS                  |
| **Event Bus**     | Apache Kafka (exactly-once semantics)               |
| **Database**      | PostgreSQL 16 + TimescaleDB + Row Level Security    |
| **Cache**         | Redis 7                                             |
| **Secrets**       | HashiCorp Vault                                     |
| **Identity**      | Keycloak (OAuth2/OIDC)                              |
| **Networking**    | Cilium eBPF (Zero Trust mTLS)                       |
| **Orchestration** | Kubernetes + Helm + ArgoCD GitOps                   |
| **Observability** | OpenTelemetry → Prometheus + Grafana + ELK + Jaeger |
| **Build**         | Turborepo + pnpm workspaces                         |
| **CI/CD**         | GitHub Actions (blue-green, 2-approver gate)        |
| **Security**      | Renovate Bot + Trivy (CVE patched < 24h)            |

## Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9
- Docker + Docker Compose
- kubectl (for Kubernetes deployment)

## Quick Start (Local Dev)

```bash
# 1. Clone
git clone https://github.com/manassehkafoh/nexustreasury
cd nexustreasury

# 2. Install dependencies
pnpm install

# 3. Start the full local stack (PostgreSQL, Kafka, Redis, Vault, Keycloak, observability)
pnpm docker:up

# 4. Wait for services (~ 60 seconds)
docker-compose logs -f kafka

# 5. Run database migrations
pnpm db:migrate

# 6. Start all services in dev mode (with hot reload)
pnpm dev

# 7. Open the dealing room UI
open http://localhost:3000

# 8. API docs (Swagger UI)
open http://localhost:4001/docs

# 9. Grafana dashboards
open http://localhost:3001   # admin / nexus_grafana_admin

# 10. Kafka UI
open http://localhost:8080
```

## Running Tests

```bash
# All unit tests + coverage
pnpm test:coverage

# Type checking across all packages
pnpm typecheck

# Lint
pnpm lint

# E2E (requires local stack running)
pnpm --filter @nexustreasury/web test:e2e
```

## Microservice Ports

| Service               | Port  | Description                  |
| --------------------- | ----- | ---------------------------- |
| `web`                 | 3000  | Next.js dealing room UI      |
| `trade-service`       | 4001  | Trade booking REST API       |
| `position-service`    | 4002  | Real-time position engine    |
| `risk-service`        | 4003  | Pre-deal checks, VaR, limits |
| `alm-service`         | 4004  | LCR/NSFR/liquidity gap       |
| `bo-service`          | 4005  | SWIFT, settlement, Nostro    |
| `market-data-service` | 4006  | Bloomberg/Refinitiv bridge   |
| `postgres`            | 5432  | TimescaleDB                  |
| `redis`               | 6379  | Cache + rate limiting        |
| `kafka`               | 9092  | Event bus                    |
| `kafka-ui`            | 8080  | Kafka browser                |
| `schema-registry`     | 8081  | Confluent Schema Registry    |
| `vault`               | 8200  | HashiCorp Vault              |
| `keycloak`            | 8443  | Identity provider            |
| `prometheus`          | 9090  | Metrics                      |
| `grafana`             | 3001  | Dashboards                   |
| `elasticsearch`       | 9200  | Log storage                  |
| `kibana`              | 5601  | Log dashboards               |
| `jaeger`              | 16686 | Distributed tracing          |

## SLA Targets

| Metric             | Target                 |
| ------------------ | ---------------------- |
| Uptime             | 99.99%                 |
| Trade booking P99  | < 100ms                |
| Pre-deal check P99 | < 5ms                  |
| Throughput         | 500+ TPS               |
| LCR recalculation  | Real-time (< 1s)       |
| VaR recalculation  | < 5 seconds            |
| STP Rate           | ≥ 95%                  |
| CVE Patch Time     | < 24 hours (automated) |

## Deployment

```bash
# Staging (auto-deploys on main branch push)
git push origin main

# Production (manual approval required — 2 approvers)
# Trigger via GitHub Actions → CD Production workflow
# Provide image_tag and type 'DEPLOY' to confirm
```

## Regulatory Coverage

Basel IV · FRTB SA/IMA · IRRBB BCBS 368 · LCR BCBS 238 · NSFR BCBS 295 · EMIR/Dodd-Frank · IFRS9 · Multi-GAAP · SOC 2 Type II

---

_NexusTreasury v1.0.0 — © 2026 NexusTreasury. Confidential._
