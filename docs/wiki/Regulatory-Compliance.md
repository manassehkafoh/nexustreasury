# Regulatory Compliance Guide

NexusTreasury is built to support compliance with the key banking regulations
that apply to treasury operations. This document maps each regulation to the
platform features that implement or support it.

---

## Regulatory Coverage Matrix

| Regulation                | Issued by           | Area          | NexusTreasury Support                         | Status         |
| ------------------------- | ------------------- | ------------- | --------------------------------------------- | -------------- |
| Basel III LCR (BCBS 238)  | Basel Committee     | Liquidity     | LCR calculation, HQLA haircuts, breach alerts | ✅ Full        |
| Basel III NSFR (BCBS 295) | Basel Committee     | Liquidity     | NSFR calculation, ASF/RSF modelling           | ✅ Full        |
| IRRBB (BCBS 368)          | Basel Committee     | Interest Rate | Gap analysis across time buckets              | ✅ Partial     |
| FRTB SA (Basel IV)        | Basel Committee     | Market Risk   | Asset class classification, VaR               | 🔧 In Progress |
| EMIR                      | European Commission | Derivatives   | Trade capture, counterparty data              | ✅ Partial     |
| Dodd-Frank                | US Congress         | Derivatives   | Equivalent to EMIR for US                     | ✅ Partial     |
| IFRS 9                    | IASB                | Accounting    | Fair value, classification                    | 🔧 Planned     |
| SOC 2 Type II             | AICPA               | Security      | Automated CVE patching, audit trails          | ✅ Full        |
| AML/KYC                   | FATF / local        | Compliance    | Counterparty data model                       | 🔧 Planned     |

---

## Basel III Liquidity Standards

### LCR (Liquidity Coverage Ratio) — BCBS 238

**Requirement:** Banks must hold enough HQLA to cover net stress outflows for 30 days.

**NexusTreasury implementation:**

```
LCR = Stock of HQLA / Total net cash outflows over 30 calendar days × 100%

HQLA = Level 1 (0% haircut)
     + Level 2A (15% haircut, capped at 40% of total HQLA)
     + Level 2B (25%–50% haircut, capped at 15% of total HQLA)

Total net cash outflows = Outflows × stress weights – min(Inflows × weights, 75% of outflows)
```

**Where in the code:**

- `packages/domain/src/alm/liquidity-gap.aggregate.ts` — LCR calculation logic
- `packages/alm-service/src/application/lcr-calculator.ts` — HQLA haircut application
- `infra/monitoring/alerts/nexustreasury.rules.yaml` — `LCRBelowMinimum` and `LCRApproachingThreshold` alerts

**Minimum threshold:** 100% (phased in from 2015, fully effective 2019)
**Alert thresholds:** < 110% warning, < 100% critical breach

---

### NSFR (Net Stable Funding Ratio) — BCBS 295

**Requirement:** Banks must maintain a stable funding profile to reduce funding risk.

**NexusTreasury implementation:**

```
NSFR = Available Stable Funding (ASF) / Required Stable Funding (RSF) × 100%

ASF weights by funding type:
  Tier 1 capital: 100%
  Stable retail deposits (< 1 year): 95%
  Less stable retail deposits: 90%
  Wholesale funding (≥ 1 year): 100%

RSF weights by asset type:
  Level 1 HQLA (unencumbered): 0%
  Level 2A HQLA: 15%
  Loans to non-financials (< 1 year): 50%
  Loans to non-financials (≥ 1 year): 85%
  Other assets: 100%
```

**Minimum threshold:** 100%

---

### IRRBB — Interest Rate Risk in the Banking Book (BCBS 368)

**Requirement:** Banks must measure and manage interest rate risk in their banking book.

**NexusTreasury support:**
The liquidity gap report's time bucket analysis provides the cash flow re-pricing
schedule required for IRRBB gap analysis. The standard interest rate shock scenarios
(+/-200bps parallel shift, steepener, flattener) can be modelled via the
`STRESSED_30D` and `STRESSED_90D` ALM scenarios.

**Gap in current implementation:** The Economic Value of Equity (EVE) and
Net Interest Income (NII) sensitivity metrics are planned for a future release.

---

## FRTB — Fundamental Review of the Trading Book (Basel IV)

**Requirement:** Banks must calculate market risk capital under the new standardised
approach (SA-TB) or internal models approach (IMA).

**NexusTreasury support:**

- Trade capture with asset class classification (required for SA-TB sensitivity calculations)
- VaR calculation (foundational for IMA)
- Position keeping (required for sensitivity calculations)

**Gap:** The SA-TB sensitivity-based method (delta, vega, curvature RWA) is planned.
The current VaR implementation provides the IMA framework foundation.

---

## EMIR and Dodd-Frank (OTC Derivatives)

**Requirement:** OTC derivatives must be reported to trade repositories,
and certain instruments must be centrally cleared.

**NexusTreasury support:**

- Trade capture stores all required counterparty and instrument identifiers
- LEI (Legal Entity Identifier) can be stored in the `counterpartyId` field
- UTI (Unique Trade Identifier) maps to the trade `reference` field

**Gap:** Direct reporting to DTCC/Regis-TR is not yet implemented.
Currently, trades can be exported and submitted manually.

---

## SOC 2 Type II — Security and Availability

**NexusTreasury evidence chain:**

| Control                          | Implementation                                         | Evidence                   |
| -------------------------------- | ------------------------------------------------------ | -------------------------- |
| CC6.8 — Vulnerability Management | `security-patch.yml` auto-patches CVEs within 24 hours | GitHub Actions run history |
| CC6.6 — Logical Access           | JWT + Keycloak OIDC for all access                     | Keycloak audit logs        |
| CC6.7 — Transmission Encryption  | All traffic over TLS 1.3 in production                 | Nginx/ingress config       |
| CC7.2 — System Monitoring        | Prometheus + Grafana with alert rules                  | Grafana dashboards         |
| CC9.2 — Incident Response        | Runbooks + PagerDuty integration                       | Runbook documentation      |
| A1.2 — Availability              | HPA 3–20 replicas + readiness probes                   | Kubernetes HPA config      |

---

## Audit Trail

Every state change in NexusTreasury is logged to the event outbox tables:

- `trading.trade_events` — full history of every trade state change
- `position.position_events` — every position update
- Structured JSON logs (Pino) → Elasticsearch → 7-year retention (SOC 2)
- Kafka event history — 7-day replay window

These provide evidence for:

- Trade dispute resolution
- Regulatory examinations
- Internal audit reviews
- SOC 2 Type II audits
