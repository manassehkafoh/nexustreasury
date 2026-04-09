# NexusTreasury Changelog

All notable changes are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [1.1.0] — 2026-04-09 · Sprint 7 Foundations

### Added — Testing Quality
- **Stryker mutation testing** — `stryker.config.ts`, targets domain + accounting + risk + collateral
- **Pact consumer contract tests** — `tests/contract/` — accounting-service + notification-service consumers
- **k6 performance test suite** — `tests/performance/` — 500 TPS trade booking + LCR batch load
- **Newman API smoke test runner** — `scripts/run-api-tests.sh` — local/staging/production
- **`performance-tests.yml`** GitHub Actions workflow — auto-fires post-staging-deploy
- **`contract-tests.yml`** GitHub Actions workflow — Pact consumer/provider + can-i-deploy gate

### Added — Infrastructure
- **Multi-region ArgoCD ApplicationSet** — eu-west-1 (primary) + us-east-1 (secondary) active-active
- **Kafka MirrorMaker 2** — cross-region topic replication, RPO < 1 minute
- **Route53 health check config** — latency routing, RTO < 5 minutes
- **12 PodDisruptionBudgets** — node drain protection for all production workloads
- **ResourceQuota + LimitRange** — namespace-level resource governance
- **K8s base manifests** complete for all 13 services (accounting + reporting added)

### Added — Developer Experience
- **VS Code Dev Container** — `.devcontainer/devcontainer.json` + `setup.sh`, < 5min to first green build
- **Makefile** (25 targets) — `make test`, `make dev`, `make infra-up`, `make k6`, `make api-test`, etc.

### Added — API Documentation
- **OpenAPI 3.1 v1.1.0** — expanded from 20 → 29 paths (collateral, notifications, market-data, risk limits)
- **Postman collection** expanded — 14 → 17 live requests (margin call, FX rates, tenant provisioning)
- **ADR-001 through ADR-007** — foundational architectural decisions documented

### Updated — Documentation
- **README.md** — corrected to 13 services, updated tech stack versions, full capabilities table
- **Testing-Strategy.md** — complete rewrite covering all 5 layers
- **C4 deployment diagram** — multi-region active-active architecture documented
- **Developer onboarding guide** — devcontainer option, Makefile reference, Newman smoke tests

## [1.0.0] — 2026-04-09 · Production Ready

### Added — Post-Production (9 April 2026)

**Documentation completeness pass**
- `docs/wiki/Testing-Strategy.md` — Complete rewrite: 5-layer testing pyramid covering 502 unit tests, 31 E2E tests, 7 benchmark suites, k6 performance tests, Pact contract tests, and Stryker mutation testing. Previous version described an outdated Playwright/Docker-Compose pyramid.
- `docs/architecture/c4/05-deployment.md` — Multi-region active-active section: Region topology diagram, RPO/RTO targets, ArgoCD ApplicationSet flow, Kafka MirrorMaker 2 details, Route53 failover sequence.
- `docs/runbooks/developer-onboarding.md` — Complete rewrite: VS Code Dev Container (Option A, < 5 min), manual setup (Option B), full Makefile quick reference (25 targets), Postman/Newman API testing, environment variable table, tenant provisioning, common issues.
- `docs/wiki/branding-system.md` — New wiki: BrandConfig schema, built-in themes (nexustreasury + republic-bank), runtime CSS custom properties, adding a new brand, Platform Admin API for brand updates.
- `docs/adr/README.md` — Complete register of all 10 ADRs with links, dates, and statuses.

**Architecture Decision Records (ADR-001 through ADR-007)**
- ADR-001: Monorepo with pnpm Workspaces + Turborepo
- ADR-002: Fastify 5 vs Express vs NestJS
- ADR-003: PostgreSQL + TimescaleDB vs Cassandra
- ADR-004: Apache Kafka vs RabbitMQ vs NATS
- ADR-005: Keycloak vs Auth0 vs AWS Cognito
- ADR-006: TypeScript Strict Mode Throughout
- ADR-007: Vitest vs Jest

