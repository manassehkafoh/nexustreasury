# Configuration Reference

Every environment variable, feature flag, and configuration option in NexusTreasury.

---

## Environment Variables

### Required in All Services

| Variable     | Description                                      | Example                               |
| ------------ | ------------------------------------------------ | ------------------------------------- |
| `JWT_SECRET` | JWT signing secret (RS256 in prod, HS256 in dev) | Injected by Vault                     |
| `NODE_ENV`   | Runtime environment                              | `development` · `test` · `production` |

### Database (trade, position, risk, alm services)

| Variable       | Description                  | Example                                                 |
| -------------- | ---------------------------- | ------------------------------------------------------- |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://nexus:secret@postgres:5432/nexustreasury` |

Connection string format: `postgresql://<user>:<password>@<host>:<port>/<database>`

### Kafka (all services)

| Variable          | Description                 | Default          | Example         |
| ----------------- | --------------------------- | ---------------- | --------------- |
| `KAFKA_BROKERS`   | Comma-separated broker list | `localhost:9092` | `kafka:29092`   |
| `KAFKA_CLIENT_ID` | Unique client identifier    | per-service      | `trade-service` |

### Redis (trade-service)

| Variable     | Description           | Default     |
| ------------ | --------------------- | ----------- |
| `REDIS_HOST` | Redis server hostname | `localhost` |
| `REDIS_PORT` | Redis server port     | `6379`      |

### Market Data

| Variable          | Description            | Values                              |
| ----------------- | ---------------------- | ----------------------------------- |
| `RATE_SOURCE`     | Market rate adapter    | `MOCK` · `BLOOMBERG` · `REFINITIV`  |
| `BLOOMBERG_HOST`  | Bloomberg BLP API host | Required when RATE_SOURCE=BLOOMBERG |
| `REFINITIV_TOKEN` | Refinitiv RDP token    | Required when RATE_SOURCE=REFINITIV |

### Observability

| Variable                      | Description             | Default                       |
| ----------------------------- | ----------------------- | ----------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OpenTelemetry collector | `http://localhost:4317`       |
| `OTEL_SERVICE_NAME`           | Service name in traces  | per-service                   |
| `LOG_LEVEL`                   | Pino log level          | `info` (prod) · `debug` (dev) |

### Web (Next.js)

| Variable                        | Description                | Example                                      |
| ------------------------------- | -------------------------- | -------------------------------------------- |
| `NEXT_PUBLIC_TRADE_SERVICE_URL` | trade-service base URL     | `http://localhost:4001`                      |
| `NEXT_PUBLIC_TRADE_SERVICE_WS`  | WebSocket URL for blotter  | `ws://localhost:4001/api/v1/trades/stream`   |
| `NEXT_PUBLIC_RISK_SERVICE_URL`  | risk-service base URL      | `http://localhost:4003`                      |
| `NEXT_PUBLIC_ALM_SERVICE_URL`   | alm-service base URL       | `http://localhost:4004`                      |
| `NEXTAUTH_SECRET`               | NextAuth.js signing secret | Long random string                           |
| `KEYCLOAK_ISSUER`               | Keycloak issuer URL        | `http://localhost:8090/realms/nexustreasury` |

---

## Service Ports

| Service             | HTTP Port | gRPC Port | Metrics Port |
| ------------------- | --------- | --------- | ------------ |
| web                 | 3000      | —         | —            |
| trade-service       | 4001      | —         | 9090         |
| position-service    | 4002      | —         | 9090         |
| risk-service        | 4003      | 50051     | 9090         |
| alm-service         | 4004      | —         | 9090         |
| bo-service          | 4005      | —         | 9090         |
| market-data-service | 4006      | —         | 9090         |

All services expose a `/metrics` endpoint on port 9090 for Prometheus scraping.

---

## Local Development Defaults

Copy `.env.example` to `.env` and these defaults work out of the box:

```env
NODE_ENV=development
JWT_SECRET=nexustreasury-dev-secret-do-not-use-in-production
DATABASE_URL=postgresql://nexus:nexus123@localhost:5432/nexustreasury
KAFKA_BROKERS=localhost:9092
REDIS_HOST=localhost
REDIS_PORT=6379
RATE_SOURCE=MOCK
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
LOG_LEVEL=debug
NEXT_PUBLIC_TRADE_SERVICE_URL=http://localhost:4001
NEXT_PUBLIC_TRADE_SERVICE_WS=ws://localhost:4001/api/v1/trades/stream
NEXT_PUBLIC_RISK_SERVICE_URL=http://localhost:4003
NEXT_PUBLIC_ALM_SERVICE_URL=http://localhost:4004
```

---

## Kubernetes ConfigMaps (Staging / Production)

Non-secret configuration is stored in ConfigMaps:

```yaml
# infra/kubernetes/overlays/staging/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: nexustreasury-config
  namespace: nexus-staging
data:
  KAFKA_BROKERS: 'kafka-0.kafka-headless.nexus-staging:9092,...'
  REDIS_HOST: 'redis-master.nexus-staging'
  LOG_LEVEL: 'info'
  RATE_SOURCE: 'BLOOMBERG'
```

---

## HashiCorp Vault Secrets

Production secrets are injected by Vault Agent at pod startup.
They appear as environment variables and are never stored in git.

Vault paths:

- `secret/nexustreasury/production/jwt` → `JWT_SECRET`
- `secret/nexustreasury/production/db` → `DATABASE_URL`
- `secret/nexustreasury/production/bloomberg` → `BLOOMBERG_HOST`, `BLOOMBERG_PORT`

---

## Feature Flags

Configure via environment variable `FEATURE_FLAGS` (JSON object):

```env
FEATURE_FLAGS='{"grpcPreDealCheck":true,"islamicFinance":false,"isoSwift":true}'
```

| Flag               | Default                     | Description                               |
| ------------------ | --------------------------- | ----------------------------------------- |
| `grpcPreDealCheck` | `false` (dev) `true` (prod) | Use gRPC pre-deal check (vs pass-through) |
| `islamicFinance`   | `false`                     | Enable Islamic Finance asset class        |
| `isoSwift`         | `false`                     | Use ISO 20022 SWIFT format (vs legacy MT) |
| `varCalculation`   | `false`                     | Enable real VaR calculation (vs mock)     |
| `nsfrReporting`    | `true`                      | Include NSFR in liquidity reports         |

---

## Turbo Configuration

`turbo.json` controls how packages are built in parallel:

```json
{
  "tasks": {
    "@nexustreasury/domain#build": {
      "outputs": ["dist/**"],
      "cache": true
    },
    "build": {
      "dependsOn": ["@nexustreasury/domain#build", "^build"],
      "outputs": ["dist/**", ".next/**"],
      "cache": true
    },
    "test": {
      "dependsOn": ["@nexustreasury/domain#build"],
      "cache": false
    },
    "test:coverage": {
      "dependsOn": ["@nexustreasury/domain#build"],
      "cache": false
    }
  }
}
```

Key rule: `domain#build` must complete before any service builds.
