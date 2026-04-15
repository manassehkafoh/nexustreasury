# NexusTreasury — Product Requirements Document

**Version**: 1.0.0 | **Status**: Approved
**Author**: Product Architecture Team | **PM Owner**: Chief Product Officer
**Last Updated**: 2026-04-07
**Reviewers**: CTO, Head of Risk, Head of Treasury, CISO, Chief Architect
**Approvers**: CEO, CTO, CPO

---

## Change Log

| Version | Date | Author | Change |
|---------|------|--------|--------|
| 0.1 | 2026-03-01 | Architecture Team | Initial Draft |
| 0.5 | 2026-03-15 | Architecture Team | Added ALM & Risk modules |
| 1.0 | 2026-04-07 | Architecture Team | Approved for development |

---

## 1. Executive Summary

NexusTreasury is a next-generation, cloud-native, event-driven Treasury Management System (TMS) designed to supersede monolithic legacy platforms such as Nasdaq Calypso, Finastra, and Murex in every measurable dimension. Built on a domain-driven, microservices architecture with React/Next.js frontend and Node.js/TypeScript backend, NexusTreasury delivers real-time treasury operations, strategic Asset-Liability Management (ALM), cross-asset trading, full back-office automation, and integrated risk management within a single, modular, cloud-portable platform.

Success is defined as onboarding a Tier-1 bank within 18 months of GA release, achieving >99.99% uptime SLA, processing 50,000+ trades/day with sub-100ms latency, and attaining SOC 2 Type II certification within 12 months.

---

## 2. Problem Statement

### 2.1 Current State

Banks operating legacy treasury platforms (Calypso, Murex, Finastra Kondor) face:

- **Architectural debt**: Monolithic Java applications with 15–20-year-old codebases requiring specialist consultants for every change.
- **Poor integration**: Point-to-point integrations with core banking systems (Temenos T24, Oracle Flexcube) that break on upgrades.
- **No real-time event streaming**: Batch-based processing introduces latency incompatible with real-time regulatory reporting (FRTB, Basel IV).
- **Brittle deployment**: On-premise deployments with 6–12 month upgrade cycles and no cloud portability.
- **Inadequate observability**: Black-box systems with minimal logging, tracing, or performance dashboards.
- **Security gaps**: Legacy authentication, no Zero Trust architecture, manual patch management.
- **Prohibitive cost**: Calypso licensing averages $2M–$10M annually plus $5M–$30M implementation costs.

### 2.2 Pain Points & User Impact

| Persona | Pain Point | Business Impact |
|---------|-----------|-----------------|
| Treasury Dealer | No real-time P&L across positions | Blind to intraday risk; trades on stale data |
| Risk Manager | ALM gap reports produced in overnight batch | Cannot respond to intraday liquidity events |
| Back Office Ops | Manual SWIFT message reconciliation | 15–20 FTE dedicated to manual exception handling |
| CTO/Architect | Cannot deploy updates without 6-month vendor cycles | 2-year digital transformation timelines |
| CISO | No automated CVE patching; no SOC 2 compliance | Regulatory fines; audit failures |
| CFO | Opaque licensing + implementation costs | $30M+ TCO over 5 years with no flexibility |

### 2.3 Opportunity

- **Global TMS market**: $6.2B in 2025, growing at 9.4% CAGR (Grand View Research).
- **Underserved segment**: Tier 2/3 banks in Africa, Middle East, and Asia lack affordable Tier-1 TMS capability.
- **Regulatory pressure**: FRTB, Basel IV, IRRBB, LCR/NSFR compliance deadlines driving platform replacement.
- **Cloud migration wave**: 70% of banks plan core system cloud migration by 2028 (McKinsey).

---

## 3. Goals & Success Metrics

| Goal | Metric | Baseline | Target | Measurement Method |
|------|--------|----------|--------|--------------------|
| Platform Availability | Uptime SLA | N/A | 99.99% | Prometheus/Grafana |
| Trade Processing Latency | P99 end-to-end trade booking | Calypso: ~500ms | <100ms | APM traces |
| Trade Throughput | Trades per second | Calypso: ~50 TPS | 500+ TPS | Load tests |
| Risk Calculation Speed | Real-time VaR recalculation | Calypso: Nightly batch | <5 seconds | Benchmarks |
| Regulatory Coverage | Basel IV / FRTB / IRRBB compliance | 0% | 100% | Audit assessment |
| SOC 2 Type II | Certification | Not certified | Certified ≤12 months | Auditor report |
| Time to Onboard | Days from contract to production | Industry: 18 months | 6 months | Project tracker |
| Developer Productivity | New feature cycle time | 6 months (Calypso) | 2-week sprints | GitHub metrics |
| TCO Reduction | 5-year cost vs. Calypso | $30M+ | <$8M | Finance model |
| Security Patch Time | Mean time to patch critical CVE | Industry: 30 days | <24 hours automated | Security dashboard |

