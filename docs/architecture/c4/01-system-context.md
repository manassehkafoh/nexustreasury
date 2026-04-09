# C4 Level 1 — System Context Diagram

**NexusTreasury** in relation to its users and external systems.

## Diagram

```mermaid
flowchart TB
  subgraph Users["👥 Users"]
    dealer["👤 Treasury Dealer\nCaptures FX/MM/IRS/Equity trades\nMonitors real-time P&L"]
    almMgr["👤 ALM Manager\nLiquidity gap, LCR/NSFR, IRRBB, FTP"]
    boOps["👤 Back Office Ops\nConfirmations, settlement, recon"]
    riskMgr["👤 Risk Manager\nVaR, limits, XVA, FRTB capital"]
    platEng["👤 Platform Engineer\nKubernetes, CI/CD, observability"]
    ciso["👤 CISO / Compliance\nAudit, SOC 2, security dashboards"]
  end

  subgraph NexusTreasury["🏦 NexusTreasury Platform"]
    NT["NexusTreasury\nCloud-Native TMS\nEvent-Driven · DDD · Kubernetes"]
  end

  subgraph External["🌐 External Systems"]
    bloomberg["📊 Bloomberg B-PIPE\nReal-time market data"]
    lseg["📊 LSEG Refinitiv\nVol surfaces, OIS curves"]
    coreBanking["🏛️ Core Banking\nT24 / Flexcube / SAP"]
    swift["📨 SWIFT Alliance\nMX ISO 20022 + legacy MT"]
    cls["🔄 CLS Bank\nFX settlement PvP"]
    ccp["⚙️ CCPs\nLCH / DTCC / Eurex"]
    etrading["💱 eFX Platforms\n360T / Tradeweb"]
    regRepos["📋 Trade Repositories\nDTCC / REGIS-TR"]
    keycloak["🔑 Keycloak\nOIDC / OAuth2 / MFA"]
  end

  dealer  -->|"Trade capture, pricing"| NT
  almMgr  -->|"ALM, liquidity, IRRBB"| NT
  boOps   -->|"Confirmations, settlement"| NT
  riskMgr -->|"VaR, limits, XVA"| NT
  platEng -->|"Deploy, monitor, debug"| NT
  ciso    -->|"Audit trail, compliance"| NT

  NT -->|"Pull market data (TCP/TLS B-PIPE)"| bloomberg
  NT -->|"Pull market data (TCP/TLS RMDS)"| lseg
  NT <-->|"Positions, balances, GL (REST/MQ)"| coreBanking
  NT <-->|"MX / MT messages (SWIFT HSM/TLS)"| swift
  NT <-->|"Settlement instructions (HTTPS)"| cls
  NT <-->|"Clearing, margin (FIX/HTTPS)"| ccp
  NT <-->|"Rates, orders, fills (FIX/REST)"| etrading
  NT -->|"Trade reporting EMIR/DFA (HTTPS)"| regRepos
  NT <-->|"Auth tokens, SSO (OIDC)"| keycloak
```

## Key Relationships

| Relationship       | Direction      | Protocol      | Frequency                   |
| ------------------ | -------------- | ------------- | --------------------------- |
| Bloomberg B-PIPE   | Inbound        | TCP/TLS       | Tick-by-tick (sub-ms)       |
| SWIFT MX/MT        | Bi-directional | SWIFT HSM/TLS | On-event                    |
| Core Banking       | Bi-directional | REST/MQ       | Batch (EOD) + events        |
| CLS Bank           | Bi-directional | HTTPS         | Settlement windows          |
| eFX Platforms      | Bi-directional | FIX/REST      | Real-time streaming         |
| Trade Repositories | Outbound       | HTTPS         | T+1 / near-real-time        |
| Keycloak           | Bi-directional | OIDC          | Per session / token refresh |

## Users and Roles

| User              | Primary Module   | Permissions                                 |
| ----------------- | ---------------- | ------------------------------------------- |
| Treasury Dealer   | Trading, Blotter | trade:write, position:read, marketdata:read |
| ALM Manager       | ALM, Liquidity   | alm:read, alm:write, position:read          |
| Back Office Ops   | Back Office      | bo:read, bo:write, settlement:approve       |
| Risk Manager      | Risk, Limits     | risk:read, limit:write, var:read            |
| Platform Engineer | Ops, Monitoring  | platform:admin, audit:read                  |
| CISO              | Audit, Security  | audit:read, compliance:read                 |
