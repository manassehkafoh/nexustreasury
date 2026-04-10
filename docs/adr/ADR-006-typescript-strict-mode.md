# ADR-006: TypeScript Strict Mode Throughout

**Status**: Accepted | **Date**: 2025-11-01 | **Deciders**: Principal Engineer

## Decision: TypeScript 5.4 with `strict: true` enforced in `tsconfig.base.json`

Flags enabled: `strictNullChecks`, `noImplicitAny`, `strictFunctionTypes`, `strictPropertyInitialization`, `noUncheckedIndexedAccess`.

## Rationale

Banking domain code has zero tolerance for runtime `null` dereferences. In a system calculating margin calls, a missing null check on a CSA threshold could generate an incorrect margin call worth millions. TypeScript strict mode prevents this class of bug at compile time.

**Key invariant examples enforced by strict mode**:

```typescript
// Without strictNullChecks — this would compile and crash at runtime:
const headroom = limit.headroom.toNumber(); // limit.headroom could be undefined

// With strictNullChecks — caught at compile time:
const headroom = limit.headroom?.toNumber() ?? 0;
```

## Consequences

- All 13 packages share `tsconfig.base.json` with `"strict": true`
- `as any` is permitted only for branded type casts (`'bank-001' as TenantId`) — never for type narrowing
- `noUncheckedIndexedAccess` enabled: `array[0]` has type `T | undefined`
- CI `typecheck` job runs `tsc --noEmit` on the full workspace on every PR