---

## 4. Scope

### In Scope

**Core Trading & Front Office**
- Cross-asset trade capture: FX Spot/Forward/Options, Fixed Income, Money Market, Interest Rate Derivatives, Repos/Reverse Repos, Equities, Commodities, Islamic Finance instruments
- Real-time P&L and position management
- Pre-deal limit checks (credit, market, concentration)
- FX eDealing portal with streaming rates
- Order management and execution workflow

**Treasury & ALM**
- Cash management and Nostro monitoring
- Liquidity forecasting (cash flow ladder, behavioral assumptions)
- ALM: Liquidity Gap, Interest Rate Gap (repricing & maturity)
- IRRBB: NII sensitivity, EVE (Economic Value of Equity)
- Liquidity ratios: LCR, NSFR
- Funds Transfer Pricing (FTP)
- Balance Sheet Management and Hedging
- Stress Testing (market data and behavioral)

**Risk Management**
- Credit Risk: Counterparty limits, PFE, CVA
- Market Risk: VaR (historical, parametric, Monte Carlo), Stressed VaR
- Interest Rate Risk in the Banking Book (IRRBB)
- Liquidity Risk: LCR, NSFR, NOOP scenarios
- Limit Management: hierarchical limit trees with real-time breach alerts
- XVA: CVA, DVA, FVA

**Back Office**
- Validation workflows and exceptions management
- SWIFT MT/MX confirmation and matching
- Settlement processing (SSIs, delivery instructions)
- Nostro intraday and EOD reconciliation
- Corporate actions processing
- Collateral Management (ISDA CSA, GMRA, GMSLA)
- Custody and securities delivery
- BO reporting

**Accounting**
- IFRS9-compliant accounting (AMC, FVOCI, FVPL)
- Hedge accounting
- Multi-GAAP support (IFRS, US GAAP, local GAAPs)
- Multi-entity, multi-currency sub-ledger
- Data feed to General Ledger systems

**Platform Management Plane**
- Tenant management and multi-tenancy
- Role-based access control (RBAC) with fine-grained permissions
- Automated security patch management pipeline
- Performance dashboards (Grafana)
- Log aggregation and analysis (ELK Stack)
- Distributed tracing (Jaeger/OpenTelemetry)
- CI/CD pipeline management
- Kubernetes cluster management interface

**Connectivity & Integration**
- Market data: Bloomberg, Refinitiv (LSEG), Markit
- Core banking: Temenos T24, Oracle Flexcube, SAP, Infosys Finacle
- Settlement networks: SWIFT MT/MX, CLS, DTCC
- Clearing: CCPs (LCH, Eurex, DTCC, CME)
- Trade repositories: DTCC, REGIS-TR
- Electronic trading: Bloomberg TSOX, Tradeweb, 360T, FXall

### Out of Scope (v1.0)

- Retail banking modules
- Card processing
- Core banking general ledger (integration via API only)
- Cryptocurrency native trading (planned v2.0)
- AI/ML predictive analytics engine (planned v1.5)

### Future Considerations (Roadmap)

| Feature | Version | Timeline |
|---------|---------|----------|
| AI-powered anomaly detection | v1.5 | Q4 2027 |
| Cryptocurrency/DeFi instruments | v2.0 | Q2 2028 |
| Embedded RegTech reporting | v1.5 | Q1 2028 |
| Mobile treasury app | v1.2 | Q2 2027 |
| Carbon/ESG instrument support | v2.0 | Q2 2028 |

---

## 5. User Personas & Jobs-to-be-Done

### Persona 1: Treasury Dealer ("Alex")

- **Context**: Senior FX Dealer at a Tier-2 bank, trading $500M daily across FX and fixed income. Works in a fast-paced dealing room.
- **Goals**: Execute trades with real-time pricing, see live P&L, manage limits, and communicate with back office without friction.
- **Pain Points**: Stale prices from batch-updated systems; having to email back office for settlement instructions; limit checks running overnight.
- **Job-to-be-Done**: *When I'm about to execute a $50M FX trade, I want instant pre-deal limit verification and streaming market prices, so I can trade confidently within risk parameters without delaying the client.*

### Persona 2: ALM Manager ("Priya")

