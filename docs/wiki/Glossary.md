# Glossary

Definitions for treasury, regulatory, and technical terms used across NexusTreasury.
Terms are grouped by domain. Each entry links to deeper documentation where available.

---

## Treasury Terms

**Asset Class**
The category of financial instrument being traded. NexusTreasury supports:
`FX` (foreign exchange), `FIXED_INCOME` (bonds), `MONEY_MARKET` (short-term lending),
`INTEREST_RATE_DERIVATIVE` (IRS, caps, floors), `EQUITY`, `COMMODITY`, `REPO`, `ISLAMIC_FINANCE`.

**Back Office**
The operations team responsible for confirming trades with counterparties (via SWIFT),
managing settlement instructions, and reconciling Nostro accounts. Automated in
NexusTreasury via `bo-service`.

**Book**
A logical grouping of trades managed by a specific desk or trader. Risk limits can be
set at the book level (`LimitLevel.BOOK`).

**Counterparty**
The other institution on the other side of a trade. Pre-deal credit limits are
set per counterparty (`LimitType.COUNTERPARTY_CREDIT`).

**Front Office**
The trading desk. Traders book deals, request price quotes, and manage their books.
The Trading Blotter is the front-office interface in NexusTreasury.

**MTM (Mark-to-Market)**
Revaluing a position at current market prices. NexusTreasury recalculates MTM
whenever a new rate arrives on `nexus.marketdata.rates`.

**Notional**
The face value of a trade. For an FX deal of USD 12,500,000, the notional is
USD 12,500,000. Represented as `Money` in the domain model.

**Nostro Account**
A bank's account held at a correspondent bank in a foreign currency. Used for
international settlements. The settlement ladder in `bo-service` shows daily
Nostro flows by currency.

**Settlement**
The final exchange of cash and securities between counterparties. Trade moves to
`SETTLED` status after this step. Settlement date is typically T+2 for spot FX.

**STP (Straight-Through Processing)**
Automated processing of trades without manual intervention. NexusTreasury targets
≥ 95% STP for SWIFT confirmation matching.

**Trade Date**
The date on which a trade is agreed and booked. Stored as `BusinessDate`.

**Value Date**
The date on which settlement occurs. Must be on or after the trade date.

---

## Regulatory Terms

**Basel III / Basel IV**
International banking regulatory frameworks published by the Basel Committee on
Banking Supervision (BCBS). Basel III introduced LCR and NSFR. Basel IV
(formally "finalisation of Basel III") introduced FRTB.

**FRTB (Fundamental Review of the Trading Book)**
Basel Committee standard for market risk capital calculation. Distinguishes between
the trading book and banking book. NexusTreasury supports both SA (Standardised Approach)
and IMA (Internal Models Approach) frameworks.

**HQLA (High Quality Liquid Assets)**
Assets that can be quickly converted to cash in a stress scenario.

- Level 1: Cash, central bank deposits, sovereign bonds (0% haircut)
- Level 2A: Agency securities, covered bonds (15% haircut)
- Level 2B: Corporate bonds, equities (25–50% haircut)

**IRRBB (Interest Rate Risk in the Banking Book)**
Risk from changes in interest rates affecting the bank's banking book.
Governed by BCBS 368.

**LCR (Liquidity Coverage Ratio)**
`LCR = Total HQLA after haircuts / Net stress cash outflows over 30 days`
Minimum requirement: 100%. Regulated by BCBS 238.

**NSFR (Net Stable Funding Ratio)**
`NSFR = Available Stable Funding / Required Stable Funding`
Minimum requirement: 100%. Regulated by BCBS 295.

**EMIR (European Market Infrastructure Regulation)**
EU regulation requiring central clearing and reporting of OTC derivatives.

**Dodd-Frank**
US financial reform law with similar requirements to EMIR for OTC derivatives.

**SOC 2 Type II**
Security audit standard. NexusTreasury maintains SOC 2 evidence via `security-patch.yml`
(automated CVE patching with audit trail).

**Time Bucket**
Basel-defined time horizon for cash flow analysis:
`OVERNIGHT` → `ONE_WEEK` → `TWO_WEEKS` → `ONE_MONTH` → `THREE_MONTHS` →
`SIX_MONTHS` → `ONE_YEAR` → `TWO_TO_FIVE_YEARS` → `OVER_FIVE_YEARS`

**VaR (Value at Risk)**
Statistical measure of the potential loss in portfolio value.
NexusTreasury reports 1-day 99% VaR using historical simulation.

---

## Technical Terms

**Aggregate (DDD)**
A cluster of domain objects treated as a single unit with a clear boundary.
In NexusTreasury: `Trade`, `Position`, `Limit`, `LiquidityGapReport`.
All changes go through the aggregate's methods — never direct field mutation.

**Bounded Context (DDD)**
A logical boundary within which a specific domain model applies.
NexusTreasury has four: Trading, Position, Risk, ALM.

**Brand / Branded Type**
A TypeScript pattern to make primitive types type-safe.
`TradeId` and `PositionId` are both `string` at runtime, but TypeScript
treats them as incompatible at compile time.

**Domain Event**
An immutable record of something that happened in the domain.
Events are the primary communication mechanism between bounded contexts.

**Event Outbox Pattern**
Persisting domain events to the same database transaction as the aggregate state,
then publishing them to Kafka in a separate process. Ensures events are never lost
even if Kafka is temporarily unavailable.

**Event-Sourced**
A pattern where the current state is derived by replaying a sequence of past events.
The Position aggregate uses a hybrid approach: event-sourced update logic, but
snapshot persistence for query performance.

**HPA (Horizontal Pod Autoscaler)**
Kubernetes mechanism that automatically scales the number of pod replicas based on CPU or
custom metrics. All NexusTreasury services use HPA with min 3 / max 20 replicas in production.

**Idempotent Producer**
A Kafka producer configuration that prevents duplicate messages if a network error causes
a retry. All NexusTreasury Kafka producers are idempotent (`idempotent: true`).

**Invariant**
A business rule that must always be true. Violations throw a `DomainError`.
Example: "A trade's value date must be on or after the trade date."

**Repository Pattern**
An abstraction that isolates the domain from the database. The domain defines
`TradeRepository` as an interface; `PrismaTradeRepository` implements it.
The domain never imports Prisma.

**Workspace (pnpm)**
A collection of packages managed together in a monorepo. All NexusTreasury packages
are declared in `pnpm-workspace.yaml` under the `packages/*` glob.

**SWIFT MT (Message Type)**
The legacy SWIFT financial messaging format. Text-based, using colon-prefixed field tags.
Example: `:20:FX-20260407-A3B2C1` (reference field), `:32B:USD12500000,` (amount).
Message types are numbered: MT300 (FX), MT940 (statement), MT103 (payment).
Still accepted during SWIFT's MT-to-MX coexistence period (until November 2028).

**SWIFT MX (Message XML)**
The current ISO 20022-based SWIFT messaging format. XML-structured with full namespace
declarations. The `MX` label stands for Message XML.
Example: `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.009.001.10">...`
MX message names follow the pattern: `{category}.{number}` (e.g. pacs.009, fxtr.008, camt.053).
**ISO 20022 = MX. MT is the legacy format. They are completely different wire formats.**

**Zero Trust**
A network security model where no traffic is trusted by default.
NexusTreasury uses Cilium eBPF with default-deny-all network policies in Kubernetes.
