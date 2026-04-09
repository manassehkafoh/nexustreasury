# NexusTreasury Roadmap

**Current**: v1.0.0 — QA Score 9.8/10  
**Horizon**: Sprints 7–12 (Q2–Q4 2026)

---

## Sprint 7 — Performance, Contract Tests, Active-Active (6 weeks)

### 7.1 k6 Performance Test Suite
**Goal**: Validate 500 TPS at P99 < 100ms under sustained load.

```bash
# Run performance tests
k6 run tests/performance/trade-booking.k6.js --vus 50 --duration 5m
```

Scenarios:
- Trade booking under 500 TPS (50 VUs × 10 RPS)
- Pre-deal check at 1,000 TPS (P99 SLA: 5ms)
- VaR calculation under 100 concurrent EOD requests
- Nostro reconciliation with 10,000-entry statements

### 7.2 Pact Contract Tests
**Goal**: Prevent breaking changes between services at the Kafka event boundary.

Consumers verified:
- `position-service` consuming `nexus.trading.trades.booked`
- `accounting-service` consuming `nexus.trading.trades.booked`
- `collateral-service` consuming `nexus.risk.var-result`
- `notification-service` consuming `nexus.risk.limit-breach`

### 7.3 Multi-Region Active-Active Deployment
**Goal**: RPO < 1 minute, RTO < 5 minutes for primary region failure.

Architecture:
- Primary: AWS eu-west-1 (London) — London/EMEA trading hours
- Secondary: AWS us-east-1 (N. Virginia) — NY/Americas trading hours
- Conflict resolution: Last-write-wins per trade (idempotency key)
- Kafka MirrorMaker 2 for cross-region topic replication
- Route53 latency-based routing with health checks

### 7.4 QuantLib WASM Injectable Pricer (ADR-008 follow-up)
**Goal**: Support exotic instruments (barrier options, look-back, Bermudan swaptions).

Implementation:
- Compile QuantLib to WASM via Emscripten
- Wrap in `IExoticPricer` interface (injectable per ADR-008 pattern)
- Warm-up pool: 4 WASM instances per worker → eliminates cold-start penalty
- Fallback: custom TS pricer for vanilla instruments (maintains P99 < 5ms)

---

## Sprint 8 — Market Data & AI/ML (6 weeks)

### 8.1 Bloomberg B-PIPE Real-Time Integration
Replace polling adapter with subscription-based B-PIPE feed:
- `market-data-service` subscribes to `//blp/mktdata` service
- Price updates published to `nexus.market.rates-updated` within 50ms of tick
- Failover to LSEG RDP if Bloomberg circuit breaker opens

### 8.2 AI/ML ECL Enhancement
Wire production ML models into injectable PD interface:
- XGBoost PD model trained on sovereign + corporate loan portfolios
- Model served via TorchServe (GPU cluster, latency P99 < 20ms)
- SHAP explainability for each ECL calculation (regulatory requirement)
- Drift detection: alert if PD distribution shifts >15% from training baseline

### 8.3 AI-Powered Reconciliation Break Resolution
Upgrade `InMemoryBreakClassifier` to production ML model:
- Fine-tuned BERT on 50,000 historical break patterns
- Confidence score threshold: auto-resolve if >0.92, queue for human if <0.92
- Integration with SWIFT gpi for real-time counterparty instruction tracking

### 8.4 FX Options Volatility Surface
Extend FX pricing with full volatility surface support:
- ATM + RR + BF smile interpolation (SVI model)
- Real-time surface calibration from Bloomberg vol ticks
- Vanna-Volga pricing for barrier options and structured products

---

## Sprint 9 — Islamic Finance Deepening (4 weeks)

### 9.1 Sukuk Pricing Engine
- Cash flow modelling for Ijara and Murabaha Sukuk
- Sharia-compliant yield calculation (no `riskFreeRate` parameter)
- AAOIFI and IFSB regulatory report output

### 9.2 Commodity Murabaha Lifecycle
- LME metal price integration for commodity murabaha pricing
- Tawarruq (reverse murabaha) cash flow calculation
- Profit rate vs. benchmark comparison reporting

