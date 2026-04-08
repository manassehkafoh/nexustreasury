# Frequently Asked Questions

---

## For Engineers

**Q: Where do I add a new business rule?**
In the domain layer — `packages/domain/src/{context}/{aggregate}.ts`. Never in a
route handler or repository. See [Domain Model Deep Dive](./Domain-Model-Deep-Dive.md).

**Q: Why does pnpm install fail with `ERR_PNPM_FROZEN_LOCKFILE`?**
Your `pnpm-lock.yaml` is out of date. Run `pnpm install` (without `--frozen-lockfile`)
to update it, then commit the updated lockfile.

**Q: Why can't I find `prisma.position` on `PrismaClient`?**
You ran `prisma generate` inside a service package, which overwrote the shared client.
Always run from root: `pnpm exec prisma generate --schema=prisma/schema.prisma`.

**Q: The domain package built but `dist/` is empty. Why?**
`tsconfig.tsbuildinfo` is stale — `tsc --build` said "nothing changed" and skipped emit.
This is why `tsc --build --force` is used in all build scripts. If you see this locally,
run `pnpm --filter @nexustreasury/domain exec tsc --build --force`.

**Q: Why does my POST /api/v1/trades return 500 for invalid input?**
`ZodError` has no `.statusCode` so Fastify returns 500. Use `safeParse()` instead
of `parse()` and return 400 explicitly. See [trade.routes.ts](../../packages/trade-service/src/routes/trade.routes.ts).

**Q: How do I connect to the local database?**

```bash
docker-compose exec postgres psql -U nexus -d nexustreasury
\dn         # list schemas (trading, position, risk, alm)
\dt trading.* # list tables in trading schema
```

**Q: How do I see what Kafka events were published?**
Open Kafka UI at `http://localhost:8080`. Navigate to Topics → `nexus.trading.trades`
→ Messages. You can browse messages by offset, timestamp, or key.

**Q: Why is my test coverage failing the threshold?**
Run `pnpm --filter @nexustreasury/domain test:coverage` and read the file-level table.
Find files with low coverage and add tests for the uncovered lines (shown as line numbers
in the `Uncovered Line #s` column). Do NOT lower the threshold.

**Q: Can I add a new dependency directly in a service?**
Yes: `pnpm --filter @nexustreasury/trade-service add <package>`.
Then `pnpm install` from root to update the lockfile.
For major updates, let Renovate Bot handle them automatically.

**Q: What's the difference between `pnpm build` and `pnpm --filter <pkg> build`?**
`pnpm build` runs Turbo, which builds all packages in dependency order.
`pnpm --filter <pkg> build` bypasses Turbo and builds only that package directly.
Use the filter approach during active development; use `pnpm build` for final verification.

---

## For QA / Testers

**Q: How do I get a JWT for API testing?**

```bash
curl -X POST http://localhost:8090/realms/nexustreasury/protocol/openid-connect/token \
  -d "grant_type=password&client_id=nexustreasury-api&username=trader1&password=secret"
```

Or import the Postman collection at `docs/NexusTreasury_API_Collection.postman_collection.json`.

**Q: Why does the pre-deal check always pass in dev?**
`PassThroughPreDealCheck` is used in development — it always returns `approved: true`.
To test limit rejection, point the service at a real risk-service with limits configured,
or write a unit test that mocks the PreDealCheckService.

**Q: How do I reset the local database?**

```bash
docker-compose down -v        # removes all volumes (destroys data)
docker-compose up -d postgres
pnpm exec prisma migrate deploy
```

**Q: How do I trigger a Kafka consumer manually?**
Use the Kafka UI at `http://localhost:8080` → Topics → Produce Message.
Or use `kafka-console-producer`:

```bash
docker-compose exec kafka kafka-console-producer.sh \
  --bootstrap-server localhost:9092 \
  --topic nexus.trading.trades
```

Paste a JSON event payload and press Enter.

---

## For Product / Business

**Q: What asset classes does NexusTreasury support?**
FX (spot, forward, swap), Fixed Income (bonds), Money Market (deposits, CDs),
Interest Rate Derivatives (IRS, caps, floors), Equity, Commodity, Repo,
and Islamic Finance instruments. See [API Reference](./API-Reference.md#valid-assetclass-values).

**Q: Does NexusTreasury support multi-currency positions?**
Yes. Each position is denominated in a specific currency. MTM revaluation
converts all positions to the base currency (USD by default) for P&L aggregation.

**Q: What is the minimum LCR NexusTreasury alerts on?**
Warning at < 110%, critical breach at < 100%. The 100% minimum is set by Basel III.
Thresholds are configurable per institution.

**Q: Can NexusTreasury report directly to regulators?**
Not yet. Trade data is stored in a format compatible with EMIR/Dodd-Frank reporting,
but direct API submission to DTCC or Regis-TR is on the roadmap.

**Q: How is data isolated between different banks (tenants)?**
Every database record has a `tenantId` column. Every API query includes
`WHERE tenantId = ?`. The `tenantId` comes from the JWT issued by Keycloak.
One tenant cannot access another's data.

**Q: What is the maximum trade volume NexusTreasury supports?**
The platform is designed for 500+ TPS sustained throughput. Peak capacity during
load tests was 1,200 TPS. Scale is controlled by Kubernetes HPA (3–20 replicas).

---

## For Operations

**Q: What do I do when a Prometheus alert fires?**
Refer to the [Runbooks](../runbooks/README.md) for specific step-by-step instructions
for each alert. For `ServiceDown`, check `kubectl get pods -n nexus-prod` immediately.

**Q: How do I deploy to production?**
Production deployments require 2 approvals in the GitHub Actions workflow.
Navigate to Actions → cd-production → Run workflow.
See [Deployment Guide](./Deployment-Guide.md) for the full process.

**Q: How quickly are CVEs patched?**
The `security-patch.yml` workflow runs every 6 hours and auto-merges security patches.
The SLA is < 24 hours for critical/high CVEs (SOC 2 CC6.8).

**Q: Can I roll back a bad deployment?**
Yes. See [Runbook 03: Rollback Procedure](../runbooks/03-Rollback-Procedure.md).
ArgoCD supports one-click rollback to any previous deployment.
