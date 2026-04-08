# Learner Guide 1: What Is a Treasury Management System?

**Who this is for:** Everyone — engineers, product managers, compliance officers,
and business analysts new to treasury technology.

**What you'll learn:** What a TMS does, why it exists, and how NexusTreasury fits
into a bank's technology landscape.

---

## What Problem Does a TMS Solve?

A bank's treasury department manages the bank's own money — its cash, investments,
funding, foreign exchange positions, and compliance with liquidity regulations.

Without a TMS, treasury operations look like this:

- Traders phone or email deals to counterparties
- Back-office teams manually key trades into spreadsheets
- Risk managers calculate exposure in Excel
- Compliance teams manually produce LCR and NSFR reports

The problems are obvious: errors, delays, missing audit trails, and no real-time
view of the bank's overall position or risk.

A **Treasury Management System (TMS)** automates this workflow from end to end:

```
Deal agreed ──► Book trade ──► Pre-deal check ──► Confirm with cpty
                                                        │
            Position updates ◄───── SWIFT match ◄──────┘
                  │
            MTM revaluation ──► Risk reports ──► LCR/NSFR reports
```

---

## Core Functions of a TMS

### 1. Trade Capture

The trader enters a deal into the system: asset class, direction (buy/sell),
counterparty, notional amount, price, and settlement date.

The TMS validates the deal (is the counterparty within limits? is the date valid?)
and creates a trade record.

### 2. Pre-Deal Risk Controls

Before the trade is booked, the system checks whether it would breach any limits:

- **Counterparty credit limits** — how much can I lend to / trade with this bank?
- **Book limits** — how much risk can this desk carry?
- **Trader limits** — how much can one person trade?

If a limit would be breached, the trade is rejected. This protects the bank from
accidentally taking on too much exposure.

### 3. Position Keeping

A "position" is the net amount of an instrument or currency that the bank owns.

If the bank buys USD 10M and later buys another USD 5M, the position is +USD 15M.
If it then sells USD 3M, the position is +USD 12M.

The TMS tracks this automatically for every instrument in every book.

### 4. Mark-to-Market (MTM) Revaluation

Market prices change constantly. MTM revaluation recalculates the current market
value of every position using the latest prices.

This tells the bank: "If we closed all our positions right now, would we make or
lose money — and how much?"

### 5. Back Office and Settlement

After a trade is confirmed with the counterparty (via SWIFT messages),
the back office generates settlement instructions — telling the correspondent banks
to move the actual cash on the settlement date.

### 6. Regulatory Reporting

Banks must report their liquidity position to regulators daily:

- **LCR** — do we have enough liquid assets to survive 30 days of stress?
- **NSFR** — is our funding structure stable over the next year?

The TMS calculates and stores these ratios automatically.

---

## Where NexusTreasury Fits

NexusTreasury is designed as a **modern replacement** for legacy TMS platforms
like Calypso, Murex, or Finastra Kondor. These platforms were built in the 1990s–2000s,
are expensive to maintain, and cannot scale to modern cloud infrastructure.

NexusTreasury takes the same functions but reimplements them as:

- Microservices (each function is an independent, scalable service)
- Event-driven (changes propagate via Kafka, not database polling)
- Cloud-native (runs on Kubernetes, scales to demand)
- API-first (every function is accessible via REST and WebSocket)

---

## The Actors in the System

| Actor                | Role                              | Uses                              |
| -------------------- | --------------------------------- | --------------------------------- |
| Trader               | Books deals, manages books        | Trading Blotter                   |
| Risk Manager         | Sets and monitors limits          | Risk dashboards, limit management |
| ALM Analyst          | Manages liquidity and funding     | LCR/NSFR reports, gap analysis    |
| Back Office Operator | Confirms trades, settles          | SWIFT matching, settlement ladder |
| Compliance Officer   | Ensures regulatory compliance     | LCR/NSFR reports, audit trails    |
| Systems Engineer     | Builds and maintains the platform | Code, CI/CD, Kubernetes           |

---

## Next Steps

You now understand why a TMS exists and what NexusTreasury does.

**Next:** [Trade Lifecycle — From Booking to Settlement](./02-Trade-Lifecycle.md)

This guide will walk you through a complete trade from the moment a trader enters it
to the moment cash moves between banks.
