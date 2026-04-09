# 📚 Accounting & IFRS 9 — Learning Wiki

> **Module**: `@nexustreasury/accounting-service`
> **Sprint**: Sprint 2 | **Audience**: Developers, Finance Controllers, Auditors

---

## Table of Contents

1. [Double-Entry Accounting Fundamentals](#1-double-entry-accounting-fundamentals)
2. [Chart of Accounts](#2-chart-of-accounts)
3. [IFRS 9 Classification Engine](#3-ifrs-9-classification-engine)
4. [ECL (Expected Credit Loss)](#4-ecl-expected-credit-loss)
5. [Hedge Accounting](#5-hedge-accounting)
6. [Journal Entries by Asset Class](#6-journal-entries-by-asset-class)
7. [AI/ML Integration Points](#7-aiml-integration-points)
8. [Common Questions & Pitfalls](#8-common-questions--pitfalls)

---

## 1. Double-Entry Accounting Fundamentals

Every financial transaction must be recorded with equal debits and credits:

```
Σ(DR lines per currency) = Σ(CR lines per currency)
```

**Normal balances:**

- **Assets** (accounts 1000–1999): normal DEBIT balance
- **Liabilities** (accounts 2000–2999): normal CREDIT balance
- **Equity** (accounts 3000–3999): normal CREDIT balance
- **Revenue** (accounts 4000–4999): normal CREDIT balance
- **Expenses** (accounts 5000–5999): normal DEBIT balance

```typescript
// ✅ Balanced entry (1M USD)
const entry = JournalEntry.create({
  lines: [
    { accountCode: '1300', direction: EntryDirection.DEBIT, amount: 1_000_000, currency: 'USD' },
    { accountCode: '8100', direction: EntryDirection.CREDIT, amount: 1_000_000, currency: 'USD' },
  ],
  // ...
});

// ❌ Throws AccountingDomainError: 'JE_OUT_OF_BALANCE'
const badEntry = JournalEntry.create({
  lines: [
    { accountCode: '1300', direction: EntryDirection.DEBIT, amount: 1_000_000, currency: 'USD' },
    { accountCode: '8100', direction: EntryDirection.CREDIT, amount: 999_990, currency: 'USD' },
  ],
  // ...
});
```

**Multi-currency entries:** balance is checked per-currency independently. An FX Spot entry has 4 lines (2 per currency), each pair balanced separately.

---

## 2. Chart of Accounts

NexusTreasury ships a standard banking CoA:

| Code Range | Category      | Examples                                                          |
| ---------- | ------------- | ----------------------------------------------------------------- |
| 1000–1999  | Assets        | Nostro (1100), Bonds AMC (1300), FVOCI (1310), Derivatives (1400) |
| 2000–2999  | Liabilities   | FX Forward Liab (2100), MM Borrowings (2300)                      |
| 3000–3999  | Equity / OCI  | FVOCI Reserve (3200), CF Hedge Reserve (3300)                     |
| 4000–4999  | Revenue       | Interest Income (4100), MTM P&L (4300)                            |
| 5000–5999  | Expenses      | Interest Expense (5100), ECL Charge (5200)                        |
| 6000–6999  | OCI Movements | FVOCI FV Movement (6100), CF Hedge Movement (6200)                |
| 8000–8999  | Clearing      | Trade Date Clearing (8100/8200)                                   |

**Tenant customisation** — add or override accounts at provisioning:

```typescript
const tenantCoA = ChartOfAccounts.withOverrides([
  {
    id: AccountId('1305'),
    code: '1305',
    name: 'Sukuk — Amortised Cost', // Islamic Finance override
    type: AccountType.ASSET,
    normalBalance: EntryDirection.DEBIT,
    ifrs9Category: IFRS9Category.AMORTISED_COST,
    active: true,
    subLedger: 'ISLAMIC_FINANCE',
  },
]);
```

---

## 3. IFRS 9 Classification Engine

### The two-step classification test

**Step 1: SPPI Test** — do contractual cash flows represent solely payments of **principal** and **interest** on the principal outstanding?

- ✅ PASS: standard bonds, T-Bills, money market deposits, repos
- ❌ FAIL: derivatives (IRS, FX options), convertibles, structured notes, equity

**Step 2: Business Model Test** (only for SPPI-passing instruments)

| Business Model           | Category           |
| ------------------------ | ------------------ |
| Hold to Collect (HTC)    | **Amortised Cost** |
| Hold to Collect and Sell | **FVOCI**          |
| Other (trading)          | **FVPL Mandatory** |

```typescript
const result = classifier.classify({
  assetClass: AssetClass.FIXED_INCOME,
  instrumentType: 'BOND',
  businessModel: BusinessModel.HOLD_TO_COLLECT,
});
// → { category: 'AMC', assetAccountCode: '1300', sppiPass: true }
```

### Why does this matter?

- **AMC instruments**: carried at amortised cost, interest accrued using EIR method, no MTM P&L volatility
- **FVOCI instruments**: MTM goes to OCI (equity), reclassified to P&L on sale
- **FVPL instruments**: MTM goes straight to P&L — most volatile

---

## 4. ECL (Expected Credit Loss)

**Formula:** `ECL = PD × LGD × EAD × DiscountFactor`

| Variable | Definition                                | Example                  |
| -------- | ----------------------------------------- | ------------------------ |
| PD       | Probability of Default                    | 0.30% for BBB-rated      |
| LGD      | Loss Given Default = 1 − recovery         | 60% for senior unsecured |
| EAD      | Exposure at Default = principal + accrued | $1,025,000               |
| DF       | Discount to reporting date                | exp(−5% × 2.5) = 0.882   |

### ECL = PD × LGD × EAD × DF = 0.003 × 0.6 × 1,025,000 × 0.882 = **$1,631**

### Stage assignment

```
Stage 1 → 12-month ECL:  no SICR — normal performing
Stage 2 → Lifetime ECL:  SICR triggered (DPD≥30 OR rating −2 notches OR watch-list)
Stage 3 → Lifetime ECL:  credit-impaired (DPD≥90 OR default)
```

**Journal entry for ECL:**

```
Dr ECL Impairment Charge (5200)  $1,631
  Cr ECL Allowance — Stage 1 (1800)  $1,631
```

---

## 5. Hedge Accounting

### Why hedge accounting?

Without hedge accounting, a USD interest rate swap hedging a fixed-rate bond would:

- Create P&L volatility from the swap MTM every day
- While the bond's carrying value stays flat (AMC)

Hedge accounting allows both items to be recorded on the **same basis**, reducing P&L volatility.

### Effectiveness requirement

A hedge relationship is **highly effective** if the ratio falls within [80%, 125%]:

```
Ratio = −ΔFV(instrument) / ΔFV(hedged item)

Example:
  Swap MTM change:   −$95,000   (instrument moves opposite)
  Bond FV change:    +$100,000  (hedged item)
  Ratio = 95,000 / 100,000 = 0.95  → highly effective ✅
```

### Journal entries

**Cash Flow Hedge (highly effective):**

```
Dr IRS Asset (1400)          $95,000
  Cr OCI — CF Hedge Reserve (6200)   $90,000  ← effective portion
  Cr Hedge Ineffectiveness P&L (4400) $5,000  ← ineffective portion
```

---

## 6. Journal Entries by Asset Class

| Event           | DR                | CR                            | Notes             |
| --------------- | ----------------- | ----------------------------- | ----------------- |
| Bond BUY (AMC)  | 1300 Bond Asset   | 8100 Clearing                 | Trade date        |
| Bond BUY settle | 8100 Clearing     | 1100 Nostro                   | Settlement date   |
| Bond SELL (AMC) | 8100 Clearing     | 1300 Bond Asset               | Trade date        |
| MM Placement    | 1500 MM Asset     | 1100 Nostro                   | Same day          |
| MM Maturity     | 1100 Nostro       | 1500 MM Asset + 4100 Interest | Value date        |
| FX Spot BUY EUR | 1100 EUR Nostro   | 8100 EUR Clearing             | Trade date        |
| FX Spot BUY EUR | 8100 USD Clearing | 1100 USD Nostro               | Trade date        |
| Repo (sell)     | 1100 Nostro       | 2900 Repo Liability           | Cash in           |
| IRS MTM gain    | 1400 IRS Asset    | 4300 MTM P&L                  | Daily revaluation |
| ECL Stage 1     | 5200 ECL Charge   | 1800 ECL Allowance            | Quarterly         |

---

## 7. AI/ML Integration Points

```typescript
// ECL with ML PD model (macro-scenario overlay)
const eclWithML = new ECLCalculator({
  pdModel: {
    predict: async ({ currentRating, tenorYears }) => {
      const scenarios = await macroModel.getScenarios(); // base/adverse/optimistic
      const pdBase = scenarios.base.pd(currentRating, tenorYears);
      const pdAdverse = scenarios.adverse.pd(currentRating, tenorYears);
      // Probability-weighted per IFRS 9 §5.5.17(c)
      return {
        pd12Month: 0.5 * pdBase + 0.3 * pdAdverse + 0.2 * scenarios.optimistic.pd(currentRating, 1),
        pdLifetime:
          0.5 * pdBase + 0.3 * pdAdverse + 0.2 * scenarios.optimistic.pd(currentRating, tenorYears),
        modelVersion: 'macro-overlay-v2.1',
      };
    },
  },
});
```

---

## 8. Common Questions & Pitfalls

**Q: Why does bond BUY debit the asset AND debit clearing?**
A: Bond is DR (asset arrives). Clearing is CR (obligation to pay on settlement date). On settlement date, clearing reverses DR and Nostro is CR.

**Q: Why no IRS entry at inception?**
A: An at-market IRS has NPV = 0. There's nothing to record. The swap only creates assets/liabilities as MTM moves away from par.

**Q: Why is the reversal double the original?**
A: When `debitTotal() + reversal.debitTotal()` = 2M — this is correct. Original DR = 1M, Reversal DR = 1M (the reversal's DR is what was originally CR). Net = 0 on the GL.

**Q: How do I make the ECL use forward-looking scenarios?**
A: Inject a `PDModelAdapter` that returns probability-weighted PDs across base/adverse/optimistic macro scenarios per IFRS 9 §5.5.17(c).
