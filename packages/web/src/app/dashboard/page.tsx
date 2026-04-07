import { TradingBlotter } from '@/components/trading/TradingBlotter';
import { LiquidityDashboard } from '@/components/alm/LiquidityDashboard';
import { RiskLimitPanel } from '@/components/risk/RiskLimitPanel';

export default function DashboardPage(): JSX.Element {
  return (
    <main className="min-h-screen bg-[#030C1B] p-6">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#D4A843] font-serif">NexusTreasury</h1>
          <p className="text-sm text-gray-400 mt-1">Treasury Management Platform</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs text-green-400 font-medium">LIVE</span>
        </div>
      </header>

      <div className="grid grid-cols-12 gap-6">
        {/* Trade Blotter — spans full width */}
        <section className="col-span-12">
          <TradingBlotter />
        </section>

        {/* Liquidity — 8 cols */}
        <section className="col-span-8">
          <LiquidityDashboard />
        </section>

        {/* Risk Limits — 4 cols */}
        <section className="col-span-4">
          <RiskLimitPanel />
        </section>
      </div>
    </main>
  );
}
