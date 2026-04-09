// Shared Kernel
export * from './shared/domain-event.js';
export * from './shared/value-objects.js';

// Trading Context
export * from './trading/trade.aggregate.js';

// Position Context
export * from './position/position.aggregate.js';

// Risk Context
export * from './risk/limit.aggregate.js';

// ALM Context
export * from './alm/liquidity-gap.aggregate.js';

// ── Pricing Engine (Sprint 1 — P1) ───────────────────────────────────────────
export * from './pricing/yield-curve.js';
export * from './pricing/fx-pricer.js';
export * from './pricing/bond-pricer.js';
export * from './pricing/irs-pricer.js';
export * from './pricing/option-pricer.js';
export * from './pricing/pricing-engine.js';
export * from './pricing/greeks-calculator.js';

// ── Sprint 7.4 — Exotic Pricer (ADR-008 injectable interface) ─────────────────
export * from './pricing/exotic-pricer.interface.js';
export * from './pricing/barrier-option-pricer.js';
export * from './pricing/bermudan-swaption-pricer.js';
export * from './pricing/ts-exotic-pricer.js';
export * from './pricing/wasm-exotic-pricer-pool.js';

// ── Sprint 8.4 — FX Volatility Surface + Vanna-Volga Pricer ─────────────────
export * from './pricing/vol-surface.js';
export * from './pricing/vanna-volga-pricer.js';
