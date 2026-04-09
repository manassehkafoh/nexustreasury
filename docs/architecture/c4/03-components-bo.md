# C4 Level 3 — Back Office Service Components

Internal architecture of the **Back Office Service** (`packages/bo-service`).
Handles SWIFT MX/MT message processing, confirmation matching, and settlement.

## Diagram

```mermaid
flowchart TB
  subgraph boSvc["Back Office Service  :4005"]
    routes["BO Routes
Fastify / OpenAPI 3
POST /bo/swift/inbound, GET /bo/exceptions"]
    mxParser["ISO20022Parser
Application Service — MX
fxtr/pacs/camt XML parsing · UTI · LEI · BIC"]
    mtParser["MT FIN Parser
Application Service — Legacy
Colon-tagged field extraction :20: :32B:"]
    matcher["SWIFTMatcher
Application Service
Weighted scoring: UTI(40%) LEI(20%) date(15%) amt(15%) rate(10%)"]
    confirmSvc["ConfirmationService
Domain Service
Auto-match · STP target ≥ 95% in 15 min"]
    settleSvc["SettlementService
Domain Service
CLS settlement instructions · Nostro management"]
    reconSvc["ReconciliationService
Domain Service
Daily nostro recon · Breaks identification"]
    tradeConsumer["TradeEventConsumer
Kafka Consumer
nexus.trading.trades.created"]
    confPub["ConfirmationPublisher
Kafka Producer
nexus.bo.confirmation-received"]
    settlePub["SettlementPublisher
Kafka Producer
nexus.bo.settlement-instruction"]
    s3Client["S3ArchiveClient
Infrastructure
SWIFT message archive 7 years"]
  end

  subgraph external["External"]
    swift[("SWIFT Alliance")]
    kafka[("Apache Kafka")]
    pg[("PostgreSQL")]
    s3[("Object Storage")]
    cls[("CLS Bank")]
  end

  swift        -->|"POST /bo/swift/inbound (MX XML / MT FIN)"| routes
  routes       -->|"parse(xmlContent, messageType)"| mxParser
  routes       -->|"parseMT(finContent, messageType)"| mtParser
  mxParser     -->|"match(parsedFields, tradeRef)"| matcher
  mtParser     -->|"match(parsedFields, tradeRef)"| matcher
  matcher      -->|"onMatchResult(result)"| confirmSvc
  confirmSvc   -->|"publish(ConfirmationMatchedEvent)"| confPub
  confirmSvc   -->|"archive(swiftMessage)"| s3Client
  kafka        -->|"nexus.trading.trades.created"| tradeConsumer
  tradeConsumer -->|"createPendingConfirmation(trade)"| confirmSvc
  settleSvc    -->|"publish(SettlementInstructionEvent)"| settlePub
  settlePub    -->|"nexus.bo.settlement-instruction"| kafka
  confPub      -->|"nexus.bo.confirmation-received"| kafka
  settleSvc    -->|"FX settlement instruction"| cls
  confirmSvc   -->|"INSERT/UPDATE confirmations"| pg
  settleSvc    -->|"INSERT settlements, cash_flows"| pg
  s3Client     -->|"PUT swift/{year}/{msgId}.xml"| s3
```

## SWIFT MX Message Support Matrix

| MX Message | Replaces (MT) | Purpose                            | Parser Method    |
| ---------- | ------------- | ---------------------------------- | ---------------- |
| `fxtr.008` | MT300         | FX Trade Confirmation              | `parseFxtr()`    |
| `fxtr.014` | MT300         | FX Trade Status Advice             | `parseFxtr()`    |
| `pacs.008` | MT103         | Customer Credit Transfer           | `parsePacs008()` |
| `pacs.009` | MT202         | FI Credit Transfer (FX settlement) | `parsePacs009()` |
| `pacs.002` | MT199         | Payment Status Report              | `parsePacs002()` |
| `pacs.028` | MT192         | FI Payment Status Request          | `parsePacs028()` |
| `camt.053` | MT940         | Bank Statement (Nostro recon)      | `parseCamt053()` |
| `camt.054` | MT942         | Debit/Credit Notification          | `parseCamt054()` |
| `camt.056` | MT192/MT292   | Payment Cancellation Request       | `parseCamt056()` |

## Matching Score Breakdown

```mermaid
pie title SWIFT Matching Score Weights (total 100)
  "UTI / EndToEndId / TradeRef" : 40
  "Counterparty LEI / BIC" : 20
  "Value / Settlement Date" : 15
  "Notional Amount (±0.01%)" : 15
  "Exchange Rate (±0.005%)" : 10
```

| Score          | Status    | Action                   |
| -------------- | --------- | ------------------------ |
| ≥ 80           | MATCHED   | Auto-confirmed; STP path |
| 50–79          | PENDING   | Back office review       |
| < 50           | UNMATCHED | Exception queue          |
| Field mismatch | EXCEPTION | Immediate alert          |
