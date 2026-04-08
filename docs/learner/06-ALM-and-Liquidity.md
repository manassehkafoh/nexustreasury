# Learner Guide 6: Asset-Liability Management (ALM) and Liquidity

**Prerequisites:** [Guide 5 — Risk Management](./05-Risk-Management.md)

**What you'll learn:** What ALM is, what the LCR and NSFR ratios mean,
how NexusTreasury calculates them, and what happens when a limit is breached.

---

## What Is ALM?

**Asset-Liability Management (ALM)** is about ensuring the bank always has enough
cash and liquid assets to meet its obligations — even in a crisis.

Imagine a bank that has lent out most of its deposits for 10 years (assets are illiquid)
but owes depositors their money back on demand (liabilities are short-term). If many
depositors ask for their money at once (a "bank run"), the bank cannot pay without
selling its illiquid assets at a loss.

ALM manages this mismatch between:

- **When the bank receives cash** (from loans being repaid, bonds maturing)
- **When the bank must pay out cash** (deposits withdrawn, bonds issued by the bank)

---

## The Liquidity Gap

A **liquidity gap** is the difference between expected cash inflows and outflows
in each time period.

```
Time Period    Inflows      Outflows      Gap        Cumulative Gap
─────────────────────────────────────────────────────────────────
Overnight      500M         320M          +180M      +180M
1 Week         200M         350M          -150M      +30M
1 Month        100M         400M          -300M      -270M   ← concern
3 Months       150M         200M          -50M       -320M
6 Months       300M         150M          +150M      -170M
1 Year         400M         200M          +200M      +30M
```

A **negative cumulative gap** means the bank would run out of cash at that point
if nothing changes. This drives the need for LCR and NSFR monitoring.

---

## LCR — Liquidity Coverage Ratio

**What it measures:** Can the bank survive a 30-day stress scenario?

**Formula:**

```
LCR = Total HQLA (after haircuts) / Net stress cash outflows over 30 days × 100%
```

**Minimum requirement:** 100% (set by Basel III / BCBS 238)

**Example:**

```
Level 1 HQLA: $1,200M (cash + govvies, 0% haircut)
Level 2A HQLA: $200M × (1 - 15%) = $170M
Level 2B HQLA: $50M × (1 - 25%) = $37.5M (capped at 15% of total)
Total HQLA after haircuts = $1,407.5M

Net stress cash outflows over 30 days: $900M
LCR = $1,407.5M / $900M × 100% = 156.4%
```

LCR of 156.4% means the bank has 56.4% more liquidity than the minimum required.
NexusTreasury alerts when LCR drops below 110% (warning) or 100% (critical breach).

### HQLA Categories and Haircuts

| Level    | Examples                                                      | Haircut |
| -------- | ------------------------------------------------------------- | ------- |
| Level 1  | Cash, central bank deposits, sovereign bonds (0% risk weight) | 0%      |
| Level 2A | Agency securities, covered bonds (AA- or better), PSE bonds   | 15%     |
| Level 2B | Corporate bonds (BBB- to AA-), FTSE/S&P listed equities       | 25–50%  |

**Caps:** Total Level 2 assets ≤ 40% of HQLA. Level 2B ≤ 15% of HQLA.
NexusTreasury enforces these caps in `LCRCalculator.calculateWithHaircuts()`.

---

## NSFR — Net Stable Funding Ratio

**What it measures:** Does the bank have stable enough funding for the next 12 months?

**Formula:**

```
NSFR = Available Stable Funding (ASF) / Required Stable Funding (RSF) × 100%
```

**Minimum requirement:** 100% (set by Basel III / BCBS 295)

**Available Stable Funding** = funding that won't be withdrawn within 1 year:

- Tier 1 + Tier 2 capital: 100% weight
- Stable retail deposits (< 1 year): 95% weight
- Less stable retail deposits: 90% weight
- Wholesale funding (> 1 year): 100% weight

**Required Stable Funding** = how much stable funding each asset class needs:

- HQLA Level 1 (unencumbered): 0% weight
- Loans to non-financials (< 1 year): 50% weight
- Loans to non-financials (≥ 1 year): 85% weight

---

## ALM Scenarios

NexusTreasury calculates liquidity gaps under multiple scenarios:

| Scenario        | Description                                    | Use                    |
| --------------- | ---------------------------------------------- | ---------------------- |
| `CONTRACTUAL`   | Just what the contracts say — no stress        | Baseline               |
| `STRESSED_30D`  | Basel stress: 30 days of elevated outflows     | LCR calculation        |
| `STRESSED_90D`  | Extended stress: 90-day shock                  | Contingency planning   |
| `IDIOSYNCRATIC` | Bank-specific stress (credit rating downgrade) | Internal stress test   |
| `MARKET_WIDE`   | Systemic market stress (2008-style crisis)     | Regulatory stress test |

---

## Generating a Liquidity Gap Report

Reports are generated on demand via the API or on a scheduled basis.

```bash
curl -X POST http://localhost:4004/api/v1/alm/liquidity-gap \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "scenario": "STRESSED_30D",
    "currency": "USD",
    "asOfDate": "2026-04-07",
    "cashFlows": [...],
    "lcr": { "hqlaLevel1": 1200000000, ... },
    "nsfr": { "availableStableFunding": 2000000000, ... }
  }'
```

The `LiquidityGapReport` aggregate:

1. Calculates cash flow gaps for each BCBS time bucket
2. Calculates cumulative gaps
3. Applies HQLA haircuts and caps via `LCRCalculator`
4. Calculates LCR ratio and compliance flag
5. Calculates NSFR ratio and compliance flag
6. Emits `LiquidityGapReportGeneratedEvent`
7. If LCR < 100%, also emits `LCRBreachEvent`

---

## LCR Breach Alerts

When LCR drops below 100%, the following happens automatically:

1. `LCRBreachEvent` published to `nexus.alm.events` (Kafka)
2. Prometheus alert `LCRBelowMinimum` fires (severity: critical)
3. The ALM dashboard shows a red banner
4. Alert delivered to on-call via PagerDuty (if configured)

**This is a regulatory matter.** In most jurisdictions, a bank must:

- Notify the regulator within 24 hours
- Provide a remediation plan within 72 hours
- Restore LCR to 100%+ within 30 days

See [Runbook 04: LCR Breach Response](../runbooks/04-LCR-Breach-Response.md) for step-by-step actions.

---

## ALM Dashboard (web)

The `LiquidityDashboard` component at `packages/web/src/components/alm/LiquidityDashboard.tsx`
displays:

- **Current LCR ratio** with compliance indicator (green/amber/red)
- **Current NSFR ratio** with compliance indicator
- **Cash flow gap waterfall chart** across BCBS buckets
- **Cumulative gap line chart**
- **Historical LCR trend** (30-day rolling)

---

## Next Steps

**Next:** [Back Office and SWIFT Operations](./07-Back-Office-Operations.md)

You'll learn how trades are confirmed with counterparties, what SWIFT messages are,
and how the NexusTreasury auto-matching engine works.
