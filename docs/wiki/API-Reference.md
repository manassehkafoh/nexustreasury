# API Reference

All APIs require a Bearer JWT in the `Authorization` header.
Get a token from Keycloak at `POST /realms/nexustreasury/protocol/openid-connect/token`.

Base URL: `http://localhost:4001` (local) · `https://api.staging.nexustreasury.com` (staging)

Full interactive docs: `http://localhost:4001/docs` (Swagger UI, auto-generated)

---

## Authentication

```bash
# Get a token
curl -X POST http://localhost:8090/realms/nexustreasury/protocol/openid-connect/token \
  -d "grant_type=password&client_id=nexustreasury-api&username=trader1&password=secret" \
  | jq .access_token

# Use in requests
curl -H "Authorization: Bearer <token>" http://localhost:4001/api/v1/trades
```

The JWT payload includes:

- `sub` — user ID
- `tenantId` — bank/institution ID (applied to all data queries)
- `roles` — `TRADER`, `RISK_MANAGER`, `ALM_ANALYST`, `BACK_OFFICE`, `ADMIN`

---

## Trade Service (port 4001)

### Book a Trade

`POST /api/v1/trades`

Books a new trade. Runs a synchronous pre-deal limit check before persisting.
Publishes `TradeBookedEvent` to Kafka on success.

**Request body:**

```json
{
  "assetClass": "FX",
  "direction": "BUY",
  "counterpartyId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "instrumentId": "7a1b2c3d-4e5f-6789-abcd-ef0123456789",
  "bookId": "1234abcd-ab12-1234-1234-123412341234",
  "traderId": "abcd1234-1234-abcd-abcd-abcd12341234",
  "notionalAmount": 12500000,
  "notionalCurrency": "USD",
  "price": 1.0842,
  "tradeDate": "2026-04-07",
  "valueDate": "2026-04-09",
  "maturityDate": null
}
```

**Valid `assetClass` values:**
`FX` · `FIXED_INCOME` · `MONEY_MARKET` · `INTEREST_RATE_DERIVATIVE` ·
`EQUITY` · `COMMODITY` · `REPO` · `ISLAMIC_FINANCE`

**Responses:**

| Code  | Meaning                                                                       |
| ----- | ----------------------------------------------------------------------------- |
| `201` | Trade booked — returns `{ tradeId, reference, status: "PENDING_VALIDATION" }` |
| `400` | Validation error — invalid field (see `message` for field-level details)      |
| `401` | Missing or expired JWT                                                        |
| `422` | Pre-deal check failed — limit would be exceeded (see `failureReasons`)        |

**Example 201 response:**

```json
{
  "tradeId": "94767d3e-c492-4f8a-b35b-2a549ac16500",
  "reference": "FX-20260407-A3B2C1",
  "status": "PENDING_VALIDATION"
}
```

**Example 422 response (limit breach):**

```json
{
  "error": "PRE_DEAL_FAILED",
  "failureReasons": ["COUNTERPARTY_CREDIT limit would be exceeded: 107.3% > 100%"],
  "utilisationPct": 107.3,
  "headroomAmount": 0
}
```

---

### Get Trade by ID

`GET /api/v1/trades/:tradeId`

**Responses:** `200` (trade found) · `401` (no JWT) · `404` (not found)

```json
{
  "tradeId": "94767d3e-...",
  "reference": "FX-20260407-A3B2C1",
  "status": "PENDING_VALIDATION"
}
```

---

### Amend a Trade

`PATCH /api/v1/trades/:tradeId`

Changes the notional amount and price. Only works for non-settled, non-cancelled trades.

```json
{
  "newNotionalAmount": 15000000,
  "newNotionalCurrency": "USD",
  "newPrice": 1.0891
}
```

**Responses:** `200` · `400` (validation) · `401` · `404` · `409` (trade in wrong status)

---

### Cancel a Trade

`DELETE /api/v1/trades/:tradeId`

```json
{ "reason": "Incorrect counterparty — rebooked as TRD-20260407-X002" }
```

**Responses:** `200` · `400` · `401` · `404` · `409` (cannot cancel settled)

---

### Health Probes

| Endpoint              | Purpose                                     | Used by              |
| --------------------- | ------------------------------------------- | -------------------- |
| `GET /health/live`    | Is the process running?                     | Kubernetes liveness  |
| `GET /health/ready`   | Can it serve traffic? Checks DB+Kafka+Redis | Kubernetes readiness |
| `GET /health/startup` | Did it start cleanly?                       | Kubernetes startup   |

---

## Risk Service (port 4003)

### Pre-Deal Limit Check

`POST /api/v1/risk/pre-deal-check`

Synchronous check against all applicable counterparty limits. Target: P99 < 5ms.

```json
{
  "counterpartyId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "requestedAmount": 12500000,
  "requestedCurrency": "USD"
}
```

**200 response (approved):**

```json
{
  "approved": true,
  "utilisationPct": 73.4,
  "headroomAmount": 3325000,
  "currency": "USD",
  "failureReasons": [],
  "responseTimeMs": 2.1
}
```

**422 response (rejected):**

```json
{
  "approved": false,
  "utilisationPct": 107.3,
  "headroomAmount": 0,
  "failureReasons": ["COUNTERPARTY_CREDIT limit would be exceeded: 107.3% > 100%"],
  "responseTimeMs": 1.8
}
```

---

### Get VaR

`GET /api/v1/risk/var?bookId=<uuid>`

