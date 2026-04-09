# ADR-001: Monorepo with pnpm Workspaces + Turborepo

**Status**: Accepted | **Date**: 2025-11-01 | **Deciders**: Principal Engineer, VP Engineering

## Context
13 microservices share domain types (Trade, Money, BusinessDate) and need coordinated versioning. Two approaches:

1. **Polyrepo** — each service in its own repository
2. **Monorepo** — all services in one repository with pnpm workspaces + Turborepo

## Decision: Monorepo (pnpm + Turborepo)

| Criterion | Polyrepo | Monorepo | Winner |
|---|---|---|---|
| Shared type safety | Publish npm packages | Direct workspace imports | Monorepo |
| Cross-service refactoring | 13 PRs for a type rename | 1 PR | Monorepo |
| Build caching | Per-repo | Turborepo remote cache | Monorepo |
| Service independence | Full isolation | Disciplined by workspace boundaries | Tie |
| CI complexity | 13 pipelines | 1 pipeline, matrix build | Monorepo |

## Consequences
- `@nexustreasury/domain` is the shared DDD kernel — all services import directly
- Turborepo `build` task runs in dependency order: `domain` → services → `web`
- Each service has its own `Dockerfile` — Docker images remain independent
- pnpm `--filter` enables per-service test/lint in CI without building everything
