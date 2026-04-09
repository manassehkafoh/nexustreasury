# 📚 Settlement & Nostro Reconciliation — Learning Wiki

> **Module**: `@nexustreasury/bo-service` (Sprint 3)
> **Audience**: Back Office Analysts, Developers, Operations

---

## 1. Settlement Lifecycle

```
Trade Booked → SSI Lookup → Instruction Generated → Transmitted → Matched → Settled
     ↓               ↓              ↓                    ↓           ↓         ↓
 TradeService    SSIService    SIG generates       SWIFT sends   SWIFTMatcher  Nostro updated
                              MT202/MT103/MT54x    MT/MX msg     confirms STP
```

## 2. Standing Settlement Instructions (SSIs)

SSIs eliminate the need to manually enter bank details for every trade.
They are stored per **(counterparty, currency, instrument type)** tuple.

**Priority resolution example:**

```
Counterparty: Citibank | Currency: USD | Type: FX

Check 1 — exact match:  (Citibank, USD, FX)        ✅ Found → use this
Check 2 — ccy wildcard: (Citibank, USD, *)          only if Check 1 fails
Check 3 — full wildcard: (Citibank, *, *)           only if Check 2 fails
Check 4 — null:          no SSI found → UNKNOWN BIC (alert ops team)
```

**SSI Fraud Prevention:** The `SSIAnomalyDetector` AI hook scores every SSI change 0–1.
Score > 0.7 → SSI quarantined (active=false) pending 4-eye approval.
Red flags: BIC changes to different country, beneficiary name changes without BIC change,
SSI change within 24h of a large settlement.

## 3. SWIFT Message Types

| Message | Purpose                            | Triggered by               |
| ------- | ---------------------------------- | -------------------------- |
| MT202   | Bank-to-bank credit transfer       | FX/MM interbank payment    |
| MT103   | Customer credit transfer           | FX/MM corporate payment    |
| MT210   | Notice to receive                  | Expecting incoming payment |
| MT541   | Receive securities against payment | Bond/Repo purchase         |
| MT542   | Deliver securities free of payment | Securities transfer        |
| MT543   | Deliver securities against payment | Bond/Repo sale             |

### Reading an MT202

```
{1:F01NEXUSTRES0000000000}     ← sender: NexusTreasury BIC
{2:I202CITIUS33XXXN}           ← receiver: Citibank BIC; MT202 type
{4:
:20:FX-20260409-A1B2          ← transaction reference
:21:FX-20260409-A1B2          ← related reference
:32A:260411USD1084200.00      ← value date, currency, amount
:57A:CITIUS33XXX              ← account with institution
:58A:36838271                 ← beneficiary institution
:70:FX BUY EUR/USD ref: ...   ← payment details (70 chars max)
-}
```

## 4. Nostro Reconciliation

### What is a nostro account?

A **nostro** account is a bank account held with a foreign correspondent bank.
"Nostro" = Latin for "ours." The correspondent bank holds your cash.

### Reconciliation process

```
Step 1: Receive camt.053 (bank statement) from correspondent bank
Step 2: Load expected cash flows from NexusTreasury settlement instructions
Step 3: Match entries by (reference, amount, date)
Step 4: Categorise unmatched items as BREAK:
         - TIMING_DIFFERENCE: amount matches, date off by 1 day
         - AMOUNT_MISMATCH:   reference matches, amount different
         - UNRECOGNISED:      on bank statement, not in TMS
         - MISSING_PAYMENT:   in TMS, not on bank statement
Step 5: Alert on large/aged breaks (>$100K or >2 days old)
```

### STP Rate

```
STP Rate = Matched entries / Total statement entries

Target: ≥ 95% (BRD OBJ-005)
Calypso benchmark: ~80–85% typical
NexusTreasury target: >95% with AI-assisted matching
```

### Common break scenarios

| Break                     | Likely Cause                | Resolution                       |
| ------------------------- | --------------------------- | -------------------------------- |
| TIMING_DIFFERENCE 1 day   | Weekend/holiday, T+2 vs T+1 | Auto-resolve if within tolerance |
| AMOUNT_MISMATCH $0.01     | FX rounding on nostro side  | Adjust with small correction JE  |
| MISSING_PAYMENT           | Wire cut-off missed         | Resubmit instruction             |
| UNRECOGNISED large amount | Incoming payment not in TMS | Create manual trade and JE       |

## 5. AI/ML Break Classification

The `BreakClassifierModel` hook returns:

```typescript
{
  likelyCause:     'Payment arrived 1 day late — Holiday in USD',
  confidence:      0.89,
  suggestedAction: 'Auto-resolve as timing difference',
  isFraudFlag:     false,
}
```

Training data: 5+ years of nostro breaks, labelled with actual resolution.
Features: amount, currency, break type, days late, counterparty BIC, historical pattern.
