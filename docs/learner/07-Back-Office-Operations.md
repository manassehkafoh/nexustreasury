# Learner Guide 7: Back Office and SWIFT Operations

**Prerequisites:** [Guide 6 — ALM and Liquidity](./06-ALM-and-Liquidity.md)

**What you'll learn:** What the back office does, how SWIFT messages work,
how NexusTreasury auto-matches confirmations, and what happens when a match fails.

---

## The Back Office Role

After a trade is agreed between two banks (the "front office" part), someone
has to confirm the details and actually move the money. That is the back office.

Back office tasks:

1. **Confirmation** — match incoming SWIFT messages from the counterparty against booked trades
2. **Settlement** — instruct Nostro banks to transfer cash on the settlement date
3. **Reconciliation** — ensure what the system says happened matches what actually happened
4. **Exception management** — investigate and resolve any mismatches

---

## What is SWIFT?

**SWIFT** (Society for Worldwide Interbank Financial Telecommunication) is the global
messaging network that banks use to communicate trade confirmations, payment instructions,
and settlement details.

Every bank has a **BIC (Bank Identifier Code)** — a unique 8-11 character identifier.
Example: `XXXXXXGHAC` = a bank in Ghana (GH), in Accra (AC).

SWIFT messages follow strict formats. The most relevant for NexusTreasury:

| Message Type | Used for                                        |
| ------------ | ----------------------------------------------- |
| MT300        | FX trade confirmation                           |
| MT320        | Fixed-term deposit / money market confirmation  |
| MT360        | Single currency interest rate derivative        |
| MT361        | Cross-currency interest rate derivative         |
| MT530        | Transaction processing instruction              |
| MT548        | Settlement status and processing advice         |
| pacs.008     | ISO 20022 credit transfer (SWIFT gpi)           |
| pacs.009     | ISO 20022 financial institution credit transfer |
| camt.053     | ISO 20022 bank-to-customer statement            |

---

## SWIFT Matching in NexusTreasury

When a counterparty sends a SWIFT confirmation (e.g. MT300 for an FX deal),
`bo-service` receives it via `POST /api/v1/bo/swift/inbound` and the
`SWIFTMatcher` scores it against unconfirmed trades.

### Match Scoring Algorithm

The matcher calculates a **match score out of 100** based on five fields:

| Field            | Weight | Match logic                        |
| ---------------- | ------ | ---------------------------------- |
| Trade reference  | 40 pts | Exact match on reference number    |
| Counterparty BIC | 20 pts | BIC in SWIFT message matches trade |
| Value date       | 15 pts | Exact date match                   |
| Notional amount  | 15 pts | Within 0.01% tolerance             |
| Exchange rate    | 10 pts | Within 0.005% tolerance (FX only)  |

**Score ≥ 80 → `MATCHED`** (auto-confirmed)
**Score 50–79 → `PENDING`** (human review required)
**Score < 50 → `UNMATCHED`** (exception raised)

### Match Flow

```
Counterparty sends MT300 via SWIFT network
       │
       ▼
Bank's SWIFT interface receives message
       │
       ▼
POST /api/v1/bo/swift/inbound {
  messageType: "MT300",
  senderBIC: "BANKGHAC",
  content: ":20:FX-20260407-A3B2C1\n:32B:USD12500000\n..."
}
       │
       ▼
SWIFTMatcher.match(message, pendingTrades)
  → Parse SWIFT fields from message content
  → Score against each unconfirmed trade
  → Best match: score 90 for trade FX-20260407-A3B2C1
       │
       ▼
Status: MATCHED
  → Trade confirmed
  → SettlementInstruction generated
  → Back office notified
```

---

## Settlement Instructions

Once a trade is confirmed (either via SWIFT auto-match or manual confirmation),
a settlement instruction is generated. This tells the correspondent bank:

> "On 2026-04-09, please pay USD 12,500,000 to NEXUSGHAC's Nostro account
> at Bank of America, New York, in favour of BANKGHAC."

NexusTreasury generates these instructions automatically for matched trades.

---

## Settlement Ladder

The **settlement ladder** shows net cash flows by date and currency.
Instead of seeing 50 individual settlements, the ALM team sees:

```
Date         Currency   Net Flow
2026-04-09   USD        -12,500,000  (paying on FX deals settling today)
2026-04-09   EUR        +11,510,000  (receiving EUR side of FX deals)
2026-04-10   USD        +5,000,000
2026-04-10   GBP        -2,100,000
```

This helps the ALM desk manage Nostro account balances and ensure they never go
overdrawn on a settlement date.

Endpoint: `GET /api/v1/bo/settlement-ladder`

---

## STP Rate

**STP (Straight-Through Processing) rate** = percentage of trades confirmed
without manual intervention.

NexusTreasury targets ≥ 95% STP. The remaining ≤ 5% require a back office
operator to review mismatches.

**Factors that reduce STP:**

- Counterparty sends wrong trade reference (reference must be shared before SWIFT)
- Amount or rate discrepancy (fat-finger error on either side)
- Counterparty sends confirmation late (after trade cut-off)
- Counterparty uses a different SWIFT message format

---

## Handling Exceptions

When a SWIFT message cannot be matched (score < 80), it becomes an **exception**:

```bash
GET /api/v1/bo/exceptions
```

```json
{
  "totalExceptions": 2,
  "exceptions": [
    {
      "messageId": "MSG-001",
      "messageType": "MT300",
      "receivedAt": "2026-04-07T14:30:00Z",
      "matchScore": 45,
      "reason": "Reference number not found in system",
      "status": "UNMATCHED"
    }
  ]
}
```

A back office operator investigates:

1. Contact counterparty to confirm trade details
2. Check if the trade was booked under a different reference
3. If confirmed valid: manually match via back office UI
4. If duplicate or error: reject the SWIFT message

---

## ISO 20022 Migration

SWIFT is migrating from MT (legacy format) to ISO 20022 MX format (pacs, camt, pain).
NexusTreasury supports both formats via the `SWIFTMatcher`:

```typescript
// MT300 support (legacy)
if (message.messageType === 'MT300') {
  reference = this.parseField(content, ':20:');
  notional = this.parseField(content, ':32B:');
}

// pacs.008 support (ISO 20022)
if (message.messageType === 'pacs.008') {
  reference = this.parseXMLField(content, 'EndToEndId');
  notional = this.parseXMLField(content, 'IntrBkSttlmAmt');
}
```

---

## Next Steps

**Next:** [Building on NexusTreasury](./08-Building-on-NexusTreasury.md)

Now that you understand the full business domain, you're ready to learn how to
extend the platform — adding new features, services, and integrations.
