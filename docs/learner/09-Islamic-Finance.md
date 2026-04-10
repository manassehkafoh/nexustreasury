# Module 9 — Islamic Finance in NexusTreasury

## What makes Islamic finance different?

Conventional treasury instruments earn return through interest (_riba_). Islamic finance prohibits _riba_ entirely. Instead, return is generated through **profit-sharing, lease income, or cost-plus-profit arrangements**, all backed by real economic activity or assets.

NexusTreasury implements the two most common structures used by Gulf, Malaysian, and African Islamic banks.

---

## Ijara Sukuk (lease-backed)

An Ijara Sukuk works like a bond but the coupon is replaced by **rental income (ujrah)** from a leased asset owned by an SPV:

```
Issuer (Bank) → transfers asset to SPV
SPV → issues Sukuk certificates to investors
SPV → leases asset back to bank (Ijara contract)
Bank → pays periodic rent → SPV → distributes to certificate holders
At maturity: bank buys back asset at agreed purchase price
```

The `SukukPricer` prices the cash flow stream identically to a conventional bond, but labels the return as `profitRate` not `yield`, and references AAOIFI FAS 28.

**Key formula:**

```
P = Σ (rental_i × e^(-r·tᵢ)) + FaceValue × e^(-r·T)
```

Basel III capital charge under IFSB-7: 20% risk weight for investment-grade Sukuk.

---

## Commodity Murabaha (cost-plus-profit)

A bank buys a commodity (LME Copper, Aluminium, Gold) and immediately re-sells it to a customer at **cost + agreed profit**, payable on deferred terms. The customer can optionally sell the commodity for immediate cash (Tawarruq).

```
Day 0:  Bank buys Copper at USD 9,450/tonne from Broker A
Day 0:  Bank sells same Copper to Customer at USD 9,450 + USD 520 profit
Day 365: Customer pays USD 9,970 to Bank
(Optional) Customer sells Copper to Broker B at spot for immediate cash
```

AAOIFI Standard 17 requires **simple profit, no compounding**.

---

## IFRS9 classification

| Instrument  | IFRS9          | Reason                               |
| ----------- | -------------- | ------------------------------------ |
| Murabaha    | Amortised Cost | Fixed cash flows, held-to-collect    |
| Ijara Sukuk | FVOCI          | Held for both collecting and selling |
| Mudaraba    | FVPL           | Equity-like profit/loss sharing      |

Stage assignment uses **Days Past Profit (DPP)** — the Islamic equivalent of DPD:

| DPP                    | Stage   | ECL horizon |
| ---------------------- | ------- | ----------- |
| 0–29                   | Stage 1 | 12-month PD |
| 30–89                  | Stage 2 | Lifetime PD |
| ≥ 90 or non-performing | Stage 3 | Lifetime PD |

---

## Key files

- `packages/domain/src/pricing/sukuk-pricer.ts` — Ijara + Murabaha Sukuk pricing
- `packages/domain/src/pricing/murabaha-lifecycle.ts` — Commodity Murabaha lifecycle
- `packages/accounting-service/src/application/islamic-ifrs9.ts` — IFRS9 extension
