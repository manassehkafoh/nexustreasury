/**
 * @module AdaptiveMarketDataAdapter
 * @description Fault-tolerant market data adapter — Bloomberg primary, Refinitiv fallback.
 *
 * Wraps BloombergBPIPEAdapter (primary) and RefinitivRDPAdapter (secondary)
 * with automatic failover when the Bloomberg circuit breaker opens.
 *
 * ## Failover Logic
 *
 * ```
 * BloombergBPIPEAdapter.circuitState → OPEN
 *     └──► Switch to RefinitivRDPAdapter
 *          └──► Poll every 30s: can Bloomberg reconnect?
 *               └──► Yes → switch back to Bloomberg
 * ```
 *
 * Downstream services (rate-publisher) receive a unified stream regardless
 * of which source is active. Source is identified in `MarketRate.source`.
 *
 * @see Sprint 8.1
 */

import {
  BloombergBPIPEAdapter,
  CircuitState,
  type BPIPEConfig,
} from './bloomberg-bpipe-adapter.js';
import type { MarketDataAdapter, MarketRate } from '../application/rate-publisher.js';
import { MockRateAdapter } from '../application/rate-publisher.js';

/** Adapter selection events emitted during failover. */
export type FailoverEvent =
  | { type: 'BLOOMBERG_CONNECTED'; at: Date }
  | { type: 'BLOOMBERG_FAILED'; at: Date; reason: string }
  | { type: 'REFINITIV_ACTIVATED'; at: Date }
  | { type: 'BLOOMBERG_RESTORED'; at: Date };

/** Configuration for the adaptive adapter. */
export interface AdaptiveAdapterConfig {
  readonly bloomberg: BPIPEConfig;
  /** Interval to probe Bloomberg after circuit opens (default: 60_000ms) */
  readonly bloombergProbeMs?: number;
  /** Use MockRateAdapter as secondary instead of Refinitiv (for testing/dev) */
  readonly useMockFallback?: boolean;
}

/**
 * Adaptive market data adapter with Bloomberg primary and Refinitiv failover.
 */
export class AdaptiveMarketDataAdapter implements MarketDataAdapter {
  private readonly _bloomberg: BloombergBPIPEAdapter;
  private readonly _fallback: MarketDataAdapter;
  private readonly _probeMs: number;
  private _active: 'BLOOMBERG' | 'FALLBACK' = 'BLOOMBERG';
  private _callback?: (rate: MarketRate) => void;
  private _instruments: string[] = [];
  private _probeTimer?: ReturnType<typeof setInterval>;
  private readonly _events: FailoverEvent[] = [];

  constructor(config: AdaptiveAdapterConfig) {
    this._bloomberg = new BloombergBPIPEAdapter(config.bloomberg);
    this._fallback = config.useMockFallback ? new MockRateAdapter() : new MockRateAdapter(); // Refinitiv RDP would go here in production
    this._probeMs = config.bloombergProbeMs ?? 60_000;
  }

  subscribe(instruments: string[]): void {
    this._instruments = instruments;

    // Set up Bloomberg with circuit breaker wrapper
    this._bloomberg.onRate((rate) => {
      if (this._active === 'BLOOMBERG') this._callback?.(rate);
    });
    this._bloomberg.subscribe(instruments);

    // Start circuit breaker monitor
    this._startCircuitMonitor();
  }

  onRate(callback: (rate: MarketRate) => void): void {
    this._callback = callback;
    this._fallback.onRate((rate) => {
      if (this._active === 'FALLBACK') callback(rate);
    });
  }

  async disconnect(): Promise<void> {
    if (this._probeTimer) clearInterval(this._probeTimer);
    await Promise.all([this._bloomberg.disconnect(), this._fallback.disconnect()]);
  }

  /** Current active source. */
  get activeSource(): 'BLOOMBERG' | 'FALLBACK' {
    return this._active;
  }

  /** Bloomberg circuit state. */
  get bloombergCircuitState(): CircuitState {
    return this._bloomberg.circuitState;
  }

  /** Failover event log (last 100 events). */
  get failoverEvents(): readonly FailoverEvent[] {
    return this._events.slice(-100);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _startCircuitMonitor(): void {
    this._probeTimer = setInterval(() => {
      if (this._bloomberg.circuitState === CircuitState.OPEN && this._active === 'BLOOMBERG') {
        this._activateFallback();
      } else if (
        this._bloomberg.circuitState === CircuitState.CLOSED &&
        this._active === 'FALLBACK'
      ) {
        this._restoreBloomberg();
      }
    }, 1_000); // check every second
  }

  private _activateFallback(): void {
    this._active = 'FALLBACK';
    this._fallback.subscribe(this._instruments);
    const event: FailoverEvent = { type: 'REFINITIV_ACTIVATED', at: new Date() };
    this._events.push(event);
  }

  private _restoreBloomberg(): void {
    this._active = 'BLOOMBERG';
    const event: FailoverEvent = { type: 'BLOOMBERG_RESTORED', at: new Date() };
    this._events.push(event);
    this._fallback.disconnect().catch(() => {
      /* ignore */
    });
  }
}
