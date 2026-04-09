# NexusTreasury Changelog

All notable changes are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [1.0.0] — 2026-04-09 · Production Ready

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
