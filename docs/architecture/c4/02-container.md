# C4 Level 2 — Container Diagram

All deployable units within the NexusTreasury platform boundary.

## Diagram

```mermaid
C4Container
  title NexusTreasury — Container Diagram

  Person(dealer,   "Treasury Dealer")
  Person(boOps,    "Back Office Ops")
  Person(riskMgr,  "Risk Manager")

  System_Ext(bloomberg, "Bloomberg B-PIPE")
  System_Ext(swift,     "SWIFT Alliance")
  System_Ext(coreBanking, "Core Banking")

  Container_Boundary(fe, "Frontend Layer") {
    Container(webApp, "Next.js Web App", "Next.js 15 / React 18 / TypeScript",
      "Server-side rendered dealing room UI. Real-time blotter via WebSocket. Tailwind CSS.")
  }

  Container_Boundary(gateway, "API Gateway Layer") {
    Container(apiGW, "API Gateway", "Kong / Nginx Ingress Controller",
      "TLS termination, OAuth2 JWT validation, rate limiting (Redis), WAF, request routing.")
  }

  Container_Boundary(services, "Microservices — Bounded Contexts") {
    Container(tradeSvc,      "Trade Service",        "Node.js 24 / TypeScript / Fastify",
      "FX/MM/IRS/Equity trade capture. Pre-deal limit checks. REST + WebSocket. Port 4001.")
    Container(positionSvc,   "Position Service",     "Node.js 24 / TypeScript / Fastify",
      "Event-sourced real-time position and P&L engine. Kafka consumer. Port 4002.")
    Container(riskSvc,       "Risk Service",         "Node.js 24 / TypeScript / Fastify",
      "VaR (Historical/Monte Carlo), FRTB SA/IMA, XVA, counterparty exposure. Port 4003.")
    Container(almSvc,        "ALM Service",          "Node.js 24 / TypeScript / Fastify",
      "LCR/NSFR (BCBS 238/295), IRRBB (BCBS 368), liquidity gap, FTP engine. Port 4004.")
    Container(boSvc,         "Back Office Service",  "Node.js 24 / TypeScript / Fastify",
      "SWIFT MX (ISO 20022) parser/matcher, confirmation, settlement, nostro recon. Port 4005.")
    Container(mdSvc,         "Market Data Service",  "Node.js 24 / TypeScript / Fastify",
      "Bloomberg/LSEG adapter, yield curve builder, volatility surface publisher. Port 4006.")
    Container(authSvc,       "Auth Service",         "Keycloak 24 / OIDC / OAuth2",
      "SSO, MFA, JWT issuance, RBAC roles, token introspection. Port 8080.")
    Container(auditSvc,      "Audit Service",        "Node.js 24 / TypeScript",
      "Immutable audit log consumer. HMAC checksums. SOC 2 evidence. Streams to Elasticsearch.")
    Container(notifSvc,      "Notification Service", "Node.js 24 / TypeScript",
      "Limit breach alerts, settlement failures, email/webhook/WebSocket push.")
    Container(accountingSvc, "Accounting Service",   "Node.js 24 / TypeScript",
      "IFRS9 classification, hedge accounting, journal entries, GL feed.")
    Container(platformMgmt,  "Platform Management",  "Node.js 24 / TypeScript",
      "Multi-tenant config, RBAC administration, feature flags.")
  }

  Container_Boundary(eventBus, "Event Bus") {
    Container(kafka, "Apache Kafka", "Kafka 3.7 + Confluent Schema Registry",
      "13 topics. 24-48 partitions each. 3x replication. Exactly-once semantics.")
  }

  Container_Boundary(data, "Data Stores") {
    ContainerDb(postgres,   "PostgreSQL 16",   "PostgreSQL + Patroni HA + TimescaleDB",
      "Primary OLTP store. Patroni 3-node HA. Per-bounded-context schemas. Read replicas.")
    ContainerDb(redis,      "Redis Cluster",   "Redis 7 Cluster",
      "API rate limiting, session store, market data cache. 3-node cluster.")
    ContainerDb(elastic,    "Elasticsearch",   "Elasticsearch 8",
      "Audit log index, full-text trade search, log aggregation.")
    ContainerDb(s3,         "Object Storage",  "S3-compatible (MinIO/AWS S3)",
      "Regulatory reports, SWIFT message archives, document attachments.")
  }

  Container_Boundary(obs, "Observability Stack") {
    Container(prometheus, "Prometheus",     "Prometheus 2 + Alertmanager", "Metrics collection and alerting.")
    Container(grafana,    "Grafana",        "Grafana 10",                  "Dashboards: P&L, risk, infra, SLOs.")
    Container(elk,        "ELK Stack",      "Logstash + Kibana 8",         "Structured log aggregation and search.")
    Container(jaeger,     "Jaeger",         "Jaeger 1.x + OpenTelemetry",  "Distributed tracing end-to-end.")
  }

  Container_Boundary(sec, "Security Infrastructure") {
    Container(vault,  "HashiCorp Vault", "Vault 1.16", "Dynamic secrets, PKI cert rotation, KMS, database credentials.")
    Container(opa,    "OPA",             "Open Policy Agent 0.65", "Policy-as-code: RBAC, data access, API authz.")
    Container(trivy,  "Trivy",           "Trivy 0.50",  "Container CVE scanning in CI/CD and runtime.")
  }

  Rel(dealer,   webApp, "HTTPS/WSS", "443")
  Rel(boOps,    webApp, "HTTPS",     "443")
  Rel(riskMgr,  webApp, "HTTPS",     "443")
  Rel(webApp,   apiGW,  "HTTPS/WSS", "443")
  Rel(apiGW,    authSvc,"JWT verify", "OIDC")
  Rel(apiGW,    tradeSvc,      "REST", "HTTP/2")
  Rel(apiGW,    positionSvc,   "REST", "HTTP/2")
  Rel(apiGW,    riskSvc,       "REST", "HTTP/2")
  Rel(apiGW,    almSvc,        "REST", "HTTP/2")
  Rel(apiGW,    boSvc,         "REST", "HTTP/2")
  Rel(apiGW,    platformMgmt,  "REST", "HTTP/2")

  Rel(tradeSvc,      kafka, "Publish TradeCreated/Amended/Cancelled", "PLAINTEXT/SASL")
  Rel(positionSvc,   kafka, "Subscribe TradeCreated; Publish PositionUpdated", "PLAINTEXT/SASL")
  Rel(riskSvc,       kafka, "Subscribe PositionUpdated, RateUpdated", "PLAINTEXT/SASL")
  Rel(almSvc,        kafka, "Subscribe PositionUpdated, CashFlowUpdated", "PLAINTEXT/SASL")
  Rel(boSvc,         kafka, "Subscribe TradeCreated; Publish ConfirmationReceived", "PLAINTEXT/SASL")
  Rel(mdSvc,         kafka, "Publish RateUpdated, YieldCurveUpdated", "PLAINTEXT/SASL")
  Rel(accountingSvc, kafka, "Subscribe TradeCreated; Publish JournalEntry", "PLAINTEXT/SASL")
  Rel(auditSvc,      kafka, "Subscribe ALL topics", "PLAINTEXT/SASL")
  Rel(notifSvc,      kafka, "Subscribe LimitBreach, SettlementFailure", "PLAINTEXT/SASL")

  Rel(tradeSvc,      postgres, "Trades, Books, Counterparties", "pg-wire")
  Rel(positionSvc,   postgres, "Position events, snapshots",    "pg-wire")
  Rel(riskSvc,       postgres, "Limits, VaR results",           "pg-wire")
  Rel(almSvc,        postgres, "Gap reports, LCR results",      "pg-wire")
  Rel(boSvc,         postgres, "Confirmations, settlements",    "pg-wire")
  Rel(accountingSvc, postgres, "Journal entries",               "pg-wire")
  Rel(authSvc,       postgres, "Users, sessions",               "pg-wire")
  Rel(tradeSvc,      redis,    "Market data cache",             "Redis protocol")
  Rel(apiGW,         redis,    "Rate limit counters",           "Redis protocol")
  Rel(authSvc,       redis,    "Session cache",                 "Redis protocol")
  Rel(auditSvc,      elastic,  "Audit log index",               "HTTP REST")
  Rel(boSvc,         s3,       "SWIFT message archive",         "S3 API")
  Rel(bloomberg,     mdSvc,    "Tick data (B-PIPE)",            "TCP/TLS")
  Rel(swift,         boSvc,    "MX/MT messages",                "SWIFT HSM/TLS")
  Rel(coreBanking,   tradeSvc, "Account data, balances",        "REST/MQ")
```

## Container Inventory

| Container               | Port      | Language   | Dependencies                     |
| ----------------------- | --------- | ---------- | -------------------------------- |
| Next.js Web App         | 3000      | TypeScript | domain, React, Tailwind          |
| Trade Service           | 4001      | TypeScript | domain, Kafka, PostgreSQL, Redis |
| Position Service        | 4002      | TypeScript | domain, Kafka, PostgreSQL        |
| Risk Service            | 4003      | TypeScript | domain, Kafka, PostgreSQL        |
| ALM Service             | 4004      | TypeScript | domain, Kafka, PostgreSQL        |
| Back Office Service     | 4005      | TypeScript | domain, Kafka, PostgreSQL, S3    |
| Market Data Service     | 4006      | TypeScript | domain, Kafka, Bloomberg/LSEG    |
| Auth Service (Keycloak) | 8080      | Java       | PostgreSQL, Redis                |
| Kafka                   | 9092/9093 | JVM        | ZooKeeper / KRaft                |
| PostgreSQL              | 5432      | C          | Patroni (HA)                     |
| Redis                   | 6379      | C          | Cluster mode                     |
| Elasticsearch           | 9200      | JVM        | —                                |
