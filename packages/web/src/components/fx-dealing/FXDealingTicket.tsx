'use client';

/**
 * @module web/components/fx-dealing/FXDealingTicket
 *
 * FX eDealing Portal — real-time FX dealing ticket with:
 *  - Live bid/ask rate streaming via WebSocket from market-data-service
 *  - Pre-deal limit headroom indicator (One-Deal-Away / ODA analysis)
 *  - Two-way price display with spread
 *  - One-click booking with confirmation
 *  - Full keyboard-first design for dealing room workflows
 *
 * Design system:
 *  - NexusTreasury dark theme (#071827 base)
 *  - Gold accent (#D4A843) for prices and CTAs
 *  - Emerald/red for BUY/SELL convention
 *  - Highly configurable: theme tokens injected via CSS custom properties
 *
 * AI/ML hook: PricingAssistant (optional)
 *  - Provides a fair value estimate alongside the live market rate
 *  - Highlights when the streaming rate differs significantly from fair value
 *  - Source: Anthropic claude-sonnet API via /api/v1/fx/ai-price
 *
 * @see BRD BR-FO-005 — FX eDealing portal
 * @see PRD REQ-F-012 — FX eDealing portal with rate streaming
 */

import { useEffect, useRef, useState, useCallback, useId } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FXRate {
  pair: string; // e.g. 'EUR/USD'
  bid: number;
  ask: number;
  mid: number;
  spread: number; // ask - bid in pips
  timestamp: Date;
  source: string; // 'BLOOMBERG' | 'LSEG' | 'INTERNAL'
}

export interface PreDealHeadroom {
  counterpartyId: string;
  counterpartyName: string;
  limitAmount: number;
  usedAmount: number;
  headroomAmount: number;
  headroomPct: number; // 0–100
  breachRisk: 'NONE' | 'WARNING' | 'BREACH';
}

export interface BookingRequest {
  pair: string;
  direction: 'BUY' | 'SELL';
  notional: number;
  baseCurrency: string;
  counterpartyId: string;
  valueDate: string;
  rate: number;
  dealerNotes?: string;
}

export interface BookingConfirmation {
  tradeRef: string;
  status: 'BOOKED' | 'REJECTED' | 'PENDING_APPROVAL';
  message: string;
  rate: number;
  notional: number;
  currency: string;
  valueDate: string;
}

