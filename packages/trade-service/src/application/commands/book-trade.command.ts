import {
  Trade, AssetClass, TradeDirection, TenantId,
  CounterpartyId, InstrumentId, BookId, TraderId,
  Money, BusinessDate, TradeRepository,
} from '@nexustreasury/domain';
import type { KafkaProducer } from '../../infrastructure/kafka/producer.js';
import type { PreDealCheckService } from '../services/pre-deal-check.service.js';
import { logger } from '../../infrastructure/logger.js';

export interface BookTradeInput {
  tenantId: TenantId;
  assetClass: AssetClass;
  direction: TradeDirection;
  counterpartyId: CounterpartyId;
  instrumentId: InstrumentId;
  bookId: BookId;
  traderId: TraderId;
  notionalAmount: number;
  notionalCurrency: string;
  price: number;
  tradeDate: string;
  valueDate: string;
  maturityDate?: string;
}

export interface BookTradeOutput {
  tradeId: string;
  reference: string;
  status: string;
}

export class BookTradeCommand {
  constructor(
    private readonly tradeRepo: TradeRepository,
    private readonly preDealCheck: PreDealCheckService,
    private readonly kafkaProducer: KafkaProducer,
  ) {}

  async execute(input: BookTradeInput): Promise<BookTradeOutput> {
    const startMs = Date.now();

    // 1. Pre-deal limit check via gRPC (target P99 < 5ms)
    const checkResult = await this.preDealCheck.check({
      tenantId:          input.tenantId,
      counterpartyId:    input.counterpartyId,
      requestedExposure: Money.of(input.notionalAmount, input.notionalCurrency),
    });

    // 2. Book trade aggregate (domain invariants enforced)
    const trade = Trade.book({
      tenantId:       input.tenantId,
      assetClass:     input.assetClass,
      direction:      input.direction,
      counterpartyId: input.counterpartyId,
      instrumentId:   input.instrumentId,
      bookId:         input.bookId,
      traderId:       input.traderId,
      notional:       Money.of(input.notionalAmount, input.notionalCurrency),
      price:          input.price,
      tradeDate:      BusinessDate.fromDate(new Date(input.tradeDate)),
      valueDate:      BusinessDate.fromDate(new Date(input.valueDate)),
      maturityDate:   input.maturityDate
        ? BusinessDate.fromDate(new Date(input.maturityDate))
        : undefined,
      preDealCheck: checkResult,
    });

    // 3. Persist
    await this.tradeRepo.save(trade);

    // 4. Publish domain events to Kafka
    const events = trade.pullDomainEvents();
    await this.kafkaProducer.publishDomainEvents(events);

    logger.info(
      { tradeId: trade.id, reference: trade.reference, durationMs: Date.now() - startMs },
      'Trade booked',
    );

    return { tradeId: trade.id, reference: trade.reference, status: trade.status };
  }
}