**Infrastructure**
- `infra/argocd/nexustreasury-multiregion.yaml` — ArgoCD ApplicationSet (eu-west-1 + us-east-1), Kafka MirrorMaker 2, Route53 health check ConfigMap
- `infra/kubernetes/overlays/production-eu-west-1/` + `production-us-east-1/` — Multi-region Kustomize overlays with replica patches
- `infra/kubernetes/base/accounting-service.yaml` — Missing K8s base manifest added
- `infra/kubernetes/base/reporting-service.yaml` — Missing K8s base manifest added
- `infra/kubernetes/base/pdb.yaml` — 12 PodDisruptionBudgets for all workloads
- `infra/kubernetes/base/resource-quotas.yaml` — ResourceQuota + LimitRange for nexustreasury namespace
- `infra/kubernetes/base/kustomization.yaml` — Updated to include all 13 services, PDB, and ResourceQuota

**Developer Experience**
- `.devcontainer/devcontainer.json` — VS Code Dev Container: Node.js 22, Docker-in-Docker, kubectl, Helm, GitHub CLI, 10 extensions, all ports forwarded
- `.devcontainer/setup.sh` — Post-create setup: installs pnpm, builds all services, runs migrations, smoke tests. First green build < 5 minutes.
- `Makefile` — 25 developer targets: `make test`, `make dev`, `make infra-up`, `make api-test`, `make k6`, `make provision-tenant`, etc.
- `stryker.config.ts` — Mutation testing config: vitest runner, 5 source packages, kill score thresholds (break=65%, low=70%, high=80%)

**Performance & Quality**
- `tests/performance/trade-booking.k6.js` — 3 scenarios (steady 50 VUs, ramp 100 VUs, spike 200 RPS), custom metrics, SLA thresholds
- `tests/performance/lcr-report.k6.js` — 10 VUs × 2 min regulatory batch load test
- `tests/contract/trades-booked.consumer.pact.ts` — accounting-service consumer contract
- `tests/contract/limit-breach.consumer.pact.ts` — notification-service consumer contract
- `tests/contract/README.md` — Contract test documentation, Pact Broker workflow

**CI/CD**
- `.github/workflows/contract-tests.yml` — Pact consumer/provider + can-i-deploy gate
- `.github/workflows/performance-tests.yml` — k6 post-staging SLA validation
- `scripts/run-api-tests.sh` — Newman API test runner (local/staging/production)

**API Documentation**
- `docs/api/openapi.yaml` — Updated v1.1.0: 20 → 29 paths; added collateral (3), notifications (2), market-data (2), risk limits (2) endpoints; 5 new schemas
- Postman workspace: 14 → 17 live requests; collection pre-request auth guard; OpenAPI spec updated to v1.1.0


### Platform Statistics
- **13** microservices (all TypeScript strict, Clean Architecture + DDD)
- **533** automated tests (502 unit + 31 E2E) — 0 failures
- **0** production CVEs (`pnpm audit --prod`)
- **QA Score**: 9.8 / 10 (from 8.7 baseline on 7 April 2026)

---

### Added — Sprint 1 (Pricing Engine + Greeks)

- `@nexustreasury/domain` — Pure domain library: Trade aggregate, Money/BusinessDate value objects, Black-Scholes option pricer (A&S 26.2.16 normCDF), Bond pricer (YTM + DV01 + convexity), IRS multi-curve NPV, FX CIP forward pricer
- `@nexustreasury/trade-service` (:4001) — Trade booking with synchronous OFAC+HMT+UN sanctions screening (fuzzy name + BIC matching), pre-deal credit limit check (P99 < 5ms in-memory cache)
- `@nexustreasury/position-service` (:4002) — Real-time position MTM, Kafka-driven revaluation
- `@nexustreasury/risk-service` (:4003) — Pre-deal limit hierarchy, book-level Greeks aggregation
- `@nexustreasury/alm-service` (:4004) — LCR, NSFR, NMD modelling (Basel III)
- `@nexustreasury/bo-service` (:4005) — SWIFT MT202/MT103/MT210 settlement instructions, nostro reconciliation (AI/ML break classification)
- `@nexustreasury/market-data-service` (:4006) — Bloomberg BLPAPI + LSEG RDP adapter, rate snapshot Kafka publisher
- `@nexustreasury/web` (:3000) — Next.js 15 dashboard: Trading Blotter, Liquidity Dashboard, Risk Limit Panel

### Added — Sprint 2-3 (Accounting + Settlement)

