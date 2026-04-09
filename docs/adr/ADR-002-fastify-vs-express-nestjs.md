# ADR-002: Fastify 5 vs Express vs NestJS

**Status**: Accepted | **Date**: 2025-11-05 | **Deciders**: Principal Engineer

## Decision: Fastify 5

| Criterion | Express | NestJS | Fastify 5 | Winner |
|---|---|---|---|---|
| Throughput (RPS) | ~15K | ~12K | ~30K | Fastify |
| JSON schema validation | Manual | Class-validator | Built-in (AJV) | Fastify |
| TypeScript support | Partial | First-class | First-class | Tie (NestJS/Fastify) |
| OpenAPI generation | Manual | @nestjs/swagger | @fastify/swagger | Tie |
| Bundle size | Small | Large (decorators) | Small | Fastify |
| Pre-deal check P99 | ~4ms | ~6ms | ~2ms | Fastify |

**Critical constraint**: Pre-deal check P99 < 5ms. NestJS decorator overhead adds ~2ms per request, making the SLA unreachable at peak load. Fastify's AJV-based schema validation (compiled at startup) adds < 0.1ms.

## Consequences
- All services use Fastify 5 + `@fastify/swagger` for OpenAPI 3.1 generation
- Route schemas defined as JSON Schema (typed with `@sinclair/typebox`)
- No class decorators — functional route handlers only
