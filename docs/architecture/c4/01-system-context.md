# C4 Level 1 — System Context Diagram

**NexusTreasury** in relation to its users and external systems.

## Diagram

```mermaid
C4Context
  title NexusTreasury — System Context

  Person(dealer,        "Treasury Dealer",       "Captures FX, MM, IRS, Equity trades. Monitors real-time P&L.")
  Person(almMgr,        "ALM Manager",           "Manages liquidity gap, LCR/NSFR, IRRBB, FTP pricing.")
  Person(boOps,         "Back Office Ops",       "Processes confirmations, settlement instructions, nostro recon.")
  Person(riskMgr,       "Risk Manager",          "Monitors VaR, counterparty limits, XVA, FRTB capital.")
  Person(platEng,       "Platform Engineer",     "Manages Kubernetes, CI/CD, GitOps, observability.")
  Person(ciso,          "CISO / Compliance",     "Reviews audit logs, SOC 2 evidence, security dashboards.")

  System(nexus,         "NexusTreasury",         "Cloud-native, event-driven Treasury Management System. Handles trade capture, position management, risk, ALM, back office, and regulatory reporting.")

  System_Ext(bloomberg, "Bloomberg B-PIPE",      "Real-time FX, MM, and fixed income market data feed.")
  System_Ext(lseg,      "LSEG Refinitiv",        "Alternative market data feed; volatility surfaces.")
  System_Ext(coreBanking,"Core Banking System",  "T24 / Flexcube / SAP — account balances, customer data, GL.")
  System_Ext(swift,     "SWIFT Alliance",        "MX (ISO 20022) and legacy MT financial messaging network.")
  System_Ext(cls,       "CLS Bank",              "FX settlement netting; payment-versus-payment (PvP).")
  System_Ext(ccp,       "CCPs (LCH/DTCC/Eurex)", "Cleared derivatives — margin calls, position reporting.")
  System_Ext(etrading,  "eFX Platforms (360T/Tradeweb)", "Electronic trading — streaming rates, order routing.")
  System_Ext(regRepos,  "Trade Repositories (DTCC/REGIS-TR)", "EMIR/Dodd-Frank trade reporting.")
  System_Ext(keycloak,  "Keycloak (OIDC/OAuth2)", "Identity provider — SSO, MFA, JWT issuance.")

  Rel(dealer,     nexus, "Trade capture, pricing, blotter", "HTTPS/WebSocket")
  Rel(almMgr,     nexus, "Liquidity, IRRBB, gap report",    "HTTPS")
  Rel(boOps,      nexus, "Confirmations, settlement",        "HTTPS")
  Rel(riskMgr,    nexus, "VaR, limits, XVA",                "HTTPS")
  Rel(platEng,    nexus, "Deploy, monitor, debug",           "kubectl/ArgoCD")
  Rel(ciso,       nexus, "Audit trail, compliance reports",  "HTTPS")

  Rel(nexus, bloomberg,   "Pull market data",            "TCP/TLS B-PIPE")
  Rel(nexus, lseg,        "Pull market data",            "TCP/TLS RMDS")
  BiRel(nexus, coreBanking,"Positions, balances, GL",    "REST/MQ")
  BiRel(nexus, swift,     "MX/MT messages",              "SWIFT HSM/TLS")
  BiRel(nexus, cls,       "Settlement instructions",     "HTTPS")
  BiRel(nexus, ccp,       "Clearing messages, margin",   "FIX/HTTPS")
  BiRel(nexus, etrading,  "Rates, orders, fills",        "FIX/REST")
  Rel(nexus, regRepos,    "Trade reporting (EMIR/DFA)",  "HTTPS")
  Rel(nexus, keycloak,    "Auth tokens, user identity",  "OIDC")
```

## Key Relationships

| Relationship       | Direction                   | Protocol      | Frequency                   |
| ------------------ | --------------------------- | ------------- | --------------------------- |
| Bloomberg B-PIPE   | Inbound to NexusTreasury    | TCP/TLS       | Tick-by-tick (sub-ms)       |
| SWIFT MX/MT        | Bi-directional              | SWIFT HSM/TLS | On-event                    |
| Core Banking       | Bi-directional              | REST/MQ       | Batch (EOD) + events        |
| CLS Bank           | Bi-directional              | HTTPS         | Settlement windows          |
| eFX Platforms      | Bi-directional              | FIX/REST      | Real-time streaming         |
| Trade Repositories | Outbound from NexusTreasury | HTTPS         | T+1 / near-real-time        |
| Keycloak           | Bi-directional              | OIDC          | Per session / token refresh |

## Users and Roles

| User              | Primary Module   | Permissions                                 |
| ----------------- | ---------------- | ------------------------------------------- |
| Treasury Dealer   | Trading, Blotter | trade:write, position:read, marketdata:read |
| ALM Manager       | ALM, Liquidity   | alm:read, alm:write, position:read          |
| Back Office Ops   | Back Office      | bo:read, bo:write, settlement:approve       |
| Risk Manager      | Risk, Limits     | risk:read, limit:write, var:read            |
| Platform Engineer | Ops, Monitoring  | platform:admin, audit:read                  |
| CISO              | Audit, Security  | audit:read, compliance:read                 |
