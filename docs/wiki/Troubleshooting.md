# Troubleshooting Guide

Common issues, their root causes, and exact fix steps.

---

## CI / Build Failures

### `pnpm install --frozen-lockfile` fails

**Symptom:** `ERR_PNPM_FROZEN_LOCKFILE` on CI Install step.
**Cause:** `pnpm-lock.yaml` is out of date or missing.
**Fix:**

```bash
pnpm install        # regenerates lockfile
git add pnpm-lock.yaml
git commit -m "chore: update pnpm-lock.yaml"
```

### `Command "prisma" not found`

**Symptom:** `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "prisma" not found`
**Cause:** A service has `prisma/schema.prisma` but no `prisma` CLI in `devDependencies`.
**Fix:** Add `"prisma": "^5.9.0"` to the failing service's `package.json` devDependencies, then `pnpm install`.

### Turbo: `WARNING no output files found for @nexustreasury/domain#build`

**Cause:** `tsconfig.tsbuildinfo` is committed to git but `dist/` is gitignored.
`tsc --build` sees the stale tsbuildinfo and skips emit.
**Fix:**

```bash
git rm --cached packages/domain/tsconfig.tsbuildinfo
git commit -m "fix: remove stale tsbuildinfo"
```

### TypeScript error: `Cannot find module '@nexustreasury/domain'`

**Cause:** Domain `dist/` doesn't exist yet (common on fresh CI clones).
**Fix:** Ensure `@nexustreasury/domain#build` is in `turbo.json` as a dependency.
Check that `build` runs `tsc --build --force` (not just `tsc --build`).

### `Type 'boolean' not assignable to 'void'` in server.ts

**Cause:** Arrow function `(): void => process.stdout.write(...)` implicitly returns the boolean
result of `write()`.
**Fix:** Wrap the body in braces: `(): void => { process.stdout.write(...); }`

### Prettier fails on Helm templates

**Cause:** Helm uses `{{- }}` Go templating which is not valid YAML.
**Fix:** `infra/helm/nexustreasury/templates/` is already in `.prettierignore`.
If a new template directory was added, add it to `.prettierignore` as well.

---

## Trade Service Issues

### POST /api/v1/trades returns 500 (not 400) for invalid request

**Cause:** Zod's `parse()` throws `ZodError` which has no `.statusCode`.
Fastify falls through to the 500 default.
**Fix:** Use `safeParse()` with an explicit 400 guard (already applied — check `trade.routes.ts`).

### Trade books but position does not update

**Cause:** Either Kafka delivery failed, or `position-service` Kafka consumer is stopped.
**Diagnosis:**

```bash
# Check position-service logs
docker-compose logs -f position-service | grep "ERROR\|WARN"

# Check consumer group lag in Kafka UI
open http://localhost:8080
# Navigate to: Consumer Groups → position-service-group → nexus.trading.trades
```

**Fix:** If the consumer is disconnected, restart position-service. If there is consumer lag,
it will process events in order — wait for it to catch up.

### Pre-deal check always returns `approved: true` in development

**Expected behaviour.** In development, `PassThroughPreDealCheck` is used, which always
approves trades. In production, swap to `GrpcPreDealCheck` pointing to `risk-service:50051`.

### JWT_SECRET not set error at startup

```
Error: JWT_SECRET environment variable is required
```

**Fix:** Add `JWT_SECRET=<any-string>` to your `.env` file for local development.
In Kubernetes, Vault agent injects this automatically.

---

## Position Service Issues

### Position not found after trade booking

**Cause:** position-service hasn't processed the Kafka event yet.
Allow 50–200ms for async propagation. If the position still doesn't exist after 30 seconds,
the Kafka consumer may be disconnected — see "Trade books but position does not update" above.

### `prisma.position` does not exist on PrismaClient

**Cause:** `prisma generate` was run per-service, causing a race condition where the last
service to generate overwrites the shared client.
**Fix:** Always run from root:

```bash
pnpm exec prisma generate --schema=prisma/schema.prisma
```

Never run `pnpm --filter @nexustreasury/position-service exec prisma generate`.

---

## Database Issues

### Prisma migration fails with `schema "trading" does not exist`

**Cause:** The PostgreSQL schemas haven't been created yet.
**Fix:**

```bash
# Create schemas manually (or re-run init-db.sql)
docker-compose exec postgres psql -U nexus -d nexustreasury \
  -c "CREATE SCHEMA IF NOT EXISTS trading;
      CREATE SCHEMA IF NOT EXISTS position;
      CREATE SCHEMA IF NOT EXISTS risk;
      CREATE SCHEMA IF NOT EXISTS alm;"
pnpm exec prisma migrate deploy
```

### Prisma client outdated after schema change

**Symptom:** TypeScript errors about missing model properties after a migration.
**Fix:**

```bash
pnpm exec prisma generate --schema=prisma/schema.prisma
pnpm build
```

---

## Kafka Issues

### Consumer group lag keeps growing

**Cause:** Consumer is processing events slower than the producer produces them.
**Check:**

```bash
# In Kafka UI (localhost:8080), check consumer group lag
# Or use kafka-consumer-groups CLI
docker-compose exec kafka kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --group position-service-group \
  --describe
```

**Fix:** Scale up the consuming service (increase HPA minReplicas) or investigate
the slow event handler.

### `Leader not available` on topic

**Cause:** Kafka is still starting up.
**Fix:** Wait 30–60 seconds for Kafka to elect partition leaders after startup.

---

## Coverage Failures

### Coverage below 80% threshold

**Diagnosis:**

```bash
pnpm --filter @nexustreasury/domain test:coverage
# Read the coverage table for files with low coverage
```

**Fix:** Write targeted tests for the uncovered lines. See the coverage table for exact
line numbers. Do NOT lower thresholds — maintain quality.

### Infrastructure files dragging down coverage

**Cause:** Files like `health.routes.ts`, `kafka/producer.ts`, `prisma/repository.ts`
require real infrastructure and cannot be unit-tested.
**Fix:** Add them to the `coverage.exclude` array in `vitest.config.ts`:

```typescript
exclude: ['src/infrastructure/kafka/**', 'src/routes/health.routes.ts', ...]
```

---

## Observability

### Prometheus alert firing: `TradeBookingLatencyHigh`

**Threshold:** P99 > 100ms
**Common causes:**

1. Database query slow — check `pg_stat_statements` for slow queries
2. Pre-deal check taking too long — add Redis caching in front of limit lookups
3. Kafka publish slow — check broker health in Grafana

### Alert: `ServiceDown` for any service

**Action:** Check pod status:

```bash
kubectl get pods -n nexus-prod | grep CrashLoopBackOff
kubectl logs -n nexus-prod <pod-name> --previous
```

### Grafana shows no data

**Cause:** Prometheus cannot scrape services (Cilium network policy may be blocking port 9090).
**Fix:** Verify the Prometheus scrape annotation is on the pod:

```yaml
annotations:
  prometheus.io/scrape: 'true'
  prometheus.io/port: '9090'
```

---

## Getting More Help

1. **Check ADRs** in `ARCHITECTURE.md` — the decision you're questioning may be documented
2. **Check CI logs** — GitHub Actions stores 7 days of build logs
3. **Check Kafka UI** — `http://localhost:8080` shows topic messages and consumer lag
4. **Check Grafana** — `http://localhost:3001` shows service metrics and error rates
5. **Check Jaeger** — `http://localhost:16686` shows distributed traces
6. **Open an issue** on GitHub with the relevant logs and error messages