- **Context**: Head of ALM at a regional bank. Responsible for LCR/NSFR reporting, interest rate gap management, and IRRBB submissions to regulators.
- **Goals**: Real-time visibility of the liquidity gap, instant stress scenario modeling, automated regulatory ratio calculation.
- **Pain Points**: Overnight batch jobs mean she can't see intraday liquidity position; building stress scenarios is manual and error-prone; IRRBB calculations take 4 hours.
- **Job-to-be-Done**: *When regulators request an intraday LCR snapshot, I want automated, real-time ratio calculation pulling from all business lines, so I can respond in minutes, not hours.*

### Persona 3: Back Office Operations Analyst ("Marcus")

- **Context**: BO Analyst responsible for SWIFT confirmations, settlement instructions, and nostro reconciliation for 200+ trades/day.
- **Goals**: Automated matching, STP (straight-through processing) rates above 95%, exception-driven workflow.
- **Pain Points**: Manual matching of SWIFT messages to trades; late settlement notifications causing penalty charges; no audit trail for amendments.
- **Job-to-be-Done**: *When a SWIFT MT300 confirmation arrives, I want automatic matching against the trade and instant exception flagging only when discrepancies exist, so I can process 200 confirmations in an hour instead of a day.*

### Persona 4: Risk Manager ("Sofia")

- **Context**: Head of Market Risk at a large bank. Responsible for VaR reporting, counterparty credit exposure, and FRTB capital calculations.
- **Goals**: Real-time VaR across all books, counterparty exposure limits enforced pre-deal, FRTB IMA/SA compliance.
- **Pain Points**: Risk calculations are overnight-only; no intraday VaR; pre-deal checks are manual phone calls.
- **Job-to-be-Done**: *When I open the risk dashboard, I want to see live VaR, Greeks, and counterparty exposure for every desk, so I can act on breaches before they become capital events.*

### Persona 5: Platform Engineer / DevOps Lead ("Carlos")

- **Context**: Platform Engineer at the bank or implementation partner, responsible for deploying, monitoring, and maintaining NexusTreasury on Kubernetes.
- **Goals**: GitOps-driven deployments, automated security patching, full observability, zero-downtime upgrades.
- **Pain Points**: Legacy TMS systems require 6-month vendor-driven upgrades; no native Kubernetes support; zero observability.
- **Job-to-be-Done**: *When a critical CVE is published for a dependency, I want the automated patching pipeline to test, build, and deploy the fix within 24 hours, so we remain compliant with our security SLA without human intervention.*

### Persona 6: CISO / Security Officer ("Amara")

- **Context**: Chief Information Security Officer ensuring the platform meets SOC 2 Type II, ISO 27001, and banking regulatory security standards.
- **Goals**: Full audit logs, Zero Trust enforcement, automated vulnerability scanning, encrypted data at rest and in transit.
- **Pain Points**: Legacy systems have no meaningful audit trails; patch management is manual and months behind; no WAF or runtime security monitoring.
- **Job-to-be-Done**: *When an audit is initiated, I want to export a complete, tamper-evident audit trail of every user action, API call, and system event for any time period, so I can respond to auditors within hours, not weeks.*

---

## 6. User Stories & Acceptance Criteria

### Epic: Cross-Asset Trade Capture (FO-001)

**US-FO-001**: As a Treasury Dealer, I want to capture an FX Forward trade with real-time streaming market rates, so that my trade price reflects live market conditions.

**Acceptance Criteria**:
- **Given** I am logged in as a dealer with FX trading permissions
- **When** I open the FX trade entry screen
- **Then** streaming mid-market rates from Bloomberg/LSEG update every 250ms
- **And** I can enter notional, currency pair, value date, and counterparty
- **And** pre-deal credit limit check completes in <200ms
- **And** on submission, the trade is booked and a Kafka event is published within 500ms
- **And** my live P&L dashboard reflects the new position within 1 second

**US-FO-002**: As a Treasury Dealer, I want pre-deal limit checks to execute in real-time before trade submission, so that I never accidentally breach a credit or concentration limit.

**Acceptance Criteria**:
- **Given** a trade is being structured with counterparty "Bank ABC"
- **When** notional amount is entered
- **Then** remaining credit headroom is displayed as a live indicator
- **And** if the trade would breach a limit, the UI shows a red warning with the limit detail
- **And** over-limit trades require an explicit override with justification and escalation workflow
- **And** all limit check attempts are logged to the audit trail

### Epic: Real-Time ALM Dashboard (ALM-001)

**US-ALM-001**: As an ALM Manager, I want a real-time liquidity gap report spanning all time buckets (O/N to 10Y+), so I can see intraday funding mismatches.

