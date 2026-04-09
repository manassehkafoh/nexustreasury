## Summary
<!-- What does this PR do? Link to JIRA/Linear ticket if applicable. -->

Fixes #<!-- issue number -->

## Type of change
- [ ] 🐛 Bug fix (non-breaking)
- [ ] ✨ New feature (non-breaking)
- [ ] 💥 Breaking change (requires migration or coordination)
- [ ] 📖 Documentation only
- [ ] ♻️  Refactor (no behaviour change)
- [ ] 🔒 Security patch

## Testing
- [ ] Unit tests added / updated (`pnpm test` passes — 0 failures)
- [ ] E2E integration tests pass (`pnpm --filter @nexustreasury/e2e exec vitest run`)
- [ ] Benchmarks unaffected (`pnpm --filter @nexustreasury/e2e exec vitest bench`)

## Security checklist
- [ ] No secrets or credentials in code or commit history
- [ ] `pnpm audit --prod` returns **zero vulnerabilities**
- [ ] New endpoints have JWT authentication hook
- [ ] Sensitive fields excluded from logs (`pino.redact`)
- [ ] Idempotency key supported on all mutating endpoints
- [ ] Input validated with Zod schema before domain logic

## Domain / Architecture
- [ ] Business logic lives in `packages/domain` or the relevant service domain layer
- [ ] No direct HTTP calls between services (Kafka events only)
- [ ] New Kafka topics documented in `docs/api/asyncapi.yaml`
- [ ] New REST endpoints documented in `docs/api/openapi.yaml`
- [ ] ADR created if a significant architectural decision was made

## Observability
- [ ] Structured Pino logs with `tenantId`, `traceId`, `spanId`
- [ ] Prometheus metrics exported on `:9090/metrics`
- [ ] New alert rules added to `infra/prometheus/alerts.yml` if applicable

## Reviewer notes
<!-- Anything the reviewer should pay particular attention to? -->
