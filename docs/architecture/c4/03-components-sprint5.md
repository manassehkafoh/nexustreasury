# C4 Level 3 — Sprint 5: Audit, Notification, FX eDealing & Corporate Actions

> **Sprint**: Sprint 5 | **Last Updated**: 2026-04-09

---

## Audit Service Component Diagram

```mermaid
flowchart TB
  subgraph AUD["audit-service (port 4008)"]
    direction TB

    subgraph DOM["Domain"]
      AR["AuditRecord\n(Value Object)\n\nImmutable once written.\nHMAC-SHA256 checksum:\ncanonical = auditId|tenantId\n|eventId|eventType|entityId\n|userId|occurredAt|payload\n\nTamper detection:\nverifyAuditRecord(rec, key)\n→ false if any field mutated\n\n10-year retention (NFR-022)"]
    end

    subgraph APP["Application"]
      AER["AuditEventRouter\n\nConsumes ALL 13 Kafka topics.\nMaps topic → category:\n  trading.* → TRADE\n  risk.* → RISK\n  bo.* → SETTLEMENT\n  security.* → SECURITY CRITICAL\n\nExtracts actor from headers.\nSigns record with HMAC key\n(from HashiCorp Vault).\nAI hook: AnomalyScorer"]
    end

    subgraph INFRA["Infrastructure"]
      ES["ElasticsearchRepo\n\nAppend-only index.\nNo UPDATE / DELETE.\n10-year retention policy.\nSearch by entityId/userId\n/category/date range.\nSOC 2 evidence export."]
    end
  end

  subgraph KAFKA["Kafka — all topics"]
    K["nexus.trading.* nexus.risk.*\nnexus.bo.* nexus.accounting.*\nnexus.market.* nexus.alm.*\nnexus.security.*"]
  end

  K --> AER --> AR --> ES

  classDef d fill:#1a3a5c,stroke:#4a90d9,color:#e8f4ff
  classDef a fill:#1a4a2a,stroke:#4a9d5a,color:#e8ffe8
  classDef i fill:#4a2a1a,stroke:#9d5a2a,color:#ffe8e0
  class AR d
  class AER a
  class ES i
```

---

## Notification Service Component Diagram

```mermaid
flowchart TB
  subgraph NS["notification-service (port 4009)"]
    direction TB

    NV["NotificationService\n\nRule-based topic matching.\nBuilds message: AI personaliser\nor template fallback.\nDispatches to all matched channels.\nChannelsFailed tracked for retry.\n\nDefault rules:\nlimit-breach → EMAIL+WS+WEBHOOK\nrecon-break → EMAIL+WS\nlcr-breach → EMAIL+WS CRITICAL\nlogin-failed → EMAIL CRITICAL\nanomaly → EMAIL+WEBHOOK CRITICAL"]

    subgraph CH["Channels"]
      EMAIL["EmailChannel\n\nSMTP / AWS SES.\nHigh priority for CRITICAL.\nConfigurable recipients\nper rule."]
      WS["WebSocketChannel\n\nPush to dealer rooms:\n'risk-managers'\n'back-office'\n'alm-dashboard'\nPer-tenant session routing."]
      WH["WebhookChannel\n\nHTTP POST to URL.\nHMAC-SHA256 signature\nfor Slack/Teams/PagerDuty\nverification."]
    end
  end

  subgraph AI["AI/ML"]
    MP["MessagePersonaliser\n\nLLM hook (optional).\nContext-aware alert text.\nExample: 'USD/GBP breach —\n$2.3M above limit. Alex Dealer\nbought $8M in last 2 hours.'\nFalls back to template\non LLM timeout."]
  end

  NV --> EMAIL & WS & WH
  NV -.-> MP

  classDef n fill:#1a3a5c,stroke:#4a90d9,color:#e8f4ff
  classDef c fill:#1a4a2a,stroke:#4a9d5a,color:#e8ffe8
  classDef ai fill:#5c1a5c,stroke:#d94ad9,color:#ffe8ff
  class NV n
  class EMAIL,WS,WH c
  class MP ai
```

---

## FX eDealing Portal — Component & Data Flow

