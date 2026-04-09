# NexusTreasury Developer Onboarding Guide

> **Audience**: New engineers joining the NexusTreasury platform team  
> **Time to first green build (devcontainer)**: < 5 minutes  
> **Time to first green build (manual)**: ~15 minutes

---

## Option A — VS Code Dev Container (Recommended, < 5 minutes)

The fastest path. Everything is pre-configured — Node.js 22, Docker-in-Docker,
kubectl, Helm, GitHub CLI, all 13 service ports forwarded, and 10 VS Code extensions
pre-installed.

**Prerequisites**: VS Code + [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) + Docker Desktop.

```bash
git clone https://github.com/manassehkafoh/nexustreasury.git
code nexustreasury
# VS Code prompts: "Reopen in Container" — click it
# The setup.sh post-create hook runs automatically:
#   pnpm install → prisma generate → docker-compose up → migrate → build → smoke test
```

When the container is ready, the dashboard opens at `http://localhost:3000` automatically.

---

## Option B — Manual Setup

## 1. Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | 22 LTS | `nvm install 22 && nvm use 22` (`.nvmrc` present) |
| pnpm | 9.x | `npm i -g pnpm@9` |
| Docker Desktop | 25+ | https://docs.docker.com/get-docker/ |
| kubectl | 1.28+ | `brew install kubectl` |
| Helm | 3.14+ | `brew install helm` |
| VS Code | Latest | Extensions: ESLint, Prettier, Vitest |

---

## 2. Clone and Install

```bash
git clone https://github.com/manassehkafoh/nexustreasury.git
cd nexustreasury

# Node version
nvm use   # picks up .nvmrc → Node 22

# Install all workspace packages
pnpm install

# Build all 13 services
pnpm build
# Expected: Tasks: 13 successful, 13 total
```

---

## 3. Environment Setup

```bash
# Copy the dev environment template
cp .env.example .env.local

# Required variables (auto-injected by Vault in Kubernetes):
# JWT_SECRET=<generate with: openssl rand -hex 32>
# DATABASE_URL=postgresql://nexus:nexus@localhost:5432/nexustreasury
# KAFKA_BROKERS=localhost:9092
# REDIS_URL=redis://localhost:6379
# AUDIT_HMAC_KEY=<generate with: openssl rand -hex 32>
```

---

## 4. Start Local Infrastructure

```bash
# Start PostgreSQL 16, Kafka 3.7, Redis 7, Elasticsearch 8
docker-compose up -d

# Wait for health checks (about 30s)
docker-compose ps
# All services should show "healthy"

# Run database migrations
pnpm --filter @nexustreasury/trade-service exec prisma migrate dev
pnpm --filter @nexustreasury/risk-service  exec prisma migrate dev
pnpm --filter @nexustreasury/accounting-service exec prisma migrate dev
```

---

## 5. Run All Tests

```bash
# Unit tests — all 13 packages
pnpm test
# Expected: 34 test files, 502 tests, 0 failures

# E2E integration tests (in-memory, no network)
pnpm --filter @nexustreasury/e2e exec vitest run
# Expected: 1 test file, 31 tests, 0 failures

# Single package watch mode
pnpm --filter @nexustreasury/domain exec vitest

# With coverage
pnpm --filter @nexustreasury/domain exec vitest run --coverage
```

---

## 6. Start the Platform

```bash
# Start all services concurrently
pnpm dev
# Services start on ports 3000–4011

# Or start individually
pnpm --filter @nexustreasury/trade-service dev   # :4001
pnpm --filter @nexustreasury/web dev             # :3000
```

Open http://localhost:3000 → NexusTreasury dashboard

---

## 7. Monorepo Structure

