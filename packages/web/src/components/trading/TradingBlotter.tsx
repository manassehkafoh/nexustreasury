'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

export interface BlotterRow {
  tradeId:    string;
  reference:  string;
  assetClass: string;
  direction:  'BUY' | 'SELL';
  counterparty: string;
  instrument: string;
  notional:   number;
  currency:   string;
  price:      number;
  status:     string;
  tradeDate:  string;
  valueDate:  string;
  bookedAt:   string;
}

type WSStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

const TRADE_SERVICE_WS =
  process.env['NEXT_PUBLIC_TRADE_SERVICE_WS'] ?? 'ws://localhost:4001/api/v1/trades/stream';
const MAX_BLOTTER_ROWS = 200;
const RECONNECT_MS     = [1_000, 2_000, 5_000, 10_000]; // exponential back-off steps

export function TradingBlotter() {
  const [trades,    setTrades]    = useState<BlotterRow[]>([]);
  const [status,    setStatus]    = useState<WSStatus>('disconnected');
  const [lastError, setLastError] = useState<string | null>(null);

  const wsRef         = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef    = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    const token = sessionStorage.getItem('nexus_jwt') ?? '';
    const url   = `${TRADE_SERVICE_WS}?token=${encodeURIComponent(token)}`;

    setStatus(retryCountRef.current === 0 ? 'connecting' : 'reconnecting');
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) { ws.close(); return; }
      retryCountRef.current = 0;
      setStatus('connected');
      setLastError(null);
    };

    ws.onmessage = (evt: MessageEvent) => {
      try {
        const payload = JSON.parse(evt.data as string) as BlotterRow | BlotterRow[];
        const incoming = Array.isArray(payload) ? payload : [payload];
        setTrades(prev =>
          [...incoming, ...prev].slice(0, MAX_BLOTTER_ROWS)
        );
      } catch { /* malformed frame — skip */ }
    };

    ws.onerror = () => setLastError('WebSocket error');

    ws.onclose = (evt) => {
      if (!mountedRef.current) return;
      setStatus('disconnected');
      // Reconnect with back-off unless intentionally closed (code 1000)
      if (evt.code !== 1000) {
        const delay = RECONNECT_MS[Math.min(retryCountRef.current, RECONNECT_MS.length - 1)] ?? 10_000;
        retryCountRef.current++;
        retryTimerRef.current = setTimeout(connect, delay);
      }
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      wsRef.current?.close(1000, 'Component unmounted');
    };
  }, [connect]);

  const statusColor: Record<WSStatus, string> = {
    connected:    'text-emerald-400',
    connecting:   'text-yellow-400',
    reconnecting: 'text-yellow-500',
    disconnected: 'text-red-400',
  };
  const statusDot: Record<WSStatus, string> = {
    connected:    'bg-emerald-400',
    connecting:   'bg-yellow-400 animate-pulse',
    reconnecting: 'bg-yellow-500 animate-pulse',
    disconnected: 'bg-red-500',
  };

  return (
    <div className="bg-[#071827] border border-[#243558] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#243558]">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold tracking-widest text-[#D4A843] uppercase">
            Live Trading Blotter
          </span>
          <span className="text-[#6882A8] text-xs">
            ({trades.length} trades)
          </span>
        </div>
        <div className="flex items-center gap-2">
          {lastError && (
            <span className="text-xs text-red-400 mr-2">{lastError}</span>
          )}
          <span className={`text-xs font-mono ${statusColor[status]}`}>
            {status.toUpperCase()}
          </span>
          <div className={`w-2 h-2 rounded-full ${statusDot[status]}`} />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[#6882A8] uppercase tracking-wider border-b border-[#243558]">
              {['Reference','Asset','Dir','Counterparty','Instrument','Notional','Price','Status','Value Date'].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trades.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-[#6882A8]">
                  {status === 'connected'
                    ? 'Waiting for trades…'
                    : status === 'disconnected'
                      ? 'Stream disconnected — reconnecting…'
                      : 'Connecting to trade stream…'}
                </td>
              </tr>
            ) : (
              trades.map((t) => (
                <tr key={t.tradeId}
                  className="border-b border-[#0d2035] hover:bg-[#0C2038] transition-colors">
                  <td className="px-3 py-2 font-mono text-[#D4A843] whitespace-nowrap">{t.reference}</td>
                  <td className="px-3 py-2 text-[#EAF0FF]">{t.assetClass}</td>
                  <td className={`px-3 py-2 font-semibold ${t.direction === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {t.direction}
                  </td>
                  <td className="px-3 py-2 text-[#EAF0FF] whitespace-nowrap">{t.counterparty}</td>
                  <td className="px-3 py-2 text-[#EAF0FF] whitespace-nowrap">{t.instrument}</td>
                  <td className="px-3 py-2 font-mono text-right text-[#EAF0FF]">
                    {new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(t.notional)}
                    <span className="text-[#6882A8] ml-1">{t.currency}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-right text-[#EAF0FF]">
                    {t.price.toFixed(4)}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                      t.status === 'SETTLED'   ? 'bg-emerald-900 text-emerald-300' :
                      t.status === 'CANCELLED' ? 'bg-red-900 text-red-300' :
                      'bg-yellow-900 text-yellow-300'}`}>
                      {t.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-[#6882A8] whitespace-nowrap">{t.valueDate}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