```mermaid
flowchart LR
  subgraph UI["FXDealingTicket (React)"]
    RS["useRateStream(pair)\n\nWebSocket → market-data-service\nAuto-reconnect with back-off.\nBid/Ask/Mid/Spread display.\nRate flash on tick."]
    PD["Pre-deal Headroom\n\nDebounced fetch on notional change.\nPOST /risk/pre-deal-check.\nODA bar: 0→100% utilisation.\nBREACH disables Book button."]
    TK["Dealing Ticket\n\nCurrency pair selector (10 pairs).\nBUY/SELL toggle (keyboard).\nNotional + value date inputs.\nDealer notes field.\nConfirmation dialog.\nTheme: CSS custom properties."]
  end

  subgraph SVC["Services"]
    MDS["market-data-service\n(port 4006)\nWS: ws://localhost:4006\n/api/v1/rates/stream"]
    RKS["risk-service\n(port 4003)\nPOST /api/v1/risk/pre-deal-check"]
    TRS["trade-service\n(port 4001)\nPOST /api/v1/trades"]
  end

  RS -->|"WebSocket subscribe"| MDS
  PD -->|"REST"| RKS
  TK -->|"POST on Confirm"| TRS

  classDef ui fill:#1a3a5c,stroke:#4a90d9,color:#e8f4ff
  classDef svc fill:#1a4a2a,stroke:#4a9d5a,color:#e8ffe8
  class RS,PD,TK ui
  class MDS,RKS,TRS svc
```

---

## Corporate Actions — Lifecycle Event Matrix

| Event                 | Asset Class | Cash Flow                       | SWIFT? | New Status  |
| --------------------- | ----------- | ------------------------------- | ------ | ----------- |
| `COUPON_PAYMENT`      | FI          | notional × rate / freq          | ✅     | —           |
| `PRINCIPAL_REPAYMENT` | FI          | notional + final coupon         | ✅     | `MATURED`   |
| `SWAP_RESET`          | IRS         | (float−fixed) × notional / freq | if >1K | —           |
| `FRA_SETTLEMENT`      | IRS         | net settlement amount           | ✅     | —           |
| `OPTION_EXERCISE`     | FX/IRD      | exercise value                  | ✅     | `EXERCISED` |
| `FX_OPTION_EXPIRY`    | FX          | none                            | ❌     | `EXPIRED`   |
| `NDF_FIXING`          | FX          | TBD at fixing                   | ❌     | —           |
| `REPO_MATURITY`       | Repo        | principal repayment             | ✅     | `MATURED`   |
| `DEPOSIT_MATURITY`    | MM          | principal + accrued interest    | ✅     | `MATURED`   |

---

## HMAC Tamper Evidence — How It Works

```mermaid
sequenceDiagram
  participant K  as Kafka Event
  participant R  as AuditEventRouter
  participant V  as Vault (HMAC Key)
  participant ES as Elasticsearch

  K->>R: raw event payload
  R->>V: fetch HMAC key (cached 5min)
  V-->>R: key
  R->>R: canonical = auditId|tenantId|eventId|...|payload(sorted)
  R->>R: checksum = HMAC-SHA256(key, canonical)
  R->>ES: append(AuditRecord) — immutable
  Note over ES: No UPDATE / DELETE ever permitted
  Note over ES: verifyAuditRecord(rec, key) → false if tampered
```

---

## Sprint 5 AI/ML Hook Points

| Hook                  | Service              | Interface                            | Use Case                                         |
| --------------------- | -------------------- | ------------------------------------ | ------------------------------------------------ |
| `AnomalyScorer`       | audit-service        | score(record) → 0–1                  | Off-hours access, large trade override detection |
| `MessagePersonaliser` | notification-service | personalise(event) → {subject, body} | Context-aware LLM alert narrative                |
| `MaturityPredictor`   | bo-service           | predictEarlyExercise(...)            | Predict callable bond / option early exercise    |

---

## Test Coverage — Sprint 5

| Module                              | Tests   | Key Scenarios                                                           |
| ----------------------------------- | ------- | ----------------------------------------------------------------------- |
| `AuditRecord` factory               | 4       | unique ID, timing, checksum format                                      |
| `verifyAuditRecord`                 | 5       | untampered ✓, payload mutated ✗, entityId ✗, wrong key ✗, actor ✗       |
| `AuditEventRouter`                  | 7       | routing by topic, CRITICAL severity, actor extraction, repo write, HMAC |
| `InMemoryAuditRepository`           | 2       | search by category, pagination                                          |
| `NotificationService` channels      | 4       | email, ws, both, failure tracking                                       |
| `NotificationService` rules         | 3       | topic match, unknown topic, custom rules                                |
| `NotificationService` template      | 3       | subject content, CRITICAL=high priority                                 |
| `NotificationService` AI/ML         | 2       | personaliser used, fallback on timeout                                  |
| `CorporateActionsService` coupon    | 5       | amount formula, BUY+/SELL-, requiresSwift                               |
| `CorporateActionsService` principal | 4       | 2 flows, notional, MATURED, Kafka                                       |
| `CorporateActionsService` IRS       | 3       | net CF, receiver+, payer-                                               |
| `CorporateActionsService` other     | 5       | expiry, exercise, deposit, Kafka shape                                  |
| **Sprint 5 Total**                  | **47**  |                                                                         |
| **Cumulative**                      | **364** | All 27 test files, 0 failures                                           |
