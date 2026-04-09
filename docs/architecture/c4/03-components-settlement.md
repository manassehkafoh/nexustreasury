# C4 Level 3 — Settlement & Back Office Components

> **Sprint**: Sprint 3 (P1 — Settlement, SSI, Nostro Reconciliation)
> **Last Updated**: 2026-04-09

---

## Component Overview

```mermaid
flowchart TB
  subgraph BO["bo-service (port 4005)"]
    direction TB

    subgraph SETTLE["Settlement Layer"]
      SIG["SettlementInstructionGenerator\n\nGenerates MT + MX messages\nper asset class:\nFX → MT202/MT103/MT210\nSecurities → MT54x series\nMM → MT202/MT103\nAI hook: CutoffTimeOptimiser"]
      SSI["SSIService\n\nSSI repository per:\n(counterparty, ccy, type)\nPriority resolution:\nexact > ccy wildcard > '*'\nAI hook: SSIAnomalyDetector\n(fraud detection on BIC change)"]
    end

    subgraph RECON["Reconciliation Layer"]
      NRS["NostroReconciliationService\n\nMatches camt.053/MT940\nagainst expected TMS flows.\nMatch types:\nexact → MATCHED\nfuzzy → REVIEW\nnone → BREAK\nAI hook: BreakClassifierModel"]
    end

    subgraph EXISTING["Existing (Sprint 1)"]
      SM["SWIFTMatcher\n\nScore-based matching\n(60-point threshold).\nField scoring:\nRef +40, Date +20,\nAmount +20, LEI +20"]
      ISO["ISO20022Parser\n\nfxtr.008 / pacs.008/009\ncamt.053/054/056\npacs.002/028\nMT300 legacy FIN"]
    end
  end

  subgraph KAFKA["Kafka Topics"]
    K1["nexus.bo.settlement-instructions"]
    K2["nexus.bo.reconciliation-break"]
    K3["nexus.trading.trades.booked"]
  end

  subgraph EXT["External Networks"]
    SWIFT["SWIFT Alliance\nGateway / Service Bureau"]
    CLS["CLS Bank\n(FX settlement)"]
    CSD["CSD / Custodian\n(DTC / Euroclear / CSD)"]
  end

  K3 -->|"new trade"| SIG
  SIG -->|"looks up SSI"| SSI
  SIG -->|"publishes"| K1
  K1 -->|"transmitted"| SWIFT
  SWIFT -->|"inbound statement"| ISO
  ISO -->|"parsed camt.053"| NRS
  NRS -->|"break events"| K2

  classDef svc  fill:#1a3a5c,stroke:#4a90d9,color:#e8f4ff
  classDef ext  fill:#3a1a5c,stroke:#7a4ad9,color:#f0e8ff
  classDef kfk  fill:#2a1a4a,stroke:#6a4a9d,color:#f0e8ff

  class SIG,SSI,NRS,SM,ISO svc
  class SWIFT,CLS,CSD ext
  class K1,K2,K3 kfk
```

---

## Settlement Message Matrix

| Asset Class    | Buy              | Sell             | Notice           | Network         |
| -------------- | ---------------- | ---------------- | ---------------- | --------------- |
| FX (interbank) | MT202 / pacs.009 | MT202 / pacs.009 | MT210 / camt.057 | CLS / bilateral |
| FX (corporate) | MT103 / pacs.008 | MT103 / pacs.008 | MT210            | SWIFT           |
| Fixed Income   | MT541 / sese.023 | MT543 / sese.023 | —                | CSD / custodian |
| Repo           | MT541 / sese.023 | MT543 / sese.023 | —                | CSD             |
| Money Market   | MT202 / pacs.009 | MT202 / pacs.009 | —                | SWIFT           |

---

## Reconciliation Break Categories

```mermaid
flowchart LR
  S["Statement Entry"] --> M{Match?}
  M -->|"Exact: same ref+amount+date"| MATCHED["✅ MATCHED\n(auto-STP)"]
  M -->|"Amount match, date diff ≤1d"| REVIEW["🔶 REVIEW\nTIMING_DIFFERENCE"]
  M -->|"Ref match, amount diff"| AMTB["🔴 BREAK\nAMOUNT_MISMATCH"]
  M -->|"No match at all"| UNRG["🔴 BREAK\nUNRECOGNISED"]
  EF["Expected Flow\n(no statement entry)"] --> MISS["🔴 BREAK\nMISSING_PAYMENT"]

  classDef ok   fill:#1a4a2a,stroke:#4a9d5a,color:#e8ffe8
  classDef warn fill:#4a3a1a,stroke:#9d7a2a,color:#fff8e0
  classDef err  fill:#4a1a1a,stroke:#9d2a2a,color:#ffe8e8

  class MATCHED ok
  class REVIEW warn
  class AMTB,UNRG,MISS err
```

---

## SSI Priority Resolution

```
findBestMatch(counterpartyId, currency, instrumentType):
  1. exact:   currency='USD' AND instrumentType='FX'      → highest priority
  2. partial: currency='USD' AND instrumentType='*'       → medium
  3. wildcard: currency='*'  AND instrumentType='*'       → fallback
  4. null:    no SSI found → settlement instruction uses 'UNKNOWN' BIC
```

---

## AI/ML Hook Points — Sprint 3

| Hook                   | Interface                         | Purpose                           | Default Behaviour        |
| ---------------------- | --------------------------------- | --------------------------------- | ------------------------ |
| `CutoffTimeOptimiser`  | predict send time per MsgType+CCY | Maximise same-day settlement rate | None (no recommendation) |
| `SSIAnomalyDetector`   | score BIC/account changes 0–1     | Detect payment redirection fraud  | None (all SSIs active)   |
| `BreakClassifierModel` | classify break cause + action     | Auto-triage reconciliation breaks | None (no AI insight)     |
