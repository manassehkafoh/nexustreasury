export interface TradeBookedPayload {
  eventId: string;
  tenantId: string;
  tradeId: string;
  reference: string;
  assetClass:
    | 'FX'
    | 'FIXED_INCOME'
    | 'MONEY_MARKET'
    | 'INTEREST_RATE_DERIVATIVE'
    | 'EQUITY'
    | 'COMMODITY'
    | 'REPO'
    | 'ISLAMIC_FINANCE';
  instrumentType: string;
  direction: 'BUY' | 'SELL';
  notional: number;
  currency: string;
  counterpartyCurrency?: string;
  price: number;
  counterpartyId: string;
  bookId: string;
  traderId: string;
  tradeDate: string;
  valueDate: string;
  status: string;
  occurredAt: string;
}