Returns current 1-day 99% VaR for the specified book (or all books if omitted).

```json
{
  "varAmount": 2400000,
  "currency": "USD",
  "confidence": 0.99,
  "horizonDays": 1,
  "method": "HISTORICAL",
  "bookId": "1234abcd-...",
  "asOf": "2026-04-07T10:30:00Z"
}
```

---

### Get Limits in Breach

`GET /api/v1/risk/limits`

Returns all limits currently in breach for the authenticated tenant.

```json
{
  "limitsInBreach": 1,
  "limits": [
    {
      "id": "limit-uuid",
      "limitType": "COUNTERPARTY_CREDIT",
      "utilisationPct": 103.5,
      "inBreach": true
    }
  ]
}
```

---

## ALM Service (port 4004)

### Generate Liquidity Gap Report

`POST /api/v1/alm/liquidity-gap`

Calculates LCR, NSFR, and cash flow gaps across all BCBS time buckets.

```json
{
  "scenario": "CONTRACTUAL",
  "currency": "USD",
  "asOfDate": "2026-04-07",
  "cashFlows": [
    { "bucket": "OVERNIGHT", "inflowAmount": 500000000, "outflowAmount": 320000000 },
    { "bucket": "ONE_WEEK", "inflowAmount": 200000000, "outflowAmount": 350000000 },
    { "bucket": "ONE_MONTH", "inflowAmount": 100000000, "outflowAmount": 400000000 }
  ],
  "lcr": {
    "hqlaLevel1": 1200000000,
    "hqlaLevel2A": 200000000,
    "hqlaLevel2B": 50000000,
    "netCashOutflows30d": 900000000
  },
  "nsfr": {
    "availableStableFunding": 2000000000,
    "requiredStableFunding": 1700000000
  }
}
```

**Valid `scenario` values:** `CONTRACTUAL` · `STRESSED_30D` · `STRESSED_90D` ·
`IDIOSYNCRATIC` · `MARKET_WIDE`

**Valid `bucket` values:** `OVERNIGHT` · `ONE_WEEK` · `TWO_WEEKS` · `ONE_MONTH` ·
`THREE_MONTHS` · `SIX_MONTHS` · `ONE_YEAR` · `TWO_TO_FIVE_YEARS` · `OVER_FIVE_YEARS`

**200 response:**

```json
{
  "reportId": "rpt-uuid",
  "asOfDate": "2026-04-07",
  "scenario": "CONTRACTUAL",
  "lcr": {
    "ratio": 161.11,
    "isCompliant": true,
    "totalHQLA": 1450000000,
    "netOutflows": 900000000
  },
  "nsfr": {
    "ratio": 117.65,
    "isCompliant": true
  },
  "buckets": [
    {
      "bucket": "OVERNIGHT",
      "inflows": 500000000,
      "outflows": 320000000,
      "gap": 180000000,
      "cumulativeGap": 180000000
    }
  ],
  "generatedAt": "2026-04-07T10:00:00Z"
}
```

---

### Get Latest LCR

`GET /api/v1/alm/lcr`

```json
{ "lcrRatio": 161.11, "isCompliant": true, "asOf": "2026-04-07T10:00:00Z" }
```

### Get Latest NSFR

`GET /api/v1/alm/nsfr`

```json
{ "nsfrRatio": 117.65, "isCompliant": true, "asOf": "2026-04-07T10:00:00Z" }
```

---

## Back Office Service (port 4005)

### Submit Incoming SWIFT Message

`POST /api/v1/bo/swift/inbound`

```json
{
  "messageId": "SWIFT-MSG-001",
  "messageType": "MT300",
  "senderBIC": "BANKGHAC",
  "receiverBIC": "NEXUSGHA",
  "content": ":20:FX-20260407-A3B2C1\n:21:REF123\n..."
}
```

**Valid `messageType` values:** `MT300` · `MT320` · `MT360` · `MT361` · `MT530` · `MT548` ·
`pacs.008` · `pacs.009` · `camt.053`

**200 response:**

```json
{
  "messageId": "SWIFT-MSG-001",
  "tradeRef": "FX-20260407-A3B2C1",
  "status": "MATCHED",
  "matchScore": 90,
  "matchedFields": ["tradeReference", "counterpartyBIC", "valueDate", "notionalAmount"],
  "exceptions": [],
  "matchedAt": "2026-04-07T10:15:00Z"
}
```

**`status` values:** `MATCHED` · `UNMATCHED` · `EXCEPTION` · `PENDING`

---

### Get Settlement Exceptions

`GET /api/v1/bo/exceptions`

Returns all SWIFT messages that failed auto-matching.

---

### Get Settlement Ladder

`GET /api/v1/bo/settlement-ladder`

Returns net cash flow by settlement date and currency.

---

## WebSocket — Live Trading Blotter

`ws://localhost:4001/api/v1/trades/stream?token=<jwt>`

Server-push only. No client messages are expected. Each frame is a JSON-serialised
`BlotterRow` pushed immediately when a trade is booked.

```typescript
interface BlotterRow {
  tradeId: string;
  reference: string;
  assetClass: string;
  direction: 'BUY' | 'SELL';
  counterparty: string;
  instrument: string;
  notional: number;
  currency: string;
  price: number;
  status: string;
  tradeDate: string;
  valueDate: string;
  bookedAt: string;
}
```

The connection auto-reconnects with exponential back-off (1s → 2s → 5s → 10s).