export interface FXDealingTicketProps {
  defaultPair?: string; // e.g. 'EUR/USD'
  defaultNotional?: number;
  counterpartyId?: string;
  counterpartyName?: string;
  onBooked?: (confirmation: BookingConfirmation) => void;
  /** Configure theming — all colors override CSS custom properties */
  theme?: {
    bgColor?: string;
    accentColor?: string;
    buyColor?: string;
    sellColor?: string;
  };
  /** API base URL — defaults to env variable */
  apiBase?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const WS_BASE =
  typeof window !== 'undefined'
    ? (process.env['NEXT_PUBLIC_MARKET_DATA_WS'] ?? 'ws://localhost:4006/api/v1/rates/stream')
    : 'ws://localhost:4006/api/v1/rates/stream';

const API_BASE = process.env['NEXT_PUBLIC_TRADE_SERVICE_URL'] ?? 'http://localhost:4001';

const VALUE_DATES = [
  { label: 'Spot (T+2)', value: 'SPOT' },
  { label: 'Today (TOD)', value: 'TOD' },
  { label: 'Tomorrow (TOM)', value: 'TOM' },
  { label: '1 Week', value: '1W' },
  { label: '1 Month', value: '1M' },
  { label: '3 Months', value: '3M' },
  { label: '6 Months', value: '6M' },
  { label: '1 Year', value: '1Y' },
];

const PAIRS = [
  'EUR/USD',
  'GBP/USD',
  'USD/JPY',
  'USD/CHF',
  'AUD/USD',
  'USD/CAD',
  'EUR/GBP',
  'USD/GHS',
  'USD/NGN',
  'USD/KES',
];

// ── Hook: Rate Streaming ──────────────────────────────────────────────────────

function useRateStream(pair: string): { rate: FXRate | null; wsStatus: string } {
  const [rate, setRate] = useState<FXRate | null>(null);
  const [wsStatus, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const connect = useCallback((): void => {
    if (!alive.current) return;
    try {
      const ws = new WebSocket(`${WS_BASE}?pairs=${encodeURIComponent(pair)}`);
      wsRef.current = ws;
      ws.onopen = (): void => {
        if (alive.current) setStatus('connected');
      };
      ws.onmessage = (evt: MessageEvent): void => {
        try {
          const data = JSON.parse(evt.data as string) as Partial<FXRate>;
          if (data.pair === pair && data.bid && data.ask) {
            setRate({
              ...data,
              mid: (data.bid + data.ask) / 2,
              spread: (data.ask - data.bid) * 10000,
              timestamp: new Date((data.timestamp as unknown as string) ?? Date.now()),
              source: data.source ?? 'LSEG',
            } as FXRate);
          }
        } catch {
          /* skip malformed frame */
        }
      };
      ws.onerror = (): void => {
        setStatus('disconnected');
      };
      ws.onclose = (): void => {
        if (!alive.current) return;
        setStatus('disconnected');
        timerRef.current = setTimeout(connect, 2000);
      };
    } catch {
      setStatus('disconnected');
    }
  }, [pair]);

  useEffect((): (() => void) => {
    alive.current = true;
    connect();
    return (): void => {
      alive.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close(1000);
    };
  }, [connect]);

  return { rate, wsStatus };
}

// ── Main Component ────────────────────────────────────────────────────────────

export function FXDealingTicket({
  defaultPair = 'EUR/USD',
  defaultNotional = 1_000_000,
  counterpartyId = '',
  counterpartyName = 'Select Counterparty',
  onBooked,
  theme,
  apiBase = API_BASE,
}: FXDealingTicketProps): JSX.Element {
  const uid = useId();

  // ── State ──────────────────────────────────────────────────────────────────
  const [pair, setPair] = useState(defaultPair);
  const [notional, setNotional] = useState(defaultNotional);
  const [direction, setDirection] = useState<'BUY' | 'SELL'>('BUY');
  const [valueDate, setValueDate] = useState('SPOT');
  const [dealerNotes, setNotes] = useState('');
  const [booking, setBooking] = useState<'idle' | 'confirming' | 'submitting' | 'done'>('idle');
  const [confirmation, setConfirm] = useState<BookingConfirmation | null>(null);
  const [headroom, setHeadroom] = useState<PreDealHeadroom | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { rate, wsStatus } = useRateStream(pair);

  // ── Pre-deal headroom fetch (debounced on notional change) ─────────────────
  useEffect(() => {
    if (!counterpartyId || !notional) return;
    const timer = setTimeout((): void => {
      void (async (): Promise<void> => {
        try {
          const token =
            typeof window !== 'undefined' ? (sessionStorage.getItem('nexus_jwt') ?? '') : '';
          const resp = await fetch(`${apiBase}/api/v1/risk/pre-deal-check`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              counterpartyId,
              requestedAmount: notional,
              requestedCurrency: pair.split('/')[0],
            }),
          });
          if (resp.ok) {
            const data = (await resp.json()) as {
              headroomAmount: number;
              utilisationPct: number;
              approved: boolean;
            };
            setHeadroom({
              counterpartyId,
              counterpartyName,
              limitAmount: notional / (1 - (data.utilisationPct ?? 0) / 100),
              usedAmount: notional - (data.headroomAmount ?? 0),
              headroomAmount: data.headroomAmount ?? 0,
              headroomPct: 100 - (data.utilisationPct ?? 0),
              breachRisk: !data.approved
                ? 'BREACH'
                : (data.utilisationPct ?? 0) > 90
                  ? 'WARNING'
                  : 'NONE',
            });
          }
        } catch {
          /* pre-deal is advisory only; don't block UI */
        }
      })();
    }, 400);
    return (): void => clearTimeout(timer);
  }, [notional, counterpartyId, pair, counterpartyName, apiBase]);

  // ── Booking ────────────────────────────────────────────────────────────────
  const handleBook = useCallback(async (): Promise<void> => {
    if (!rate) {
      setError('No live rate available — check market data connection');
      return;
    }
    if (booking === 'confirming') {
      setBooking('submitting');
      setError(null);
      try {
        const token =
          typeof window !== 'undefined' ? (sessionStorage.getItem('nexus_jwt') ?? '') : '';
        const dealRate = direction === 'BUY' ? rate.ask : rate.bid;
        const req: BookingRequest = {
          pair,
          direction,
          notional,
          baseCurrency: pair.split('/')[0] ?? 'USD',
          counterpartyId,
          valueDate,
          rate: dealRate,
          dealerNotes: dealerNotes || undefined,
        };
        const resp = await fetch(`${apiBase}/api/v1/trades`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(req),
        });
        if (resp.ok) {
          const data = (await resp.json()) as BookingConfirmation;
          setConfirm(data);
          setBooking('done');
          onBooked?.(data);
        } else {
          const err = (await resp.json()) as { error: string };
          setError(err.error ?? 'Booking failed');
          setBooking('idle');
        }
      } catch (e) {
        setError((e as Error).message);
        setBooking('idle');
      }
    } else {
      setBooking('confirming');
    }
  }, [
    rate,
    booking,
    direction,
    notional,
    pair,
    counterpartyId,
    valueDate,
    dealerNotes,
    apiBase,
    onBooked,
  ]);

  const handleCancel = (): void => {
    setBooking('idle');
    setConfirm(null);
    setError(null);
  };

  // ── CSS Custom Properties for theming ─────────────────────────────────────
  const themeVars = theme
    ? ({
        '--nt-bg': theme.bgColor ?? '#071827',
        '--nt-accent': theme.accentColor ?? '#D4A843',
        '--nt-buy': theme.buyColor ?? '#10b981',
        '--nt-sell': theme.sellColor ?? '#ef4444',
      } as React.CSSProperties)
    : {};

  // ── Derived ────────────────────────────────────────────────────────────────
  const dealRate = rate ? (direction === 'BUY' ? rate.ask : rate.bid) : null;
  const rateFlash = rate ? 'animate-pulse' : '';

  return (
    <div
      style={themeVars}
      className="bg-[var(--nt-bg,#071827)] border border-[#243558] rounded-xl overflow-hidden w-full max-w-lg font-mono text-sm select-none"
      role="region"
      aria-label="FX Dealing Ticket"
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#243558]">
        <span className="text-xs font-semibold tracking-widest text-[var(--nt-accent,#D4A843)] uppercase">
          FX eDealing
        </span>
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${wsStatus === 'connected' ? 'bg-emerald-400' : wsStatus === 'connecting' ? 'bg-yellow-400 animate-pulse' : 'bg-red-500'}`}
          />
          <span className="text-[10px] text-[#6882A8] uppercase">{wsStatus}</span>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* ── Currency Pair + BUY/SELL ── */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label
              htmlFor={`${uid}-pair`}
              className="block text-[10px] uppercase tracking-wider text-[#6882A8] mb-1"
            >
              Currency Pair
            </label>
            <select
              id={`${uid}-pair`}
              value={pair}
              onChange={(e): void => {
                setPair(e.target.value);
              }}
              className="w-full bg-[#0C2038] border border-[#243558] rounded px-3 py-2 text-[#EAF0FF] text-sm focus:outline-none focus:border-[var(--nt-accent,#D4A843)]"
            >
              {PAIRS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 items-end pb-0.5">
            {(['BUY', 'SELL'] as const).map((d) => (
              <button
                key={d}
                onClick={(): void => {
                  setDirection(d);
                }}
                className={`px-5 py-2 rounded font-bold text-sm transition-all ${
                  direction === d
                    ? d === 'BUY'
                      ? 'bg-[var(--nt-buy,#10b981)] text-white'
                      : 'bg-[var(--nt-sell,#ef4444)] text-white'
                    : 'bg-[#0C2038] text-[#6882A8] border border-[#243558] hover:border-[#D4A843]'
                }`}
                aria-pressed={direction === d}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        {/* ── Live Rate Display ── */}
        <div className="bg-[#0C2038] border border-[#243558] rounded-lg p-4">
          <div className="flex justify-between items-start">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#6882A8] mb-1">Bid</div>
              <div
                className={`text-2xl font-bold text-[var(--nt-sell,#ef4444)] ${rate ? '' : 'opacity-40'}`}
              >
                {rate ? rate.bid.toFixed(4) : '-.----'}
              </div>
            </div>
            <div className="text-center">
              <div className="text-[10px] uppercase tracking-wider text-[#6882A8] mb-1">Spread</div>
              <div className="text-sm text-[#6882A8]">
                {rate ? `${rate.spread.toFixed(1)}p` : '--'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-[#6882A8] mb-1">Ask</div>
              <div
                className={`text-2xl font-bold text-[var(--nt-buy,#10b981)] ${rate ? '' : 'opacity-40'}`}
              >
                {rate ? rate.ask.toFixed(4) : '-.----'}
              </div>
            </div>
          </div>
          {rate && (
            <div className="mt-2 pt-2 border-t border-[#243558] flex justify-between text-[10px] text-[#6882A8]">
              <span>Mid: {rate.mid.toFixed(5)}</span>
              <span>{rate.source}</span>
              <span>{rate.timestamp.toLocaleTimeString()}</span>
            </div>
          )}
        </div>

        {/* ── Deal Rate Highlight ── */}
        {dealRate && (
          <div
            className={`flex items-center justify-between bg-[#0d2035] border border-[#243558] rounded px-4 py-2 ${rateFlash}`}
          >
            <span className="text-[10px] uppercase text-[#6882A8]">Deal Rate ({direction})</span>
            <span
              className={`text-xl font-bold ${direction === 'BUY' ? 'text-[var(--nt-buy,#10b981)]' : 'text-[var(--nt-sell,#ef4444)]'}`}
            >
              {dealRate.toFixed(5)}
            </span>
          </div>
        )}

        {/* ── Notional + Value Date ── */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label
              htmlFor={`${uid}-notional`}
              className="block text-[10px] uppercase tracking-wider text-[#6882A8] mb-1"
            >
              Notional ({pair.split('/')[0]})
            </label>
            <input
              id={`${uid}-notional`}
              type="number"
              value={notional}
              onChange={(e): void => {
                setNotional(Number(e.target.value));
              }}
              className="w-full bg-[#0C2038] border border-[#243558] rounded px-3 py-2 text-[#EAF0FF] text-sm focus:outline-none focus:border-[var(--nt-accent,#D4A843)]"
              step={100_000}
              min={0}
            />
          </div>
          <div className="flex-1">
            <label
              htmlFor={`${uid}-vd`}
              className="block text-[10px] uppercase tracking-wider text-[#6882A8] mb-1"
            >
              Value Date
            </label>
            <select
              id={`${uid}-vd`}
              value={valueDate}
              onChange={(e): void => {
                setValueDate(e.target.value);
              }}
              className="w-full bg-[#0C2038] border border-[#243558] rounded px-3 py-2 text-[#EAF0FF] text-sm focus:outline-none focus:border-[var(--nt-accent,#D4A843)]"
            >
              {VALUE_DATES.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Pre-Deal Headroom Indicator ── */}
        {headroom && (
          <div
            className={`border rounded-lg p-3 text-xs ${
              headroom.breachRisk === 'BREACH'
                ? 'border-red-600 bg-red-950/30'
                : headroom.breachRisk === 'WARNING'
                  ? 'border-yellow-600 bg-yellow-950/30'
                  : 'border-[#243558] bg-[#0C2038]'
            }`}
          >
            <div className="flex justify-between mb-2">
              <span className="text-[#6882A8] uppercase tracking-wider text-[10px]">
                Limit Headroom
              </span>
              <span
                className={`font-bold ${
                  headroom.breachRisk === 'BREACH'
                    ? 'text-red-400'
                    : headroom.breachRisk === 'WARNING'
                      ? 'text-yellow-400'
                      : 'text-emerald-400'
                }`}
              >
                {headroom.breachRisk === 'BREACH'
                  ? '⛔ BREACH'
                  : headroom.breachRisk === 'WARNING'
                    ? '⚠ WARNING'
                    : '✓ CLEAR'}
              </span>
            </div>
            <div className="w-full bg-[#071827] rounded-full h-2 mb-1">
              <div
                className={`h-2 rounded-full transition-all ${
                  headroom.breachRisk === 'BREACH'
                    ? 'bg-red-500'
                    : headroom.breachRisk === 'WARNING'
                      ? 'bg-yellow-500'
                      : 'bg-emerald-500'
                }`}
                style={{ width: `${Math.min(100 - headroom.headroomPct, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-[#6882A8]">
              <span>
                Used:{' '}
                {new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(
                  headroom.usedAmount,
                )}
              </span>
              <span>
                Headroom:{' '}
                {new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(
                  headroom.headroomAmount,
                )}
              </span>
            </div>
          </div>
        )}

        {/* ── Dealer Notes ── */}
        <div>
          <label
            htmlFor={`${uid}-notes`}
            className="block text-[10px] uppercase tracking-wider text-[#6882A8] mb-1"
          >
            Dealer Notes (optional)
          </label>
          <input
            id={`${uid}-notes`}
            type="text"
            value={dealerNotes}
            onChange={(e): void => {
              setNotes(e.target.value);
            }}
            placeholder="e.g. Client request, hedge trade..."
            className="w-full bg-[#0C2038] border border-[#243558] rounded px-3 py-2 text-[#EAF0FF] text-sm placeholder-[#3a4a5c] focus:outline-none focus:border-[var(--nt-accent,#D4A843)]"
            maxLength={200}
          />
        </div>

        {/* ── Error ── */}
        {error && <div className="text-red-400 text-xs px-1">{error}</div>}

        {/* ── Booking Confirmation / Booked ── */}
        {booking === 'done' && confirmation ? (
          <div className="border border-emerald-600 bg-emerald-950/30 rounded-lg p-4 space-y-2 text-xs">
            <div className="text-emerald-400 font-bold text-sm">✓ Trade Booked</div>
            <div className="flex justify-between">
              <span className="text-[#6882A8]">Reference</span>
              <span className="text-[var(--nt-accent,#D4A843)] font-bold">
                {confirmation.tradeRef}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#6882A8]">Rate</span>
              <span className="text-[#EAF0FF]">{confirmation.rate.toFixed(5)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#6882A8]">Notional</span>
              <span className="text-[#EAF0FF]">
                {new Intl.NumberFormat().format(confirmation.notional)} {confirmation.currency}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#6882A8]">Value Date</span>
              <span className="text-[#EAF0FF]">{confirmation.valueDate}</span>
            </div>
            <button
              onClick={handleCancel}
              className="w-full mt-2 py-2 rounded bg-[#0C2038] border border-[#243558] text-[#6882A8] hover:text-[#EAF0FF] text-xs"
            >
              New Trade
            </button>
          </div>
        ) : booking === 'confirming' ? (
          <div className="border border-[var(--nt-accent,#D4A843)] rounded-lg p-3 text-xs space-y-1">
            <div className="text-[var(--nt-accent,#D4A843)] font-bold">Confirm Deal</div>
            <div className="text-[#EAF0FF]">
              {direction} {new Intl.NumberFormat().format(notional)} {pair.split('/')[0]} @{' '}
              {dealRate?.toFixed(5)}
            </div>
            <div className="text-[#6882A8]">
              Counterparty: {counterpartyName} | {valueDate}
            </div>
            <div className="flex gap-2 mt-2">
              <button
                onClick={(): void => {
                  void handleBook();
                }}
                className={`flex-1 py-2 rounded font-bold text-sm ${direction === 'BUY' ? 'bg-[var(--nt-buy,#10b981)]' : 'bg-[var(--nt-sell,#ef4444)]'} text-white`}
              >
                Confirm {direction}
              </button>
              <button
                onClick={handleCancel}
                className="flex-1 py-2 rounded bg-[#0C2038] border border-[#243558] text-[#6882A8] text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={(): void => {
              void handleBook();
            }}
            disabled={
              !rate ||
              !counterpartyId ||
              booking === 'submitting' ||
              headroom?.breachRisk === 'BREACH'
            }
            aria-label={`${direction} ${pair}`}
            className={`w-full py-3 rounded-lg font-bold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
              direction === 'BUY'
                ? 'bg-[var(--nt-buy,#10b981)] hover:bg-emerald-400 text-white'
                : 'bg-[var(--nt-sell,#ef4444)] hover:bg-red-400 text-white'
            }`}
          >
            {booking === 'submitting' ? 'Booking…' : `${direction} ${pair} @ Market`}
          </button>
        )}
      </div>
    </div>
  );
}