```
nexustreasury/
├── packages/
│   ├── domain/              Pure domain logic (aggregates, value objects, pricers)
│   ├── trade-service/       Trade booking, sanctions screening        :4001
│   ├── position-service/    Real-time position MTM                    :4002
│   ├── risk-service/        Pre-deal, VaR, Greeks, FRTB SA           :4003
│   ├── alm-service/         LCR, NSFR, NMD modelling                 :4004
│   ├── bo-service/          SWIFT, settlement, recon, corp actions    :4005
│   ├── market-data-service/ Bloomberg/LSEG rate adapter               :4006
│   ├── accounting-service/  IFRS9, ECL, hedge accounting              :4007
│   ├── audit-service/       HMAC audit trail (SOC 2)                  :4008
│   ├── notification-service/ Email/WS/Webhook alerts                  :4009
│   ├── collateral-service/  ISDA CSA/GMRA margin calls                :4010
│   ├── reporting-service/   LCR/NSFR/IRRBB regulatory reports         :4011
│   └── web/                 Next.js 15 dashboard                      :3000
├── tests/
│   └── e2e/                 Cross-service integration tests
├── docs/
│   ├── api/                 OpenAPI 3.1 specification
│   ├── architecture/c4/     C4 diagrams (system → component level)
│   ├── wiki/                Domain learning guides
│   ├── adr/                 Architecture Decision Records
│   └── runbooks/            Operational runbooks
├── infra/
│   ├── helm/                Kubernetes Helm charts
│   └── k8s/                 Raw Kubernetes manifests
└── .github/workflows/       CI/CD pipelines
```

---

## 8. Architecture Primer

NexusTreasury uses **Clean Architecture** + **Domain-Driven Design**:

```
Request → Route (Fastify) → Application Handler → Domain Aggregate
                                     ↓
                             Infrastructure (Prisma/Kafka)
```

### Bounded Contexts

Each service owns its bounded context. Cross-context communication happens exclusively through **Kafka events** — never direct HTTP calls between services.

```
trade-service publishes:  nexus.trading.trades.booked
                          ↓
position-service,         accounting-service,
audit-service,            notification-service
all subscribe independently
```

### Domain Aggregates

Business rules live in domain classes, not services. If you're adding a pricing rule, it goes in `packages/domain/src/pricing/`. If you're adding a new settlement type, it goes in `packages/bo-service/src/application/settlement/`.

---

## 9. Writing a New Feature

### Step 1: Write the test first (TDD)

```typescript
// packages/domain/src/pricing/new-pricer.test.ts
import { describe, it, expect } from 'vitest';
import { NewPricer } from './new-pricer.js';

describe('NewPricer', () => {
  it('prices correctly for base case', () => {
    const pricer = new NewPricer();
    const result = pricer.price({ /* inputs */ });
    expect(result.npv).toBeCloseTo(expectedNpv, 4);
  });
});
```

### Step 2: Implement to make it green

```typescript
// packages/domain/src/pricing/new-pricer.ts
export class NewPricer {
  price(input: NewPricerInput): PricingResult {
    // implementation
  }
}
```

### Step 3: Run the test

```bash
pnpm --filter @nexustreasury/domain exec vitest run
```

### Step 4: Add a route (if REST-exposed)

```typescript
// In the appropriate service's routes file
app.post('/new-endpoint', async (req, reply) => {
  const validated = NewEndpointSchema.parse(req.body);
  const result = await handler.execute(validated);
  return reply.send(result);
});
```

### Step 5: Document it

Add a JSDoc comment with `@see PRD REQ-xxx` reference and update `docs/api/openapi.yaml`.

---

## 10. Code Style

```bash
# Format (runs automatically on commit via Husky)
pnpm exec prettier --write "packages/**/*.ts"

# Lint
pnpm exec eslint "packages/**/*.ts"

# TypeScript strict — no `any` (except in `as any` brand casts)
pnpm exec tsc --noEmit
```

### Key conventions

- **Value Objects**: immutable, compared by value (Money, BusinessDate, TenantId)
- **Aggregates**: encapsulate invariants, publish domain events
- **Repository interfaces**: defined in domain, implemented in infrastructure
- **AI/ML hooks**: optional injected interfaces — always have fallback behaviour
- **Error taxonomy**: `TradeDomainError`, `LimitDomainError` etc. with error codes

---

## 11. Kafka Topics Reference

| Topic | Producer | Consumers |
|---|---|---|
| `nexus.trading.trades.booked` | trade-service | position, accounting, audit, notification |
| `nexus.risk.limit-breach` | risk-service | notification, audit |
| `nexus.bo.reconciliation-break` | bo-service | audit, notification |
| `nexus.security.login-failed` | auth gateway | audit, notification |

Full topic map: `docs/architecture/c4/00-system-overview.md`

---

