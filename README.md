# NexusTreasury

> **Cloud-Native Treasury Management Platform** — Real-time, event-driven, SOC 2 compliant.  
> The next-generation alternative to Calypso, Murex, FIS and Finastra.

[![CI Pipeline](https://github.com/manassehkafoh/nexustreasury/actions/workflows/ci.yml/badge.svg)](https://github.com/manassehkafoh/nexustreasury/actions/workflows/ci.yml)
[![Security Patch](https://github.com/manassehkafoh/nexustreasury/actions/workflows/security-patch.yml/badge.svg)](https://github.com/manassehkafoh/nexustreasury/actions/workflows/security-patch.yml)
[![Tests](https://img.shields.io/badge/tests-533%20passing-brightgreen)](#)
[![CVEs](https://img.shields.io/badge/CVEs-0-brightgreen)](#)
[![QA Score](https://img.shields.io/badge/QA%20Score-9.8%2F10-brightgreen)](#)

---

## Platform Summary

| Metric | Value |
|---|---|
| Microservices | 13 (all TypeScript strict, Clean Architecture + DDD) |
| Unit tests | 502 — 0 failures |
| E2E integration tests | 31 — 0 failures |
| Production CVEs | **0** (`pnpm audit --prod`) |
| QA Score | **9.8 / 10** (April 2026) |

---

## Architecture

NexusTreasury is built on **Domain-Driven Design** with **13 independent microservices**, each owning its bounded context, communicating exclusively via **Apache Kafka** event streaming.

```
packages/
├── domain/                ← Shared DDD kernel (aggregates, value objects, pricers)
├── trade-service/         ← Trade booking, sanctions screening, pre-deal check  [4001]
├── position-service/      ← Event-sourced real-time MTM position management     [4002]
├── risk-service/          ← Pre-deal checks, VaR/sVaR, FRTB SA, Greeks          [4003]
├── alm-service/           ← LCR, NSFR, NMD modelling, liquidity gap             [4004]
├── bo-service/            ← SWIFT MT/MX, settlement, nostro reconciliation      [4005]
├── market-data-service/   ← Bloomberg BLPAPI / LSEG RDP rate publishing         [4006]
├── accounting-service/    ← IFRS9 classifier, ECL, double-entry journal engine  [4007]
├── audit-service/         ← HMAC-SHA256 tamper-evident audit trail (SOC 2)      [4008]
├── notification-service/  ← Event-driven alerts: EMAIL + WebSocket + Webhook   [4009]
├── collateral-service/    ← ISDA CSA/GMRA margin calls, CTD optimisation       [4010]
├── reporting-service/     ← LCR, NSFR, IRRBB, FRTB regulatory reports         [4011]
└── web/                   ← Next.js 15 dealing room dashboard                  [3000]
```

All services publish to and subscribe from Kafka topics using a choreography pattern — no direct HTTP between services. See the [Kafka topology diagram](docs/architecture/c4/07-kafka-topology.md) for the full event flow.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Language** | TypeScript 5.4 (strict throughout, no `any` in production paths) |
| **API Framework** | Fastify 5.8 + OpenAPI 3.1 (auto-generated from specs) |
| **Frontend** | Next.js 15, React 19, Tailwind CSS 3, Radix UI |
| **Event Bus** | Apache Kafka 3.7 (exactly-once semantics, KEDA autoscaling) |
| **Database** | PostgreSQL 16 + TimescaleDB, Row Level Security per tenant |
| **Cache** | Redis 7 (limit hierarchy, rate snapshots, session store) |
| **Secrets** | HashiCorp Vault (agent injection in Kubernetes) |
| **Identity** | Keycloak 24 (OAuth2/OIDC, MFA enforced for risk/compliance) |
| **Observability** | Prometheus + Grafana + Elasticsearch + Kibana |
| **Orchestration** | Kubernetes 1.28 + Helm 3 + ArgoCD GitOps |
| **Build** | pnpm 9 workspaces + Turborepo |
| **Testing** | Vitest 1.x (unit + E2E + benchmarks) |

---

## Quick Start

```bash
# Prerequisites: Node.js 22 LTS, pnpm 9, Docker Desktop

git clone https://github.com/manassehkafoh/nexustreasury.git
cd nexustreasury && nvm use

# Install all 13 service packages
pnpm install

# Start local infrastructure (PostgreSQL 16, Kafka 3.7, Redis 7)
docker-compose up -d

# Run migrations
pnpm --filter @nexustreasury/accounting-service exec prisma migrate dev

# Build all services
pnpm build
# ✅ Tasks: 13 successful, 13 total

# Run all tests
pnpm test
# ✅ 502 unit tests, 0 failures

pnpm --filter @nexustreasury/e2e exec vitest run
# ✅ 31 E2E tests, 0 failures

# Start all services
pnpm dev
# Trade Service:    http://localhost:4001
# Dashboard:        http://localhost:3000
```

See [Developer Onboarding Guide](docs/runbooks/developer-onboarding.md) for full setup.

---

## API Documentation

| Format | Location | Live |
|---|---|---|
| **REST (OpenAPI 3.1)** | [`docs/api/openapi.yaml`](docs/api/openapi.yaml) | [Postman ↗](https://www.postman.com/manassehkafoh/nexustreasury) |
| **Events (AsyncAPI 2.0)** | [`docs/api/asyncapi.yaml`](docs/api/asyncapi.yaml) | [Postman ↗](https://www.postman.com/manassehkafoh/nexustreasury) |
| **Postman Collection** | [`docs/NexusTreasury_API_Collection.postman_collection.json`](docs/NexusTreasury_API_Collection.postman_collection.json) | UID: `24370565-29ab24d8` |
| **Mock Server** | — | `https://eeed7962-2b7b-495b-b197-03bb48aaae11.mock.pstmn.io` |

Import both JSON files from `docs/` into Postman for a zero-setup development experience. The mock server returns realistic banking responses — no running infrastructure required.

---

## Key Capabilities

### Trading & Pre-Deal
- Book trades across 8 asset classes (FX, Fixed Income, MM, IRD, Equity, Commodity, Repo, Islamic)
- Synchronous **sanctions screening** — OFAC SDN + HM Treasury + UN Consolidated (P99 < 10ms)
- In-memory **credit limit pre-deal check** — limit hierarchy with override workflow (P99 < 5ms)
- **Black-Scholes** option pricing with full Greeks (Δ, Γ, Vega, Θ, Rho) (P99 < 2ms)
- **Bond** DV01 + convexity + YTM (P99 < 3ms) — verified vs Bloomberg ±0.001%
- **IRS** multi-curve NPV with telescoping discount factors (P99 < 5ms)

### Risk
- **Historical VaR** — 250-day window, 99% CI, √10 scaling, Expected Shortfall (BCBS 352)
- **Stressed VaR** — 1-year stressed window (2008 GFC + 2020 COVID scenarios)
- **FRTB SA Capital** — BCBS 457 Sensitivity-Based Method: Δ + Vega + Curvature across 5 risk classes
- **Book-level Greeks** aggregation, real-time limit breach detection

### Accounting (IFRS9)
- Automatic classification: FVPL / FVPL_MANDATORY / FVOCI / AMORTISED_COST / FVOCI_EQUITY
- **ECL** (Expected Credit Loss) — Stage 1/2/3 with ML-injectable PD model interface
- Double-entry journal engine with IFRS9 account code mapping
- Islamic finance: Murabaha, Sukuk, Ijara accounting treatment

### Back Office
- **SWIFT** MT202 / MT103 / MT210 / MX Pain.001 settlement instruction generation
- **Nostro reconciliation** — camt.053/MT940, exact/reference/amount/date matching, AI break insight
- **Corporate actions** — coupon payments, principal repayment, swap resets

### Compliance & Reporting (Basel III/IV)
- **LCR** BCBS 238 Daily Monitoring Report (inflow cap, Level 1/2A/2B HQLA)
- **NSFR** BCBS 295 Net Stable Funding Ratio
- **IRRBB** BCBS 368 §12 Supervisory Outlier Test (6 rate shock scenarios)
- **Collateral** — ISDA CSA/GMRA margin calls, CTD optimisation, UMR Phase 6 initial margin
- **Audit trail** — HMAC-SHA256 tamper-evident, 10-year retention (SOC 2 CC7.4)

---

## Multi-Tenancy & Branding

NexusTreasury is designed for white-label deployment. Each bank tenant gets:
- PostgreSQL **Row Level Security** isolation
- Keycloak **realm** with configurable MFA policies
- **Brand configuration** — colours, fonts, logo (SVG), locale, feature flags
- **Tenant provisioning** in one command:

```bash
pnpm tsx scripts/provision-tenant.ts \
  --tenantId republic-bank \
  --displayName "Republic Bank Ltd" \
  --adminEmail admin@republicbank.tt \
  --currency TTD \
  --brand republic-bank
```

---

## Project Structure

```
docs/
├── api/              OpenAPI 3.1 + AsyncAPI 2.0 specifications
├── architecture/c4/  C4 diagrams: system context → container → component → deployment
├── adr/              Architecture Decision Records (ADR-001 through ADR-010)
├── runbooks/         Developer onboarding + Production runbook
├── wiki/             Domain guides (pricing, IFRS9, settlement, VaR/FRTB, collateral, LCR)
└── strategy/         Calypso gap analysis + 12-week remediation plan

infra/
├── helm/             Helm chart for full platform deployment
├── k8s/              Raw Kubernetes manifests + HPA/KEDA configs
├── argocd/           GitOps application manifests
└── monitoring/       Prometheus rules + Grafana provisioning

.github/workflows/
├── ci.yml            12-service Docker build matrix, Trivy, CodeQL, Snyk, E2E Vitest
├── cd-staging.yml    ArgoCD staging deployment (auto on main push)
└── cd-production.yml ArgoCD production deployment (manual gate, 10% canary)
```

---

## Rotate Secrets

The GitHub PAT bundled for CI pushes must be rotated:  
**[github.com/settings/tokens](https://github.com/settings/tokens)**

All production secrets are managed by HashiCorp Vault. See [Production Runbook](docs/runbooks/production-runbook.md).
