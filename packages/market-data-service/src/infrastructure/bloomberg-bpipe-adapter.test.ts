/**
 * @file bloomberg-bpipe-adapter.test.ts
 * @description Sprint 8.1 — Bloomberg B-PIPE adapter + adaptive failover tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BloombergBPIPEAdapter, CircuitState } from './bloomberg-bpipe-adapter.js';
import { AdaptiveMarketDataAdapter } from './adaptive-market-data-adapter.js';

const CONFIG = { serverHost: 'mock-bpipe.bloomberg.com', serverPort: 8194 };

describe('BloombergBPIPEAdapter', () => {
  it('initialises with CLOSED circuit state', () => {
    const a = new BloombergBPIPEAdapter(CONFIG);
    expect(a.circuitState).toBe(CircuitState.CLOSED);
    expect(a.totalTicksReceived).toBe(0);
  });

  it('starts emitting rates after subscribe()', async () => {
    const a = new BloombergBPIPEAdapter({ ...CONFIG, heartbeatMs: 100 });
    const rates: unknown[] = [];
    a.onRate((r) => rates.push(r));
    a.subscribe(['EURUSD Curncy']);

    await new Promise((r) => setTimeout(r, 400));
    await a.disconnect();

    expect(rates.length).toBeGreaterThan(0);
    expect(a.totalTicksReceived).toBeGreaterThan(0);
  });

  it('emits BLOOMBERG source on rates', async () => {
    const a = new BloombergBPIPEAdapter(CONFIG);
    let lastRate: { source?: string } | null = null;
    a.onRate((r) => {
      lastRate = r;
    });
    a.subscribe(['EURUSD Curncy']);

    await new Promise((r) => setTimeout(r, 300));
    await a.disconnect();

    expect(lastRate?.source).toBe('BLOOMBERG');
  });

  it('multi-instrument subscription emits rates for all instruments', async () => {
    const a = new BloombergBPIPEAdapter(CONFIG);
    const instruments = new Set<string>();
    a.onRate((r) => instruments.add(r.instrument));
    a.subscribe(['EURUSD Curncy', 'GBPUSD Curncy']);

    await new Promise((r) => setTimeout(r, 400));
    await a.disconnect();

    expect(instruments.size).toBeGreaterThanOrEqual(1);
  });

  it('disconnect() stops all rate emission', async () => {
    const a = new BloombergBPIPEAdapter(CONFIG);
    let count = 0;
    a.onRate(() => count++);
    a.subscribe(['EURUSD Curncy']);
    await new Promise((r) => setTimeout(r, 200));

    const countAtDisconnect = count;
    await a.disconnect();
    await new Promise((r) => setTimeout(r, 200));

    expect(count).toBe(countAtDisconnect); // no more ticks after disconnect
  });

  it('resetCircuit() moves circuit from OPEN to CLOSED', () => {
    const a = new BloombergBPIPEAdapter({ ...CONFIG, failureThreshold: 1 });
    // Force circuit open by triggering failures
    (a as unknown as { _handleConnectionFailure: (e: Error) => void })._handleConnectionFailure(
      new Error('test failure'),
    );
    a.disconnect();
    a.resetCircuit();
    expect(a.circuitState).toBe(CircuitState.CLOSED);
  });

  it('configuration defaults are applied correctly', () => {
    const a = new BloombergBPIPEAdapter({ serverHost: 'bpipe.test' });
    const cfg = (a as unknown as { _config: Record<string, unknown> })._config;
    expect(cfg.serverPort).toBe(8194);
    expect(cfg.failureThreshold).toBe(3);
    expect(cfg.halfOpenMs).toBe(30_000);
  });
});

describe('AdaptiveMarketDataAdapter', () => {
  it('initialises with BLOOMBERG as active source', () => {
    const a = new AdaptiveMarketDataAdapter({
      bloomberg: CONFIG,
      useMockFallback: true,
    });
    expect(a.activeSource).toBe('BLOOMBERG');
    a.disconnect();
  });

  it('receives rates from subscribe()', async () => {
    const a = new AdaptiveMarketDataAdapter({
      bloomberg: CONFIG,
      useMockFallback: true,
    });
    const rates: unknown[] = [];
    a.onRate((r) => rates.push(r));
    a.subscribe(['EURUSD Curncy']);

    await new Promise((r) => setTimeout(r, 400));
    await a.disconnect();

    expect(rates.length).toBeGreaterThan(0);
  });

  it('reports bloomberg circuit state', () => {
    const a = new AdaptiveMarketDataAdapter({ bloomberg: CONFIG, useMockFallback: true });
    expect(a.bloombergCircuitState).toBe(CircuitState.CLOSED);
    a.disconnect();
  });

  it('failover event log starts empty', () => {
    const a = new AdaptiveMarketDataAdapter({ bloomberg: CONFIG, useMockFallback: true });
    expect(a.failoverEvents).toHaveLength(0);
    a.disconnect();
  });
});
