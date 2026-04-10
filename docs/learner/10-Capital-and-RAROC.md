# Module 10 — Capital Adequacy and RAROC

## Why does capital management matter?

Regulators require banks to hold capital as a buffer against unexpected losses. The Basel III framework defines three capital tiers and mandates minimum ratios. Understanding capital is essential for anyone working in treasury risk or planning.

---

## Basel III capital ratios

```
CET1 Ratio = Common Equity Tier 1 / Risk-Weighted Assets  (minimum: 4.5% + buffers)
Total Capital Ratio = (CET1 + AT1 + T2) / RWA             (minimum: 8% + buffers)
Leverage Ratio = Tier 1 Capital / Total Exposure            (minimum: 3%)
```

**RWA** (Risk-Weighted Assets) is not the same as total assets. Each asset is multiplied by its risk weight:

| Asset | Typical SA risk weight |
|---|---|
| OECD sovereign | 0% |
| Residential mortgage | 35% |
| Corporate loan (investment grade) | 100% |
| Sub-investment grade | 150% |

---

## Capital Stress Testing (Sprint 10-A)

The `CapitalStressTester` runs five EBA-calibrated scenarios simultaneously:

| Scenario | GDP shock | Rate shift | Equity shock |
|---|---|---|---|
| BASELINE | −0.5pp | +50bp | −5% |
| ADVERSE | −2.5pp | +300bp | −30% |
| SEVERELY_ADVERSE | −5.0pp | +500bp | −50% |
| IDIOSYNCRATIC | −1.0pp | +100bp | −20% |
| COMBINED | −4.0pp | +400bp | −45% |

For each scenario it calculates **stressed CET1**, **stressed RWA**, and — critically — **survival horizon**: the number of days before capital would hit the regulatory floor under the scenario's daily burn rate.

---

## RAROC — Risk-Adjusted Return on Capital

RAROC answers the question: "Is this business unit generating adequate return for the risk it takes?"

```
RAROC = Net Contribution / Economic Capital

Net Contribution = Gross Revenue − Direct Costs − FTP Charge + FTP Credit − Expected Loss
Economic Capital = RWA × 8% × (1 + stress buffer)
```

NexusTreasury's `RAROCEngine` computes RAROC across five dimensions:
- Business unit
- Customer (relationship-level)
- Product
- Trader
- Geography / legal entity

A RAROC below the **hurdle rate** (10% default) means the activity is destroying value on a risk-adjusted basis.

**EVA bps** = (RAROC − Cost of Capital) × 10,000 — positive means value is being created.

---

## COREP Capital Reporting (Sprint 10.1)

The `COREPEngine` generates EBA COREP C 01.00 output:

1. Credit Risk SA: `(Gross Exposure − CRM) × Risk Weight`
2. Market Risk FRTB SA: `|Sensitivity| × Risk Weight × 12.5`
3. Op Risk SMA: `(BIC component + Loss component) × 12.5`
4. Combined buffer: Conservation 2.5% + CCyB + G-SIB + SREP add-on

---

## Key files

- `packages/risk-service/src/application/capital-stress-tester.ts`
- `packages/reporting-service/src/application/raroc-engine.ts`
- `packages/reporting-service/src/application/corep-engine.ts`
