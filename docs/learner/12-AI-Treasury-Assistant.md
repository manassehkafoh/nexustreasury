# Module 12 — AI Treasury Assistant & Self-Service Analytics

## Sprint 11 — What was built

Sprint 11 added three capabilities that move NexusTreasury from a data platform to an intelligent insights platform:

1. **AI Treasury Insights Assistant** — natural language Q&A over live treasury data
2. **Self-Service Report Builder** — non-technical staff can define, schedule, and deliver reports
3. **Real-Time Dashboard Streaming** — Kafka → SSE push pipeline for sub-second UI updates

---

## AI Treasury Insights Assistant

The assistant is powered by **Claude claude-sonnet-4-20250514** (Anthropic) via a RAG (Retrieval-Augmented Generation) pipeline.

**How it works:**
1. User asks: "What is our EUR/USD FX exposure vs last month?"
2. `QueryClassifier` identifies category: `FX_EXPOSURE`
3. `ContextBuilder` assembles a structured data snapshot from the treasury database
4. Grounded prompt sent to Claude: *"Here is today's FX position data. Answer: What is our EUR/USD exposure?"*
5. Claude answers using only the provided data — it cannot hallucinate metrics it was not given
6. `PIIRedactor` strips any IBAN/BIC patterns from the user's input before the API call

**Guardrails:**
- No cross-tenant data: context is scoped to `tenantId`
- No model training: data is context tokens only, never stored by Anthropic
- Hallucination resistance: system prompt instructs Claude to say "Insufficient data" rather than invent numbers
- Graceful degradation: if the API is unavailable, rule-based fallback returns category-appropriate suggestions

**Example questions the assistant handles well:**
- "Which counterparties are above 80% limit utilisation?"
- "Compare our LCR to the 100% regulatory minimum"
- "Show me the IRRBB NII sensitivity to a +200bp shock"
- "What is our survival horizon under the idiosyncratic stress scenario?"

---

## Self-Service Report Builder

Any treasury user can create a report without writing code:

```typescript
const report = builder.define({
  name: 'Daily FX Blotter',
  template: ReportTemplate.BLOTTER,
  dimensions: [ReportDimension.TRADER, ReportDimension.CURRENCY],
  format: ReportFormat.PDF,
  schedule: { frequency: 'DAILY', cronExpression: '0 8 * * 1-5', timezone: 'UTC', active: true },
  delivery: { method: 'EMAIL', recipients: ['treasury@bank.com'] },
});
```

Pre-built templates include Blotter, P&L, Position, LCR, IRRBB, Collateral, Capital, and Custom.

---

## Real-Time Dashboard Streaming

The React frontend subscribes to an SSE endpoint. The Kafka consumer in `notification-service` publishes events to matching subscribers:

```
Kafka topic: nexus.position.mtm-updated
  → SSEStreamPublisher.publish({ type: 'position.mtm.updated', tenantId, data: { pair, mtm } })
  → EventSource client in React
  → Redux store update
  → Position tile re-renders in < 500ms
```

Each subscription is tenant-isolated — no subscriber can receive events from a different bank.

---

## Key files

- `packages/reporting-service/src/application/treasury-ai-assistant.ts`
- `packages/reporting-service/src/application/report-builder.ts`
- `packages/notification-service/src/application/sse-stream-publisher.ts`
