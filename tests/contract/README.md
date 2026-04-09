# NexusTreasury — Pact Consumer-Driven Contract Tests

**Status**: Sprint 7 deliverable (planned, stubs committed)  
**Framework**: Pact JS v12 (PactV3 + Protobuf support)  
**Broker**: Pact Broker deployed at `https://pact.nexustreasury.io`

## What these tests verify

Each service that consumes a Kafka event defines a **Pact contract** specifying the exact JSON shape it expects. The producer service must satisfy all consumer contracts before deployment.

### Producer → Consumer relationships

| Topic | Producer | Consumers |
|---|---|---|
| `nexus.trading.trades.booked` | trade-service | position-service, accounting-service, audit-service, notification-service |
| `nexus.risk.limit-breach` | risk-service | notification-service, audit-service |
| `nexus.risk.var-result` | risk-service | collateral-service, reporting-service |
| `nexus.bo.reconciliation-break` | bo-service | notification-service, audit-service |
| `nexus.alm.lcr-calculated` | alm-service | notification-service, reporting-service |

## Run contracts

```bash
# Run all consumer contract tests
pnpm --filter @nexustreasury/contracts exec vitest run

# Publish contracts to Pact Broker
pnpm --filter @nexustreasury/contracts exec pact-broker publish \
  --pact-files-or-dirs=./pacts \
  --broker-base-url=https://pact.nexustreasury.io \
  --consumer-app-version=$(git rev-parse --short HEAD)

# Verify producer satisfies all published contracts
pnpm --filter @nexustreasury/trade-service exec vitest run --config vitest.pact.config.ts
```

## CI integration (Sprint 7)

The `can-i-deploy` check runs before every production deployment:

```bash
pact-broker can-i-deploy \
  --pacticipant trade-service \
  --broker-base-url https://pact.nexustreasury.io \
  --to-environment production
```
