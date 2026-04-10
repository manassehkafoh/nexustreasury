# Day 3–4 — Adding a New Service: Step-by-Step Guide

This walkthrough creates a hypothetical `portfolio-service` from scratch.

## Step 1 — Scaffold the package

```bash
mkdir -p packages/portfolio-service/src/{application,infrastructure,routes}

# package.json
cat > packages/portfolio-service/package.json << 'JSON'
{
  "name": "@nexustreasury/portfolio-service",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc --build",
    "dev": "tsx watch src/server.ts",
    "test": "vitest run",
    "start": "node dist/server.js"
  },
  "dependencies": {
    "@nexustreasury/domain": "workspace:*",
    "fastify": "^5.8.0",
    "@fastify/jwt": "^9.1.0",
    "zod": "^3.22.4",
    "kafkajs": "^2.2.4"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "vitest": "^1.0.0",
    "@types/node": "^22.0.0",
    "tsx": "^4.7.0"
  }
}
JSON
```

## Step 2 — Add tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "composite": true
  },
  "references": [{ "path": "../domain" }],
  "include": ["src/**/*.ts"]
}
```

## Step 3 — Add vitest config

```typescript
// packages/portfolio-service/vitest.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { globals: true, include: ['src/**/*.test.ts'] },
});
```

## Step 4 — Write the domain logic first

Domain logic goes in `packages/domain/src/` — not in the service. Add a new aggregate or extend an existing one, with tests, before touching the service.

## Step 5 — Write the application handler

```typescript
// src/application/portfolio-analyser.ts
import { type LiquidityGapReport } from '@nexustreasury/domain';

export class PortfolioAnalyser {
  analyse(reports: LiquidityGapReport[]) {
    // orchestration only — no business logic here
    return reports.map(r => ({ id: r.id, lcrRatio: r.lcr.lcrRatio }));
  }
}
```

## Step 6 — Write tests before the handler

Tests live alongside code: `src/application/portfolio-analyser.test.ts`. Run:

```bash
pnpm --filter @nexustreasury/portfolio-service exec vitest run
```

## Step 7 — Add the Fastify server

Follow `packages/trade-service/src/server.ts` as a template. Register:
- `@fastify/jwt` for authentication
- Health route at `/health`
- Your domain routes

## Step 8 — Add to Kubernetes manifest

```bash
cp infra/kubernetes/base/trade-service-deployment.yaml \
   infra/kubernetes/base/portfolio-service-deployment.yaml
# Edit: name, port (pick the next available: 4013+), image name
```

## Step 9 — Register in Kafka

Add your new service's consumer group to `docs/architecture/c4/07-kafka-topology.md`.

## Step 10 — Open a PR

PR checklist (enforced in CI):
- [ ] `pnpm build` — 0 errors
- [ ] `pnpm test` — 0 failures
- [ ] `pnpm audit --prod` — 0 CVEs
- [ ] ADR written if a significant architectural decision was made
- [ ] C4 component diagram updated in `docs/architecture/c4/03-components-*.md`
