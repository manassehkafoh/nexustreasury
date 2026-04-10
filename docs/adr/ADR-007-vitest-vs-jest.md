# ADR-007: Vitest vs Jest for Testing

**Status**: Accepted | **Date**: 2025-11-15 | **Deciders**: Principal Engineer

## Decision: Vitest 1.x

| Criterion              | Jest                    | Vitest 1.x          | Winner |
| ---------------------- | ----------------------- | ------------------- | ------ |
| ESM support            | Complex config required | Native              | Vitest |
| Speed (first run)      | ~45s                    | ~12s                | Vitest |
| Speed (watch mode)     | ~3s per file            | ~0.3s per file      | Vitest |
| TypeScript support     | Requires `ts-jest`      | Native              | Vitest |
| Benchmark support      | No                      | `bench()` built-in  | Vitest |
| API compatibility      | Industry standard       | Jest-compatible API | Tie    |
| pnpm workspace support | Manual config           | Native              | Vitest |

**Key driver**: ESM-native monorepo. The `@nexustreasury/domain` package uses `"type": "module"` throughout. Jest requires `@jest/globals`, `ts-jest`, and extensive `moduleNameMapper` config to handle ESM. Vitest handles it with zero configuration.

**Benchmark requirement**: Pricing SLA verification (Black-Scholes P99 < 2ms) requires built-in benchmarking. Jest has no `bench()` equivalent.

## Consequences

- All 13 packages use Vitest with a shared `vitest.config.ts` base
- `describe`, `it`, `expect` imported from `vitest` — same API as Jest
- `bench()` used in `tests/e2e/critical-path.bench.ts` for SLA verification
- Coverage: `@vitest/coverage-v8` with Istanbul reporting
- CI: `pnpm test:coverage` runs all 502 unit tests in < 45s (vs ~180s with Jest)