- `@nexustreasury/accounting-service` (:4007) — IFRS9 classifier (FVPL/FVPL_MANDATORY/FVOCI/AMC/FVOCI_EQUITY), double-entry journal engine, hedge accounting effectiveness testing, Islamic finance (Murabaha/Sukuk/Ijara)
- ECL Calculator — PD/LGD/EAD, Stage 1/2/3 migration, ML-injectable PD model interface
- SWIFT nostro reconciliation — camt.053/MT940 parsing, exact/reference/amount/date matching, AI break insight

### Added — Sprint 4 (VaR Engine + FRTB)

- Historical VaR — 250-day window, √10 scaling, Expected Shortfall (BCBS 352)
- Stressed VaR — 1-year stressed window (2008 GFC + 2020 COVID)
- FRTB SA Capital — BCBS 457 Sensitivity-Based Method: Delta+Vega+Curvature across GIRR, FX, Equity, Credit, Commodity
- Corporate Actions — Coupon payments, principal repayment, swap resets, lifecycle Kafka events

### Added — Sprint 5-6 (Audit + Notification + Collateral + Regulatory)

- `@nexustreasury/audit-service` (:4008) — HMAC-SHA256 tamper-evident audit trail, Elasticsearch append-only index, 10-year retention, daily integrity verification CronJob
- `@nexustreasury/notification-service` (:4009) — Event-driven alerts: EMAIL + WebSocket + Webhook, priority routing (CRITICAL/WARNING/INFO)
- `@nexustreasury/collateral-service` (:4010) — ISDA CSA/GMRA margin call computation, CTD optimisation, WE_CALL/THEY_CALL direction, UMR Phase 6 initial margin
- `@nexustreasury/reporting-service` (:4011) — BCBS 238 LCR Daily, BCBS 239 BCBS RDARR, BCBS 368 IRRBB Outlier Test (6 scenarios), BCBS 295 NSFR, FX eDealing P&L attribution

### Added — Infrastructure

- Kubernetes: KEDA Kafka-lag scaling (audit), HPA configs for all 13 services, Zero Trust network policies, Vault agent secret injection
- ArgoCD: GitOps deployment pipelines (staging + production), canary (10% → 100%)
- GitHub Actions: 12-service Docker build matrix (linux/amd64), Trivy CVE scanning, CodeQL SAST, Snyk SCA, E2E Vitest integration job
- Helm chart: Full nexustreasury chart with staging/production value overlays
- Prometheus: 40+ alert rules (SLO burn rate, limit breaches, Kafka lag, reconciliation breaks)
- Grafana: Datasource provisioning, SLO dashboards

### Added — Branding System

- `BrandConfig` interface — 11 colour tokens, 3 font stacks, SVG logo mark/wordmark, locale (RTL/LTR), 6 feature flags per tenant
- Built-in presets: NexusTreasury (navy/gold), Republic Bank (Caribbean gold), Minimal (GitHub dark)
- `generateCSSVariables()` — SSR zero-FOUC CSS custom property injection
- `BrandProvider` + `useBrand()` — React context for runtime theming
- `BrandAdmin` — Tenant runtime brand customisation UI (PLATFORM_ADMIN role required)

### Added — Developer Experience

- Developer onboarding guide (15 sections, first green build in 15 min)
- Production runbook (P1/P2/P3 incident playbooks, scaling procedures, security incident response)
- `scripts/provision-tenant.ts` — 10-step tenant onboarding automation with dry-run support
- 10 Architecture Decision Records (ADR-001 through ADR-010)
- 8 C4 diagrams (system context → container → component → deployment → security → Kafka → data)
- 6 domain wikis + 12 learner guides
- Postman workspace: 3 specs + 1 collection (14 requests, 8 example responses) + 3 environments + 1 mock server

### Security

- Zero production CVEs (pnpm audit --prod)
- JWT patched: @fastify/jwt ^9.1.0 (GHSA-mvf2, GHSA-rp9m, GHSA-hm7r, GHSA-gm45)
- Fastify patched: ^5.8.4 (GHSA-jx2c, GHSA-444r, GHSA-mrq3)
- HMAC-SHA256 audit trail with HashiCorp Vault key management
- Keycloak OIDC with MFA mandatory for risk/compliance/admin roles

---

## [0.1.0] — 2026-04-07 · QA Baseline

- Initial QA closure report: 8.7/10
- Gaps identified: test coverage (4/10), API documentation (0/10)
- 12-week remediation plan vs Calypso feature parity documented
