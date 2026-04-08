/**
 * Rate publisher — receives market data from external providers
 * and publishes to nexus.marketdata.rates Kafka topic.
 *
 * Adapters:
 *  - BloombergBLPAPIAdapter  (production)
 *  - RefinitivRDPAdapter     (production)
 *  - MockRateAdapter         (dev / testing)
 */
export interface MarketRate {
  instrument: string;
  bid: number;
  ask: number;
  mid: number;
  currency: string;
  tenor?: string;
  timestamp: Date;
  source: 'BLOOMBERG' | 'REFINITIV' | 'INTERNAL' | 'MOCK';
}

export interface MarketDataAdapter {
  subscribe(instruments: string[]): void;
  onRate(callback: (rate: MarketRate) => void): void;
  disconnect(): Promise<void>;
}

export class MockRateAdapter implements MarketDataAdapter {
  private callback?: (rate: MarketRate) => void;
  private timer?: ReturnType<typeof setInterval>;

  subscribe(instruments: string[]): void {
    this.timer = setInterval(() => {
      for (const instrument of instruments) {
        const mid = 1.08 + (Math.random() - 0.5) * 0.002;
        this.callback?.({
          instrument,
          bid: mid - 0.0001,
          ask: mid + 0.0001,
          mid,
          currency: 'USD',
          timestamp: new Date(),
          source: 'MOCK',
        });
      }
    }, 5000);
  }

  onRate(callback: (rate: MarketRate) => void): void {
    this.callback = callback;
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
  }
}