## 12. Common Tasks

### Add a new asset class

1. Add enum value to `AssetClass` in `packages/domain/src/trading/trade.aggregate.ts`
2. Add IFRS9 classification rule in `packages/accounting-service/src/domain/ifrs9-classifier.ts`
3. Add settlement instruction generator in `packages/bo-service/src/application/settlement/`
4. Write tests at each step

### Add a new regulatory report

1. Add method to `RegulatoryReportingService` in `packages/reporting-service/`
2. Add route to `reporting.routes.ts`
3. Add schema to `docs/api/openapi.yaml`
4. Write unit tests

### Change a brand colour

1. Update `NEXUSTREASURY_BRAND.colors` in `packages/web/src/lib/branding.ts`
2. Or: set `NEXT_PUBLIC_BRAND_ID=your-brand-id` and create a new preset
3. Or: PATCH `/api/v1/admin/tenants/:id/brand` at runtime

---

## 13. Security Checklist

Before raising a PR:

- [ ] No hardcoded secrets (use env vars; Vault injects in K8s)
- [ ] `JWT_SECRET` loaded from env, never hardcoded
- [ ] `pnpm audit --prod` returns zero vulnerabilities
- [ ] All new endpoints have `onRequest` JWT verification hook
- [ ] Sensitive data fields are not logged (use `pino.redact`)
- [ ] Mutation endpoints have idempotency key support
- [ ] New Kafka consumers have dead-letter queue handling

---

## 14. Debugging Tips

```bash
# Trace a trade through the system
export TRADE_ID=trade-xxxx

# 1. Check trade-service logs
docker-compose logs trade-service | grep $TRADE_ID

# 2. Check position was updated
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:4002/api/v1/positions?tradeId=$TRADE_ID

# 3. Check journal entries
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:4007/api/v1/accounting/journal-entries/by-trade/$TRADE_ID

# 4. Check audit trail
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:4008/api/v1/audit/records?entityId=$TRADE_ID

# 5. Check Kafka messages
docker exec -it nexustreasury-kafka kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic nexus.trading.trades.booked --from-beginning | grep $TRADE_ID
```

---

## 15. Getting Help

- **Architecture questions**: Check `docs/architecture/c4/` and `docs/adr/`
- **Domain concepts**: Check `docs/wiki/` (VaR, IFRS9, settlement, collateral, LCR)
- **API reference**: Check `docs/api/openapi.yaml` or Postman workspace 'NexusTreasury'
- **Regulatory questions**: The wiki files include worked examples with Basel III formulas

> **Rotate the GitHub PAT** after cloning: `github.com/settings/tokens`

---

## Developer Makefile (25 targets)

All common tasks are wrapped in `make`. Run `make help` for the full list.

```
make install          Install all workspace dependencies
make build            Build all 13 services
make test             Run 502 unit tests
make test-e2e         Run 31 E2E tests
make bench            Run 7 SLA benchmark suites
make coverage         Generate coverage report
make dev              Start all 13 services
make infra-up         Start PostgreSQL + Kafka + Redis via Docker Compose
make infra-down       Stop all infrastructure
make db-migrate       Apply Prisma migrations
make db-studio        Open visual DB browser
make api-test         Run Postman collection via Newman (local)
make api-test-staging Run Postman collection against staging
make k6               Quick k6 load test (10 VUs, 30s)
make audit            pnpm security audit (must be 0 CVEs)
make provision-tenant Dry-run tenant provisioning
make postman-import   Show Postman import instructions + mock server URL
make deploy-staging   Trigger staging deployment via GitHub Actions CLI
make help             Show all 25 targets with descriptions
```

## Newman API Tests

After services are running, validate all 17 API endpoints:

```bash
# Obtain a JWT token first
export NEXUS_ACCESS_TOKEN=$(curl -s -X POST \
  http://localhost:8080/realms/nexustreasury-bank-001/protocol/openid-connect/token \
  -d 'grant_type=password&client_id=nexustreasury-web&username=admin@bank.com&password=changeme' \
  | jq -r .access_token)

make api-test
# Report: reports/newman/report_local_<timestamp>.html
```

Or use the mock server (no running services required):
```
https://eeed7962-2b7b-495b-b197-03bb48aaae11.mock.pstmn.io
```
