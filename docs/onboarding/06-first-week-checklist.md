# Day 5 — First-Week Checklist

By the end of your first week, you should be able to check every item below. If anything is blocked, raise it with your buddy engineer immediately.

---

## Environment ✓

- [ ] `pnpm build` completes with `14 successful, 14 total`
- [ ] `pnpm test` shows 819+ tests, 0 failures
- [ ] `pnpm audit --prod` shows `No known vulnerabilities found`
- [ ] VS Code opens with no red TypeScript errors in any package
- [ ] DevContainer starts without errors (optional but recommended)

## Architecture understanding ✓

- [ ] Can name the 14 packages and their ports from memory
- [ ] Understand why services communicate via Kafka events, not HTTP
- [ ] Know the difference between `domain/` (shared kernel) and a service package
- [ ] Read at least one ADR in `docs/adr/` from start to finish
- [ ] Can explain the bounded context rule: "Never import from one service into another"

## Code ✓

- [ ] Opened and read `packages/domain/src/pricing/pricing-engine.ts`
- [ ] Opened and read `packages/domain/src/risk/limit.aggregate.ts`
- [ ] Read one test file end-to-end (suggest: `packages/domain/src/pricing/platform-health.test.ts`)
- [ ] Added one test to any package (even a trivial one) and watched it pass

## First PR ✓

- [ ] Branched from `main` with format `feat/your-name/short-description`
- [ ] PR passes all CI checks (build + test + audit)
- [ ] PR includes an updated C4 component diagram if you added a new component
- [ ] PR has been reviewed and approved by at least one team member

## Domain knowledge ✓

- [ ] Read `docs/learner/01-What-Is-a-TMS.md` through `03-DDD-in-NexusTreasury.md`
- [ ] Understand the IFRS9 Stage 1/2/3 classification (see `05-Risk-Management.md`)
- [ ] Know what LCR and NSFR measure (see `06-ALM-and-Liquidity.md`)

---

## Glossary of key abbreviations

| Term | Meaning |
|---|---|
| TMS | Treasury Management System |
| ALM | Asset-Liability Management |
| IRRBB | Interest Rate Risk in the Banking Book |
| LCR | Liquidity Coverage Ratio (BCBS 30-day stress) |
| NSFR | Net Stable Funding Ratio (1-year structural liquidity) |
| FTP | Funds Transfer Pricing (internal cost of funds) |
| ECL | Expected Credit Loss (IFRS9) |
| RAROC | Risk-Adjusted Return on Capital |
| COREP | Common Reporting (Basel III capital adequacy) |
| FINREP | Financial Reporting (EBA balance sheet / P&L) |
| STP | Straight-Through Processing (zero-touch automation) |
| DV01 | Dollar Value of 1 basis point (rate sensitivity) |
| VaR | Value at Risk (market risk metric) |
| XVA | Valuation Adjustments (CVA/DVA/FVA) |
| UETR | Unique End-to-end Transaction Reference (SWIFT gpi) |
| CBPR+ | Cross-Border Payments and Reporting Plus (SWIFT ISO 20022) |
| SSE | Server-Sent Events (push-based streaming to browser) |
| RAG | Retrieval-Augmented Generation (AI pattern) |

---

## Key contacts

| Role | Area |
|---|---|
| Platform lead | Architecture decisions, ADRs |
| Domain lead | Business logic, DDD aggregates |
| Security lead | CVE triage, Keycloak, zero-trust |
| QA lead | Test strategy, k6 performance targets |

---

## Where to find things

| Need | Location |
|---|---|
| OpenAPI spec | `docs/api/openapi.yaml` |
| AsyncAPI (Kafka events) | `docs/api/asyncapi.yaml` |
| ADR index | `docs/adr/README.md` |
| C4 diagrams | `docs/architecture/c4/` |
| Learner modules | `docs/learner/` |
| Runbooks | `docs/runbooks/` |
| Postman collection | `docs/NexusTreasury_API_Collection.postman_collection.json` |
