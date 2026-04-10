# NexusTreasury — Sprints 8–11 Summary

## What was built

### Sprint 8 — Market Data & AI/ML (v1.2.0)

| Deliverable | Where |
|---|---|
| Bloomberg B-PIPE adapter with circuit breaker + adaptive failover | `market-data-service/infrastructure/` |
| XGBoost PD model with SHAP explainability (9 features) | `accounting-service/application/` |
| KS-test model drift detector (STABLE/WARNING/ALERT/CRITICAL) | `accounting-service/application/` |
| FinBERT break classifier with SWIFT gpi UETR enrichment | `bo-service/application/reconciliation/` |
| SVI volatility surface (Gatheral 2004) with calendar-AF check | `domain/pricing/` |
| Vanna-Volga FX exotic pricer (Castagna-Mercurio 2007) | `domain/pricing/` |

### Sprint 9 — Islamic Finance + Financial Planning + RAROC (v1.3.0)

| Deliverable | FIS Gap Closed |
|---|---|
| SukukPricer — Ijara + Murabaha, AAOIFI FAS 28, IFSB-7 risk weights | — |
| MurabahaLifecycleEngine — LME commodity, Tawarruq, AAOIFI SS-30 | — |
| IslamicIFRS9Extension — DPP-based staging, AAOIFI/IFRS9 convergence | — |
| BudgetEngine — annual plans, re-forecasts, mismatch centre, FTP | FIS BSM "Finance & Forecasting" 2/9 → 8/9 |
| RAROCEngine — 5-dimension profitability, EVA bps, hurdle rate | FIS BSM "Profitability Analysis" 2/9 → 8/9 |

### Sprint 10 — Capital, FX Hedging, COREP/FINREP, SWIFT ISO 20022 (v1.4.0)

| Deliverable | FIS Gap Closed |
|---|---|
| CapitalStressTester — 5 EBA scenarios, survival horizon, CFP trigger | FIS BSM "Capital Stress Testing" 3/8 → 9/8 |
| FXAutoHedger — portal deal pricing, spread lock, auto-hedge strategies | FIS Global FX Portal 4/9 → 8/9 |
| COREPEngine — Credit SA + FRTB SA + Op Risk SMA, XBRL C 01.00 | COREP regulatory gap |
| FINREPEngine — balance sheet, P&L, NPL ratio, EBA taxonomy v3.3 | FINREP regulatory gap |
| SWIFTISO20022Migrator — MT103→pacs.008, MT202→pacs.009, CBPR+, dual-run | SWIFT migration |
| RegulatorySubmissionEngine — CBUTT, BOG, CBN_MONTHLY, EBA lifecycle | Caribbean regulatory coverage |

### Sprint 11 — AI & Self-Service Analytics (v1.5.0)

| Deliverable | Capability |
|---|---|
| TreasuryAIAssistant | Claude claude-sonnet-4-20250514 RAG pipeline, 8 query categories, PII redaction, graceful fallback |
| ReportBuilder | 8 templates, 7 dimensions, schedule/delivery, run history |
| SSEStreamPublisher | Tenant-isolated SSE fan-out, 5 event types, heartbeat, event log |

---

## Test count history

| Version | Tests | New in sprint |
|---|---|---|
| v1.0.0 | 504 | baseline |
| v1.1.0 | 630 | +126 (Sprint 7: exotic pricer, Pact, k6) |
| v1.2.0 | 633 | +3 (Sprint 8: AI/ML, vol surface) |
| v1.3.0 | 728 | +95 (Sprint 9: Islamic, budget, RAROC) |
| v1.4.0 | 791 | +63 (Sprint 10: stress, hedge, COREP, SWIFT) |
| v1.5.0 | **819** | +28 (Sprint 11: AI, reports, SSE) |

---

## Documentation added in Sprints 8-11

- `docs/architecture/c4/03-components-sprint8.md` — Bloomberg, XGBoost, BERT, SVI
- `docs/architecture/c4/03-components-sprint9-10.md` — Sukuk, Budget, RAROC, Capital Stress, FX Hedge, COREP
- `docs/architecture/c4/03-components-sprint11.md` — AI Assistant, Report Builder, SSE
- `docs/learner/09-Islamic-Finance.md` — Ijara, Murabaha, IFRS9 staging
- `docs/learner/10-Capital-and-RAROC.md` — Basel III, stress testing, RAROC
- `docs/learner/11-Financial-Planning.md` — Budget lifecycle, FTP, mismatch centre
- `docs/learner/12-AI-Treasury-Assistant.md` — RAG pipeline, report builder, SSE
- `docs/onboarding/` — 6-module SE onboarding guide (days 1–5 + checklist)
