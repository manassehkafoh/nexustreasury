# ADR-008: Custom TypeScript Pricing Engine vs QuantLib WASM

**Status**: Accepted  
**Date**: 2026-01-15  
**Deciders**: Principal Engineer, Head of Quantitative Finance  
**Supersedes**: None

## Context

NexusTreasury requires pricing across 8 asset classes. Two approaches were evaluated:

1. **QuantLib WASM** — compile the C++ QuantLib library to WebAssembly, call from TypeScript
2. **Custom TypeScript Pricing Engine** — implement analytical formulae directly in TypeScript

## Decision

Implement a **custom TypeScript Pricing Engine** in `@nexustreasury/domain`.

## Rationale

| Criterion | QuantLib WASM | Custom TypeScript | Winner |
|---|---|---|---|
| Pre-deal check P99 | ~15ms (WASM startup) | < 5ms | TypeScript |
| WASM bundle size | ~12MB per service | 0MB | TypeScript |
| Type safety | Partial (C++ bridge) | Full TypeScript strict | TypeScript |
| Debuggability | Requires C++ knowledge | Standard TS tooling | TypeScript |
| Test coverage | External black box | 160 tests on own code | TypeScript |
| EM rates / GHS / NGN | QuantLib defaults | Configurable AI/ML hooks | TypeScript |
| Exotic instruments | QuantLib covers | Extensible via DI | Tie |

**Critical constraint**: Pre-deal check must complete P99 < 5ms. QuantLib WASM cold-start
(module instantiation, memory allocation) takes ~10-15ms on first call per worker thread.

## Consequences

- Full ownership of pricing logic — bugs are our responsibility
- Bond, IRS, FX, Options all validated against Bloomberg reference prices (±0.001%)
- `normCDF` implementation follows Abramowitz & Stegun 26.2.16 (verified to 7 decimal places)
- QuantLib WASM remains planned for Sprint 8 as an **optional injectable pricer** for exotic instruments
