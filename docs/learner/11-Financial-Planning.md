# Module 11 — Financial Planning, Budgeting & Profitability

## The FIS BSM gap we closed

FIS Balance Sheet Manager's "Finance and Forecasting" module is one of its marquee capabilities, offering distributed NII projections, budgeting cycles, and multi-dimensional profitability. NexusTreasury Sprint 9 built a first-class equivalent in `planning-service` and the RAROC engine.

---

## Annual budget lifecycle

```
Treasury sets targets (NII, NIM, OPEX, RWA by BU)
  → Business units submit BudgetEntry objects
  → BudgetEngine.createBudget() — status: DRAFT
  → Approval workflow: approveBudget(budgetId, 'cfo@bank.com')
  → Status: APPROVED → LOCKED at period start
  → Mid-year: createReforecast() → new RFC plan (version n+1)
```

Each `BudgetEntry` captures the full P&L structure per business unit and period:

| Field | Meaning |
|---|---|
| `targetNII` | Net interest income target |
| `targetNIM` | Net interest margin (as decimal: 0.032 = 3.2%) |
| `nonInterestIncome` | Fee income, FX spread, commissions |
| `opex` | Direct operating expenses |
| `rwa` | Risk-weighted assets for this BU |
| `capitalAllocated` | Internal capital charge |

---

## Budget Report outputs

Once approved, `generateReport(budgetId)` produces:

- **Cost-to-income ratio** = OPEX / (NII + non-interest income)
- **ROE** = NII / capital allocated
- **RAROC** per BU = NII / (RWA × 8%)
- **Capital share** = this BU's capital / total capital (%)
- **Mismatch analysis**: ±100bp NII sensitivity (assumes 60% of NII is rate-sensitive)
- **FTP assessment**: average FTP charge/credit/net margin with recommendation

---

## Funds Transfer Pricing (FTP)

FTP is the internal pricing mechanism that allocates funding cost/benefit to each business unit:

- **FTP charge**: cost a lending BU pays for the funding it uses
- **FTP credit**: benefit a deposit-gathering BU receives for the stable funding it provides
- **Net FTP margin** = credit − charge (negative means wholesale-funded BUs are subsidising deposit BUs)

The `BudgetReport.ftpAssessment` flags when net FTP margin is negative and recommends tenor extension to reduce the wholesale funding cost.

---

## Mismatch Centre

The mismatch centre shows the gap between assets and liabilities repricing at each tenor bucket. NexusTreasury calculates:

```
niiShockUp100bps   = rateSensitiveNII × 0.015  (NII gain from +100bp)
niiShockDown100bps = rateSensitiveNII × −0.012  (NII loss from −100bp)
repricingGap       = RWA × 0.05                 (simplified proxy)
```

A positive repricing gap means the bank benefits from rising rates. A negative gap means it is liability-sensitive.

---

## Key files

- `packages/planning-service/src/application/budget-engine.ts`
- `packages/reporting-service/src/application/raroc-engine.ts`
