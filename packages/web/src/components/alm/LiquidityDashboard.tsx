'use client';

export function LiquidityDashboard(): JSX.Element {
  const buckets = [
    { label: 'O/N', gap: 850, pct: 85 },
    { label: '1W', gap: 720, pct: 72 },
    { label: '1M', gap: 600, pct: 60 },
    { label: '3M', gap: 650, pct: 65 },
    { label: '6M', gap: 500, pct: 50 },
    { label: '1Y', gap: 550, pct: 55 },
    { label: '2Y', gap: 420, pct: 42 },
    { label: '5Y', gap: 300, pct: 30 },
    { label: '10Y+', gap: 200, pct: 20 },
  ];

  return (
    <div className="bg-[#071827] border border-white/[0.065] rounded-xl p-5 h-full">
      <h2 className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-4">
        Liquidity Dashboard
      </h2>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="bg-teal-500/[0.06] border border-teal-500/20 rounded-lg p-4 text-center">
          <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-2">LCR</div>
          <div className="text-3xl font-bold text-teal-400 font-serif">142%</div>
          <div className="text-[10px] text-gray-500 mt-1">Min: 100%</div>
          <div className="h-1 bg-white/[0.06] rounded-full mt-2 overflow-hidden">
            <div className="h-full w-[71%] bg-teal-400/70 rounded-full" />
          </div>
        </div>
        <div className="bg-blue-500/[0.06] border border-blue-500/20 rounded-lg p-4 text-center">
          <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-2">NSFR</div>
          <div className="text-3xl font-bold text-blue-400 font-serif">118%</div>
          <div className="text-[10px] text-gray-500 mt-1">Min: 100%</div>
          <div className="h-1 bg-white/[0.06] rounded-full mt-2 overflow-hidden">
            <div className="h-full w-[59%] bg-blue-400/70 rounded-full" />
          </div>
        </div>
      </div>

      <div>
        <div className="text-[9px] text-gray-600 uppercase tracking-wider mb-3">
          Cumulative Liquidity Gap (USD Mn)
        </div>
        <div className="flex items-end gap-1 h-16">
          {buckets.map(({ label, pct }, i) => (
            <div key={label} className="flex-1 flex flex-col items-center gap-1">
              <div
                className="w-full rounded-t"
                style={{
                  height: `${pct}%`,
                  background:
                    i < 5
                      ? `rgba(0, 200, 150, ${0.25 + i * 0.02})`
                      : `rgba(61, 139, 240, ${0.3 - (i - 5) * 0.03})`,
                }}
              />
              <span className="text-[8px] text-gray-600">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
