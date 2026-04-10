# C4 Level 3 — Component Diagrams: Sprint 11 AI & Self-Service

## Sprint 11 — Advanced Analytics & Real-Time Streaming

### 11.1 Reporting Service — AI Treasury Insights Assistant

```
[reporting-service]
  └── TreasuryAIAssistant            [Sprint 11.1]
        ├── QueryClassifier          Regex-based intent → QueryCategory enum
        │     (FX_EXPOSURE, LIMIT_UTILISATION, IRRBB_ANALYSIS, LIQUIDITY_RATIOS,
        │      CAPITAL_POSITION, TRADE_BLOTTER, PROFITABILITY, GENERAL)
        │
        ├── PIIRedactor              IBAN / BIC pattern masking before API call
        │
        ├── ContextBuilder           Structured data → grounded user message
        │     ├── FXPositionFormatter
        │     ├── LimitUtilisationFormatter
        │     └── RegulatoryRatioFormatter
        │
        ├── ClaudeAPIClient          POST /v1/messages to claude-sonnet-4-20250514
        │     ├── SystemPrompt       Professional treasury assistant role + guardrails
        │     ├── AbortController    configurable timeout (default 30s)
        │     └── ResponseParser     Extracts text content block
        │
        ├── FallbackHandler          Rule-based graceful degradation on API failure
        └── MetricsCollector         totalQueries, failedQueries, successRate
```

**RAG Data Flow:**
```
1. User question → QueryClassifier → category
2. TreasuryDataContext snapshot → ContextBuilder → grounded prompt
3. grounded prompt → ClaudeAPIClient → claude-sonnet-4-20250514 → raw answer
4. raw answer → ResponseParser → AssistantResponse
5. AssistantResponse → PIIRedactor (output check) → client
```

**Guardrails enforced:**
- Tenant isolation: context includes only tenantId-scoped data
- PII: IBAN/BIC redacted from user input before API call
- Hallucination resistance: system prompt forbids invented metrics
- No training: data passes as context tokens only, never persisted

---

### 11.2 Reporting Service — Self-Service Report Builder

```
[reporting-service]
  └── ReportBuilder                  [Sprint 11.2]
        ├── ReportRegistry           In-memory store (Map<reportId, ReportDefinition>)
        ├── TemplateLibrary          8 pre-built templates with default metric sets
        │     (BLOTTER, PNL, POSITION, LCR, IRRBB, COLLATERAL, CAPITAL, CUSTOM)
        ├── DimensionSelector        ASSET_CLASS / BOOK / TRADER / COUNTERPARTY /
        │                            CURRENCY / LEGAL_ENTITY / SCENARIO
        ├── ScheduleEngine           cron expression + timezone + active flag
        ├── DeliveryRouter           EMAIL / SFTP / API webhook dispatch
        ├── RunOrchestrator          Tracks RunHistory per reportId
        └── OutputFormats            PDF / EXCEL / CSV generation hooks
```

**Report Lifecycle:**
```
define() → DRAFT → run('MANUAL') → COMPLETED
                 → schedule(cron) → SCHEDULED run → COMPLETED
                                  → delivery dispatch (EMAIL/SFTP/API)
```

---

### 11.3 Notification Service — SSE Stream Publisher

```
[notification-service]
  └── SSEStreamPublisher             [Sprint 11.3]
        ├── SubscriptionRegistry     Map<subscriptionId, StreamSubscription>
        │     Tenant-isolated; userId + tenantId + eventType filter
        │
        ├── EventPublisher           Fan-out to matching active subscriptions
        │     Enforces: tenant isolation, event-type filter, isActive check
        │
        ├── SSEFormatter             RFC 8895 SSE format: id: / event: / data: / \n\n
        │
        ├── HeartbeatEmitter         30s keepalive to prevent connection timeout
        │
        └── EventLog                 Circular buffer, last 1000 events per tenant
```

**SSE Event Types:**
```
position.mtm.updated    → React live blotter, 500ms intervals
limit.utilisation.tick  → Real-time limit headroom gauge
rate.feed.tick          → FX rate tile (from Bloomberg B-PIPE)
lcr.intraday.updated    → Intraday LCR dashboard widget
heartbeat               → Connection keepalive (every 30s)
```

**Kafka → SSE Pipeline:**
```
Kafka topic (nexus.position.mtm-updated)
  → KafkaConsumer [notification-service]
  → SSEStreamPublisher.publish()
  → HTTP SSE endpoint /api/v1/stream/{tenantId}
  → React EventSource client
  → Redux store update (< 500ms end-to-end)
```