**Acceptance Criteria**:
- **Given** I open the Liquidity Gap dashboard
- **When** the screen loads
- **Then** cumulative and marginal liquidity gaps refresh every 30 seconds from Kafka event streams
- **And** gaps are displayed for contractual, behavioural, and stressed scenarios
- **And** I can drill down into any time bucket to see contributing positions
- **And** LCR and NSFR ratios update in real time

**US-ALM-002**: As an ALM Manager, I want to run ad-hoc stress scenarios with custom behavioral assumptions, so I can model the impact of deposit outflows and asset haircuts on the liquidity position.

**Acceptance Criteria**:
- **Given** I navigate to the Stress Testing module
- **When** I select a pre-defined scenario (e.g., "30-day stress") or build a custom one
- **Then** I can override behavioral assumption parameters (deposit runoff %, HQLA haircuts)
- **And** the stressed liquidity gap recalculates within 5 seconds
- **And** results can be exported to PDF/Excel and saved as named scenarios

### Epic: SWIFT Automation (BO-001)

**US-BO-001**: As a Back Office Analyst, I want inbound SWIFT MT300 confirmations to be auto-matched against booked FX trades, so I process only exceptions manually.

**Acceptance Criteria**:
- **Given** a SWIFT MT300 message is received from counterparty
- **When** the message is parsed by the SWIFT gateway
- **Then** matching against the trade blotter attempts automatically using trade reference, CCY pair, notional, and value date
- **And** matched confirmations are closed with STP status within 60 seconds
- **And** unmatched or discrepant messages are routed to the exceptions queue with detailed mismatch reason
- **And** STP rate is calculated and displayed on the BO dashboard

---

## 7. Functional Requirements

### 7.1 Front Office

| ID | Requirement | Priority | Notes |
|----|-------------|----------|-------|
| REQ-F-001 | System shall support capture of FX Spot, Forward, NDF, Options, Swaps | MUST | |
| REQ-F-002 | System shall support Fixed Income instruments: Bonds, T-Bills, CDs, CP | MUST | |
| REQ-F-003 | System shall support Money Market: Deposits, Loans, CDs, T-Bills | MUST | |
| REQ-F-004 | System shall support Interest Rate Derivatives: IRS, FRA, OIS, Caps, Floors | MUST | |
| REQ-F-005 | System shall support Repo / Reverse Repo / Securities Lending | MUST | |
| REQ-F-006 | System shall support Equity instruments: Stocks, ETFs, Equity Derivatives | SHOULD | |
| REQ-F-007 | System shall support Commodity derivatives (FX-settled) | SHOULD | |
| REQ-F-008 | System shall support Islamic Finance instruments (Murabaha, Ijara, Wakala) | SHOULD | |
| REQ-F-009 | System shall provide real-time streaming market data connectivity to Bloomberg and LSEG | MUST | |
| REQ-F-010 | System shall execute pre-deal limit checks in <200ms | MUST | |
| REQ-F-011 | System shall provide real-time P&L per trade, per desk, per book | MUST | |
| REQ-F-012 | System shall provide FX eDealing portal with rate streaming to clients | MUST | |
| REQ-F-013 | System shall support trade amendment, cancellation, and novation workflows | MUST | |
| REQ-F-014 | System shall support order management for fixed income | SHOULD | |
| REQ-F-015 | System shall provide trade blotter with real-time filtering and search | MUST | |

### 7.2 Treasury & ALM

| ID | Requirement | Priority | Notes |
|----|-------------|----------|-------|
| REQ-T-001 | System shall provide real-time Nostro account monitoring across all currencies | MUST | |
| REQ-T-002 | System shall generate cash flow ladder (1-day to 10Y+) from all positions | MUST | |
| REQ-T-003 | System shall compute LCR and NSFR ratios in real time | MUST | |
| REQ-T-004 | System shall support behavioral assumption modeling for NMDs and retail deposits | MUST | |
| REQ-T-005 | System shall provide Liquidity Gap (contractual, behavioral, stressed) | MUST | |
| REQ-T-006 | System shall provide Interest Rate Gap (repricing and maturity) | MUST | |
| REQ-T-007 | System shall calculate IRRBB metrics: NII sensitivity, EVE | MUST | BCBS 368 |
| REQ-T-008 | System shall support parallel shock, short rate shock, and flattener scenarios for IRRBB | MUST | |
| REQ-T-009 | System shall support Funds Transfer Pricing (FTP) with configurable curves | MUST | |
| REQ-T-010 | System shall support Balance Sheet Management with hedging recommendations | SHOULD | |
| REQ-T-011 | System shall support market data stress testing (historical scenarios, hypothetical) | MUST | |
| REQ-T-012 | System shall integrate banking book positions (loans, NMDs, FX) into ALM calculations | MUST | |

