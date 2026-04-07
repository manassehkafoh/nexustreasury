'use client';

import { useState, useEffect } from 'react';

interface BlotterRow {
  id: string;
  reference: string;
  assetClass: string;
  direction: 'BUY' | 'SELL';
  notional: number;
  currency: string;
  price: number;
  status: string;
  pnl: number;
  counterparty: string;
  bookedAt: string;
}

const ASSET_CLASS_COLORS: Record<string, string> = {
  FX:                         'text-yellow-400',
  FIXED_INCOME:               'text-blue-400',
  MONEY_MARKET:               'text-teal-400',
  INTEREST_RATE_DERIVATIVE:   'text-purple-400',
  REPO:                       'text-orange-400',
};

export function TradingBlotter(): JSX.Element {
  const [trades, setTrades] = useState<BlotterRow[]>([]);
  const [isLive, setIsLive] = useState(true);

  // TODO: Replace with real WebSocket subscription
  useEffect(() => {
    const mockTrades: BlotterRow[] = [
      { id: '1', reference: 'FX-0407-A3B2',  assetClass: 'FX',             direction: 'BUY',  notional: 12500000, currency: 'USD', price: 1.0842, status: 'CONFIRMED', pnl: 14250,  counterparty: 'Republic Bank Group',  bookedAt: '09:14:32' },
      { id: '2', reference: 'FI-0407-C9D3',  assetClass: 'FIXED_INCOME',   direction: 'BUY',  notional: 5000000,  currency: 'USD', price: 98.25,  status: 'CONFIRMED', pnl: 8100,   counterparty: 'CIBC FirstCaribbean',  bookedAt: '09:22:11' },
      { id: '3', reference: 'MM-0407-F1A4',  assetClass: 'MONEY_MARKET',   direction: 'SELL', notional: 25000000, currency: 'TTD', price: 100.00, status: 'CONFIRMED', pnl: -2300,  counterparty: 'Scotiabank TT',        bookedAt: '09:45:07' },
      { id: '4', reference: 'IRD-0407-B8C3', assetClass: 'INTEREST_RATE_DERIVATIVE', direction: 'BUY', notional: 30000000, currency: 'USD', price: 4.25, status: 'CONFIRMED', pnl: 45000, counterparty: 'National Bank TT', bookedAt: '10:02:44' },
      { id: '5', reference: 'REPO-0407-E2F', assetClass: 'REPO',           direction: 'SELL', notional: 8500000,  currency: 'USD', price: 5.10,  status: 'CONFIRMED', pnl: 3200,   counterparty: 'Republic Bank Group',  bookedAt: '10:18:55' },
    ];
    setTrades(mockTrades);
  }, []);

  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);

  return (
    <div className="bg-[#071827] border border-white/[0.065] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.065] bg-[#0C2038]">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest">Live Trade Blotter</h2>
          {isLive && (
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-[10px] font-semibold text-green-400">LIVE</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-gray-500">{trades.length} trades today</span>
          <span className={`text-sm font-bold ${totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            Total P&L: {totalPnl >= 0 ? '+' : ''}${totalPnl.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/[0.04]">
              {['Reference', 'Asset', 'Dir', 'Notional', 'Price', 'Counterparty', 'Status', 'P&L', 'Time'].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-[9px] font-semibold text-gray-600 uppercase tracking-widest">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trades.map((trade, i) => (
              <tr key={trade.id} className={`border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors ${i === 0 ? 'bg-teal-500/[0.03]' : ''}`}>
                <td className="px-4 py-3 text-[10px] font-mono text-gray-400">{trade.reference}</td>
                <td className={`px-4 py-3 text-[10px] font-semibold ${ASSET_CLASS_COLORS[trade.assetClass] ?? 'text-gray-300'}`}>
                  {trade.assetClass === 'FIXED_INCOME' ? 'FI' : trade.assetClass === 'MONEY_MARKET' ? 'MM' : trade.assetClass === 'INTEREST_RATE_DERIVATIVE' ? 'IRD' : trade.assetClass}
                </td>
                <td className={`px-4 py-3 text-[10px] font-semibold ${trade.direction === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{trade.direction}</td>
                <td className="px-4 py-3 text-xs text-white">{trade.currency} {(trade.notional / 1_000_000).toFixed(1)}M</td>
                <td className="px-4 py-3 text-xs text-gray-300">{trade.price.toFixed(4)}</td>
                <td className="px-4 py-3 text-xs text-gray-400">{trade.counterparty}</td>
                <td className="px-4 py-3">
                  <span className="text-[9px] bg-green-400/10 text-green-400 px-2 py-0.5 rounded-full font-medium">{trade.status}</span>
                </td>
                <td className={`px-4 py-3 text-xs font-semibold ${trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-[10px] font-mono text-gray-500">{trade.bookedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
