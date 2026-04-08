'use client';

interface LimitItem {
  counterparty: string;
  utilised: number;
  limit: number;
  pct: number;
  warning: boolean;
}

export function RiskLimitPanel(): JSX.Element {
  const limits: LimitItem[] = [
    { counterparty: 'Republic Bank Group', utilised: 34, limit: 50, pct: 68, warning: false },
    { counterparty: 'CIBC FirstCaribbean', utilised: 22.5, limit: 50, pct: 45, warning: false },
    { counterparty: 'Scotiabank TT', utilised: 44.5, limit: 50, pct: 89, warning: true },
    { counterparty: 'National Bank TT', utilised: 16, limit: 50, pct: 32, warning: false },
  ];

  return (
    <div className="bg-[#071827] border border-white/[0.065] rounded-xl p-5 h-full">
      <h2 className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-4">
        Counterparty Limits
      </h2>

      <div className="flex flex-col gap-4 mb-5">
        {limits.map((l) => (
          <div key={l.counterparty}>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-gray-400 truncate max-w-[150px]">{l.counterparty}</span>
              <span className={l.warning ? 'text-yellow-400 font-semibold' : 'text-gray-600'}>
                {l.utilised}M / {l.limit}M {l.warning ? '⚠' : ''}
              </span>
            </div>
            <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${l.pct}%`,
                  background: l.warning ? '#D4A843' : l.pct > 50 ? '#3D8BF0' : '#00C896',
                  opacity: 0.75,
                }}
              />
            </div>
            <div
              className={`text-[9px] text-right mt-0.5 ${l.warning ? 'text-yellow-400' : 'text-gray-600'}`}
            >
              {l.pct}% utilised
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2 pt-4 border-t border-white/[0.04]">
        <div className="text-center">
          <div className="text-lg font-bold text-teal-400 font-serif">$2.4M</div>
          <div className="text-[9px] text-gray-600 mt-0.5">Daily VaR</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-green-400 font-serif">0</div>
          <div className="text-[9px] text-gray-600 mt-0.5">Breaches</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-blue-400 font-serif">$1.2M</div>
          <div className="text-[9px] text-gray-600 mt-0.5">CVA</div>
        </div>
      </div>
    </div>
  );
}