### 7.3 Risk Management

| ID | Requirement | Priority | Notes |
|----|-------------|----------|-------|
| REQ-R-001 | System shall compute intraday VaR using historical simulation (1-day, 10-day, 99%) | MUST | |
| REQ-R-002 | System shall compute Stressed VaR using Basel III stressed period | MUST | |
| REQ-R-003 | System shall compute FRTB Standardised Approach (SA) capital requirements | MUST | |
| REQ-R-004 | System shall support hierarchical limit management (entity, desk, trader, counterparty) | MUST | |
| REQ-R-005 | System shall send real-time limit breach alerts via dashboard, email, and webhook | MUST | |
| REQ-R-006 | System shall compute CVA, DVA, FVA (XVA) for OTC derivatives | MUST | |
| REQ-R-007 | System shall compute PFE profiles for counterparty credit risk | MUST | |
| REQ-R-008 | System shall provide Greeks dashboard (Delta, Gamma, Vega, Theta, Rho) | MUST | |
| REQ-R-009 | System shall support credit ratings integration (S&P, Moody's, Fitch) | SHOULD | |

### 7.4 Back Office

| ID | Requirement | Priority | Notes |
|----|-------------|----------|-------|
| REQ-B-001 | System shall support SWIFT MT/MX confirmation generation and parsing | MUST | |
| REQ-B-002 | System shall auto-match confirmations with tolerance parameters | MUST | |
| REQ-B-003 | System shall generate SWIFT MT202/MT210/MT103/MT540-543 settlement messages | MUST | |
| REQ-B-004 | System shall perform intraday and EOD Nostro reconciliation | MUST | |
| REQ-B-005 | System shall manage SSIs (Standing Settlement Instructions) | MUST | |
| REQ-B-006 | System shall support collateral management: ISDA CSA, GMRA, GMSLA | MUST | |
| REQ-B-007 | System shall support corporate actions (coupon, maturity, dividend) | MUST | |
| REQ-B-008 | System shall manage trade lifecycle: fixing, exercise, expiry, roll | MUST | |
| REQ-B-009 | System shall provide STP rate calculation and monitoring | MUST | |
| REQ-B-010 | System shall support custody activity (securities delivery messaging) | MUST | |

### 7.5 Accounting

| ID | Requirement | Priority | Notes |
|----|-------------|----------|-------|
| REQ-A-001 | System shall classify instruments per IFRS9: AMC, FVOCI, FVPL | MUST | |
| REQ-A-002 | System shall compute IFRS9 impairment (ECL) Stage 1, 2, 3 | MUST | |
| REQ-A-003 | System shall support fair value and amortised cost measurement | MUST | |
| REQ-A-004 | System shall support hedge accounting (fair value, cash flow, net investment) | MUST | |
| REQ-A-005 | System shall produce multi-currency accounting entries (trade CCY and base CCY) | MUST | |
| REQ-A-006 | System shall support multi-entity and multi-GAAP book structure | MUST | |
| REQ-A-007 | System shall produce GL feed in configurable format (journal entries) | MUST | |
| REQ-A-008 | System shall support P&L attribution (FIFO, LIFO, WAC) | MUST | |
| REQ-A-009 | System shall manage accruals, amortization, and discount/premium | MUST | |

### 7.6 Platform & Security

| ID | Requirement | Priority | Notes |
|----|-------------|----------|-------|
| REQ-P-001 | System shall enforce RBAC with minimum 50 configurable roles | MUST | |
| REQ-P-002 | System shall authenticate via OAuth2/OIDC with MFA support | MUST | |
| REQ-P-003 | System shall produce tamper-evident audit logs for all user and system actions | MUST | |
| REQ-P-004 | System shall encrypt all data at rest using AES-256 | MUST | |
| REQ-P-005 | System shall encrypt all data in transit using TLS 1.3 | MUST | |
| REQ-P-006 | System shall integrate with Vault for secrets management | MUST | |
| REQ-P-007 | System shall scan container images for CVEs in CI/CD pipeline | MUST | |
| REQ-P-008 | System shall automatically apply security patches within 24 hours of critical CVE | MUST | |
| REQ-P-009 | System shall support multi-tenancy with strict data isolation | MUST | |
| REQ-P-010 | System shall support SOC 2 Type II audit evidence collection | MUST | |

---

## 8. Non-Functional Requirements

| ID | Category | Requirement | Priority |
|----|----------|-------------|----------|
| NFR-001 | Performance | Trade booking P99 latency < 100ms | MUST |
| NFR-002 | Performance | Risk recalculation P99 < 5 seconds for full book | MUST |
| NFR-003 | Performance | Dashboard load time < 2 seconds for P95 | MUST |
| NFR-004 | Scalability | Support 500+ concurrent dealer sessions | MUST |
| NFR-005 | Scalability | Horizontal scaling via Kubernetes HPA | MUST |
| NFR-006 | Availability | 99.99% uptime (< 52 min/year downtime) | MUST |
| NFR-007 | Availability | Zero-downtime rolling deployments | MUST |
| NFR-008 | Reliability | Kafka event replication factor ≥ 3 | MUST |
| NFR-009 | Reliability | PostgreSQL active-active replication | MUST |
| NFR-010 | Security | SOC 2 Type II certified | MUST |
| NFR-011 | Security | ISO 27001 aligned controls | MUST |
| NFR-012 | Security | OWASP Top 10 mitigated | MUST |
| NFR-013 | Security | Automated CVE patching within 24h (Critical) | MUST |
| NFR-014 | Compliance | FRTB SA/IMA, IRRBB, LCR, NSFR, IFRS9 | MUST |
| NFR-015 | Compliance | SWIFT messaging standards (MT/MX) | MUST |
| NFR-016 | Observability | Full distributed tracing (OpenTelemetry) | MUST |
| NFR-017 | Observability | Centralised structured logging (ELK) | MUST |
| NFR-018 | Observability | Real-time metrics dashboards (Grafana) | MUST |
| NFR-019 | Maintainability | Code coverage ≥ 80% (unit + integration) | MUST |
| NFR-020 | Portability | Deploy on any Kubernetes-compatible cloud | MUST |
| NFR-021 | Interoperability | OpenAPI 3.0 for all external APIs | MUST |
| NFR-022 | Data | Data retention: 10 years (regulatory) | MUST |
| NFR-023 | Accessibility | WCAG 2.1 AA compliance | SHOULD |
| NFR-024 | Internationalisation | Multi-language support (EN, FR, AR, ES) | SHOULD |

---

## 9. UX & Design Requirements

### 9.1 Design System

- **Framework**: React + Next.js with Tailwind CSS
- **Component Library**: Radix UI primitives with custom NexusTreasury design tokens
- **Charts**: Recharts + D3.js for financial time series
- **Real-time Updates**: WebSocket connections for live P&L, rates, and positions
- **Theme**: Professional dark/light mode with high-contrast accessibility mode

### 9.2 Key Interaction Patterns

- **Trade Entry**: Keyboard-first design for dealing room workflows; tab order mirrors trading ticket conventions
- **Dashboards**: Configurable widget grid (drag-and-drop); each desk role has a default layout
- **Alerts**: Non-blocking toast notifications for soft alerts; modal dialogs for limit breaches requiring action
- **Drill-down**: Every summary number is clickable to see contributing positions/trades
- **Export**: Every data view exportable to Excel (.xlsx) and PDF

### 9.3 Responsive Design

- Primary: 1920×1080 and 2560×1440 dealing room screens
- Secondary: 1366×768 laptop (management dashboards)
- Tertiary: iPad (approvals and monitoring only)

---

## 10. Dependencies & Integrations

| System | Type | Protocol | Direction | Priority |
|--------|------|----------|-----------|----------|
| Bloomberg B-PIPE | Market Data | API/TCP | Inbound | MUST |
| LSEG (Refinitiv) | Market Data | API | Inbound | MUST |
| Temenos T24 | Core Banking | REST API / Calypso Data Uploader equivalent | Bidirectional | MUST |
| Oracle Flexcube | Core Banking | REST API | Bidirectional | MUST |
| SWIFT Alliance | Messaging | SWIFT MT/MX | Bidirectional | MUST |
| CLS Bank | FX Settlement | REST/SWIFT | Bidirectional | MUST |
| LCH.Clearnet | Clearing | FIX/API | Bidirectional | MUST |
| DTCC | Clearing/Repository | API | Bidirectional | MUST |
| HashiCorp Vault | Secrets Management | REST API | Internal | MUST |
| GitHub Actions | CI/CD | Webhook/API | Internal | MUST |
| Grafana | Monitoring | Prometheus API | Internal | MUST |
| ELK Stack | Log Management | Logstash/Beats | Internal | MUST |
| Keycloak (OIDC) | Identity Provider | OAuth2/OIDC | Internal | MUST |
| Bloomberg TSOX | eTrading | FIX | Bidirectional | SHOULD |
| Tradeweb | eTrading | FIX | Bidirectional | SHOULD |
| 360T | FX eTrading | FIX | Bidirectional | SHOULD |

---

## 11. Assumptions & Constraints

### Assumptions

- Banks have existing SWIFT connectivity (BIC, SWIFTNet access)
- Core banking system has a stable API layer for balance/position feeds
- Initial deployment targets banks with ≥ 50 treasury professionals
- Kubernetes cluster with minimum 3 control plane nodes and 12 worker nodes is provisioned
- PostgreSQL 16+ with Citus or Patroni HA configuration

### Constraints

- Must comply with local banking regulations (Basel III/IV, FRTB, IRRBB)
- SWIFT message formats must conform to SWIFT standards 2024
- Data residency: support for EU, US, GCC, and African regional data residency
- Export control: no re-export of cryptographic software to sanctioned countries

---

## 12. Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|-----------|
| Market data API rate limits | Medium | High | Multi-vendor fallback; local caching with Redis |
| SWIFT certification delays | Low | High | Early engagement with SWIFT; test on SWIFT SIL |
| Kafka message ordering issues | Medium | High | Partition by entity ID; idempotent consumers |
| Database performance under load | Medium | High | Connection pooling (PgBouncer); read replicas; query optimisation |
| Regulatory change (FRTB timeline) | High | Medium | Configurable regulatory parameter sets; modular compliance engines |
| Key person dependency | Low | High | Pair programming; knowledge base; cross-training |
| Vendor API breaking changes (Bloomberg) | Medium | Medium | API versioning; adapter pattern; contract tests |
| CVE in base container image | High | High | Automated Trivy scanning; automated patch pipeline |

---

## 13. Open Questions

| # | Question | Owner | Due |
|---|----------|-------|-----|
| OQ-001 | Which banks will pilot the MVP? (Target 2 banks for beta) | Sales | 2026-05-01 |
| OQ-002 | Regulatory: Is FRTB IMA required in v1.0 or deferred? | Risk/Compliance | 2026-04-15 |
| OQ-003 | Which cloud providers will be supported at GA? (AWS, Azure, GCP, on-prem) | Architecture | 2026-04-15 |
| OQ-004 | Islamic Finance: Which jurisdictions in scope (GCC, Malaysia)? | Product | 2026-05-01 |
| OQ-005 | Multi-tenancy: SaaS model or single-tenant per bank? | Product/Sales | 2026-05-01 |

---

## 14. Appendix & References

- Moorad Choudhry, *The Principles of Banking*, 2nd Ed. — ALM, Treasury, and Risk frameworks
- BCBS 368: *Interest Rate Risk in the Banking Book (IRRBB)* standards
- BCBS 457: *Fundamental Review of the Trading Book (FRTB)*
- Basel III LCR standard (BCBS 238)
- IFRS 9 Financial Instruments (IASB 2014)
- SWIFT MT Standards Release Guide 2024
- SOC 2 Trust Services Criteria (AICPA)
- NIST Cybersecurity Framework 2.0
- Nasdaq Calypso Treasury Solution product materials (April 2026) — competitive reference
- OWASP Top 10:2021 Web Application Security Risks

---

*End of Product Requirements Document — NexusTreasury v1.0.0*

---

## Sprint Delivery Appendix — Sprints 9–12 (v1.1.0 → v1.6.0)

*This appendix documents features delivered post-initial release, enriching the original PRD.*

### Sprint 9 — Islamic Finance & Advanced Pricing (v1.1.0–v1.2.0)

| User Story | Feature | Status |
|---|---|---|
| US-ISLAMIC-001 | Murabaha, Ijara, Wakala, Diminishing Musharakah instrument capture | ✅ Delivered |
| US-ISLAMIC-002 | Shariah-compliant profit rate scheduling (no interest) | ✅ Delivered |
| US-ISLAMIC-003 | Sukuk (Ijara, Murabaha) pricing with capital charge | ✅ Delivered |
| US-EXOTIC-001 | Barrier options (knock-in/knock-out, rebate) with Monte Carlo | ✅ Delivered |
| US-EXOTIC-002 | Asian options (arithmetic/geometric average) pricing | ✅ Delivered |
| US-EXOTIC-003 | Lookback options (fixed/floating strike) pricing | ✅ Delivered |
| US-EXOTIC-004 | WASM-accelerated exotic pricing pool (4 workers, fallback to TS) | ✅ Delivered |

### Sprint 10 — Capital Stress, FX Hedging & Regulatory Engines (v1.3.0–v1.4.0)

| User Story | Feature | Status |
|---|---|---|
| US-CAP-001 | EBA ICAAP capital stress testing (5 scenarios: baseline, mild, moderate, severe, extreme) | ✅ Delivered |
| US-CAP-002 | Capital survival horizon and Capital Funding Plan (CFP) trigger | ✅ Delivered |
| US-FX-001 | FX e-portal deal pricing with spread lock | ✅ Delivered |
| US-FX-002 | FX auto-hedge (static, dynamic, rolling, selective strategies) | ✅ Delivered |
| US-REG-001 | COREP CRR III Credit SA + FRTB SA + OpRisk SMA + buffer computation | ✅ Delivered |
| US-REG-002 | FINREP balance sheet, P&L, NPL ratio, ROA/ROE, EBA taxonomy v3.3 | ✅ Delivered |
| US-REG-003 | SWIFT ISO 20022 migration: MT103→pacs.008, MT202→pacs.009, CBPR+ dual-run | ✅ Delivered |
| US-REG-004 | Regulatory submission engine with EBA/CBUTT/BOG/CBN lifecycle tracking | ✅ Delivered |

### Sprint 11 — AI Treasury Assistant, Report Builder & SSE Streaming (v1.5.0)

| User Story | Feature | Status |
|---|---|---|
| US-AI-001 | Claude-powered AI Treasury Assistant with 8 query categories (FX, IRRBB, LCR/NSFR, CET1, limits, trade blotter, profitability, general) | ✅ Delivered |
| US-AI-002 | RAG pipeline with tenant TreasuryDataContext injection | ✅ Delivered |
| US-AI-003 | PII redaction (IBAN, BIC patterns) before API call | ✅ Delivered |
| US-AI-004 | Rule-based fallback when Anthropic API is unavailable | ✅ Delivered |
| US-RPT-001 | Report Builder with 8 templates and 7 dimensions (product/currency/book/entity/counterparty/time/regulatory) | ✅ Delivered |
| US-RPT-002 | Scheduled report delivery and run history | ✅ Delivered |
| US-SSE-001 | Server-Sent Events (RFC 8895) real-time fan-out for limit breaches, LCR alerts, position moves | ✅ Delivered |
| US-SSE-002 | Tenant-isolated SSE streams with 5 event types | ✅ Delivered |

### Sprint 12 — Enterprise Hardening (v1.6.0)

| User Story | Feature | Status |
|---|---|---|
| US-ML-001 | XGBoost PD model with Basel II TTC recalibration (3-stage: logit + XGBoost + Platt scaling) | ✅ Delivered |
| US-INFRA-001 | PostgreSQL repositories for BudgetRepository, ReportDefinitionRepository, ReportRunRepository, SubmissionRepository | ✅ Delivered |
| US-OPS-001 | DisasterRecoveryOrchestrator with 3-consecutive-failure auto-failover, RTO ≤ 15min | ✅ Delivered |
| US-OPS-002 | SecretRotationManager: zero-downtime JWT dual-validation (30min window) | ✅ Delivered |
| US-OPS-003 | FinOpsCostTracker: per-tenant CPU/memory/storage/network cost model | ✅ Delivered |
| US-GOV-001 | SOC2EvidenceCollector: 5 Trust Criteria (CC1/CC6/CC7/CC8/CC9), Drata/Vanta integration | ✅ Delivered |
| US-SRE-001 | Site Resilience Design document (17 sections, SLOs, circuit breakers, multi-region) | ✅ Delivered |
| US-SRE-002 | Chaos Engineering programme (Chaos Mesh, 18 experiments, GameDay programme) | ✅ Delivered |

### Updated Feature Scope Summary (v1.6.0)

| Domain | Calypso Equivalent | NexusTreasury v1.6 | Gap |
|---|---|---|---|
| Capital Stress Testing | ✅ | ✅ (EBA ICAAP 5-scenario) | None |
| FX Client Portal | ✅ | ✅ (spread lock + 4 hedge strategies) | None |
| Regulatory Reporting (COREP/FINREP) | ✅ | ✅ (CRR III + EBA taxonomy v3.3) | None |
| Islamic Finance | ⚠️ Limited | ✅ (4 instruments + Sukuk pricing) | Ahead |
| AI-Powered Analytics | ❌ | ✅ (Claude-powered assistant) | Ahead |
| SWIFT ISO 20022 | ✅ | ✅ (dual-run MT/MX) | None |
| Financial Planning | ✅ | ✅ (budget engine, scenarios, FTP) | None |
| Disaster Recovery Automation | ✅ | ✅ (auto-failover, RTO ≤ 15min) | None |
| Chaos Engineering | ❌ | ✅ (18 experiments, GameDay) | Ahead |

---
*Document version updated: v1.6.0 — April 2026*
