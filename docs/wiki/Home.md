# NexusTreasury Platform Wiki

Welcome to the NexusTreasury knowledge base. This wiki is the single source of truth for
everyone who builds, operates, tests, or uses the platform — engineers, QA analysts,
product managers, compliance officers, and treasury practitioners alike.

---

## 📚 Wiki Sections

### For Engineers

| Document                                                    | What it covers                             |
| ----------------------------------------------------------- | ------------------------------------------ |
| [Platform Overview](./Platform-Overview.md)                 | Architecture, services, data flow          |
| [Domain Model Deep Dive](./Domain-Model-Deep-Dive.md)       | Aggregates, value objects, events          |
| [API Reference](./API-Reference.md)                         | All endpoints with examples                |
| [Kafka Event Reference](./Kafka-Event-Reference.md)         | Every topic, event type, payload schema    |
| [Database Schema Reference](./Database-Schema-Reference.md) | All tables, indexes, schema isolation      |
| [Configuration Reference](./Configuration-Reference.md)     | Every env var, feature flag, config option |

### For Operators & DevOps

| Document                                        | What it covers                        |
| ----------------------------------------------- | ------------------------------------- |
| [Deployment Guide](./Deployment-Guide.md)       | Kubernetes, ArgoCD, release process   |
| [Observability Guide](./Observability-Guide.md) | Grafana, Prometheus alerts, tracing   |
| [Runbooks](../runbooks/README.md)               | Step-by-step incident response        |
| [Security Guide](./Security-Guide.md)           | Vault, Keycloak, Cilium, CVE patching |

### For QA & Testers

| Document                                  | What it covers                        |
| ----------------------------------------- | ------------------------------------- |
| [Testing Strategy](./Testing-Strategy.md) | Unit, integration, E2E pyramid        |
| [Test Data Guide](./Test-Data-Guide.md)   | Seed data, fixture factories, Postman |

### For Product & Compliance

| Document                                            | What it covers                            |
| --------------------------------------------------- | ----------------------------------------- |
| [Regulatory Compliance](./Regulatory-Compliance.md) | Basel III/IV, LCR, NSFR, FRTB, EMIR       |
| [Glossary](./Glossary.md)                           | Treasury, regulatory, and technical terms |
| [FAQ](./FAQ.md)                                     | Common questions from all audiences       |

---

## 🎓 Learner Paths

If you are new to treasury technology or to this specific codebase, work through
the learner guides in order:

| Step | Guide                                                                            | Audience  |
| ---- | -------------------------------------------------------------------------------- | --------- |
| 1    | [What is a Treasury Management System?](../learner/01-What-Is-a-TMS.md)          | All       |
| 2    | [Trade Lifecycle — From Booking to Settlement](../learner/02-Trade-Lifecycle.md) | All       |
| 3    | [Domain-Driven Design in NexusTreasury](../learner/03-DDD-in-NexusTreasury.md)   | Engineers |
| 4    | [Position Keeping Explained](../learner/04-Position-Keeping.md)                  | All       |
| 5    | [Risk Management and Limit Controls](../learner/05-Risk-Management.md)           | All       |
| 6    | [Asset-Liability Management (ALM)](../learner/06-ALM-and-Liquidity.md)           | All       |
| 7    | [Back Office and SWIFT Operations](../learner/07-Back-Office-Operations.md)      | All       |
| 8    | [Building on NexusTreasury](../learner/08-Building-on-NexusTreasury.md)          | Engineers |

---

## 🔎 Quick Reference

**I need to...**

- **Book a trade via API** → [API Reference — POST /trades](./API-Reference.md#book-a-trade)
- **Understand why a pre-deal check failed** → [Risk Management](../learner/05-Risk-Management.md#why-did-my-pre-deal-check-fail)
- **Read the LCR breach alert** → [ALM Guide](../learner/06-ALM-and-Liquidity.md#lcr-breach-alerts)
- **Debug a position not updating** → [Troubleshooting](./Troubleshooting.md#position-not-updating)
- **Add a new asset class** → [Domain Model Deep Dive](./Domain-Model-Deep-Dive.md#extending-the-trade-aggregate)
- **Roll back a bad deployment** → [Runbooks — Rollback](../runbooks/03-Rollback-Procedure.md)
- **Check if a CVE is patched** → [Security Guide](./Security-Guide.md#cve-patching-sla)

---

_Last updated: April 2026 · NexusTreasury Engineering_