### 9.3 Islamic Finance IFRS9 Extension
- Murabaha classified under amortised cost with profit recognition
- Diminishing Musharaka treatment (equity-like ECL)
- Specific provisioning for non-performing Islamic assets

---

## Sprint 10 — Regulatory Reporting Automation (6 weeks)

### 10.1 COREP Capital Adequacy (CRD V / CRR III)
- Template-driven XBRL output for EBA COREP
- Pillar 1 minimum capital: Credit Risk (SA) + Market Risk (FRTB) + Op Risk (SMA)
- Countercyclical buffer and G-SIB surcharge calculation

### 10.2 FINREP Financial Reporting
- Balance sheet and P&L automation from IFRS9 journals
- Regulatory consolidation across multiple legal entities
- EBA filing taxonomy v3.3

### 10.3 SWIFT ISO 20022 Migration
- MT-to-MX migration: MT202 → MX pacs.009, MT103 → MX pacs.008
- CBPR+ compliant message enrichment (LEI, purpose code)
- Dual-run mode during SWIFT transition period

### 10.4 Automated Regulatory Submission
- FCA Gabriel / PRA XBRL filing automation
- CBUTT (Central Bank of T&T) ALMA reporting for Caribbean markets
- Submission status tracking and acknowledgement handling

---

## Sprint 11 — Advanced Analytics & Self-Service (6 weeks)

### 11.1 AI Treasury Insights Assistant
Natural-language query interface for treasury analytics:
- "What is our EUR/USD FX exposure vs last month?"
- "Which counterparties are approaching their credit limits?"
- "Show me the IRRBB scenario most sensitive to our NMD assumptions"

Powered by:
- RAG pipeline over trade/position/limit data
- Claude claude-sonnet-4-20250514 as inference model
- Guardrails: PII redaction, tenant isolation, no model training on customer data

### 11.2 Self-Service Report Builder
Drag-and-drop report designer for non-technical treasury staff:
- Pre-built templates: Blotter, P&L, Position, LCR, IRRBB, Collateral
- Custom dimensions: asset class, book, trader, counterparty, currency
- Scheduled delivery: email PDF at 08:00 daily

### 11.3 Real-Time Dashboard Streaming
Upgrade from polling to WebSocket SSE:
- Kafka → Server-Sent Events pipeline via `notification-service`
- React live blotter: position MTM updates every 500ms
- Limit headroom gauge: real-time utilisation bar

---

## Sprint 12 — Enterprise Hardening (6 weeks)

### 12.1 Disaster Recovery Runbook Automation
- Automated failover with PagerDuty + Runbook automation
- Quarterly DR test: automated simulation of primary region failure
- RTO/RPO measurement: auto-fail if SLA missed

### 12.2 Advanced Secret Rotation
- Zero-downtime JWT secret rotation (dual-validation window)
- Automated AUDIT_HMAC_KEY quarterly rotation with re-signing
- Database credential rotation via Vault dynamic secrets

### 12.3 FinOps Cost Visibility
- Per-tenant cost allocation via Kubernetes namespace + label propagation
- OpenCost integration: CPU/memory/storage cost per service
- Monthly cost report: CSV export per tenant for billing

### 12.4 SOC 2 Type II Audit Preparation
- Evidence collection automation: Drata / Vanta integration
- Policy-as-code: OPA Gatekeeper for Kubernetes admission control
- Penetration test: external red team engagement

---

## Versioning

NexusTreasury follows [Semantic Versioning](https://semver.org/):

| Version | Target | Description |
|---|---|---|
| v1.0.0 | ✅ April 2026 | Production baseline, 9.8/10 QA, 13 services |
| v1.1.0 | June 2026 | Sprint 7: k6, Pact, multi-region |
| v1.2.0 | August 2026 | Sprint 8: Bloomberg B-PIPE, AI/ML ECL |
| v1.3.0 | October 2026 | Sprint 9-10: Islamic Finance, COREP/FINREP |
| v2.0.0 | Q1 2027 | Sprint 11-12: AI assistant, enterprise hardening |
