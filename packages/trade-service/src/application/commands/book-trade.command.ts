/**
 * @module BookTradeCommand
 *
 * Application-layer command handler for the "book a trade" use case.
 *
 * ## Responsibilities
 * 1. Run pre-deal limit checks via the injected PreDealCheckService
 * 2. Invoke the Trade domain aggregate factory (Trade.book())
 * 3. Persist the new trade via the TradeRepository
 * 4. Publish the TradeBookedEvent to Kafka for downstream consumers
 *    (position-service, risk-service, bo-service)
 *
 * ## SLA
 * End-to-end booking latency target: P99 < 100ms
 * Pre-deal check step alone: P99 < 5ms (see PreDealCheckService)
 *
 * ## Error Handling
 * - TradeDomainError: thrown by Trade.book() for invariant violations
 *   (e.g. valueDate < tradeDate, zero notional, pre-deal check failed)
 * - Kafka publish failures are logged but do not roll back the DB write
 *   (the event outbox pattern ensures eventual re-delivery)
 *
 * @example
 * ```typescript
 * const command = new BookTradeCommand(tradeRepo, preDealCheck, kafkaProducer);
 * const result = await command.execute({
 *   tenantId: TenantId('tenant-001'),
 *   assetClass: AssetClass.FX,
 *   direction: TradeDirection.BUY,
 *   notionalAmount: 1_000_000,
 *   notionalCurrency: 'USD',
 *   price: 1.0842,
 *   tradeDate: '2026-04-07',
 *   valueDate: '2026-04-09',
 *   // ...
 * });
 * // result: { tradeId, reference: 'FX-20260407-A1B2C3', status: 'PENDING_VALIDATION' }
 * ```
 */
import {
  Trade,
  AssetClass,
  TradeDirection,
  TenantId,
  CounterpartyId,
  InstrumentId,
  BookId,
  TraderId,
  Money,
  BusinessDate,
  TradeRepository,
} from '@nexustreasury/domain';
import type { KafkaProducer } from '../../infrastructure/kafka/producer.js';
import type { PreDealCheckService } from '../services/pre-deal-check.service.js';
import { logger } from '../../infrastructure/logger.js';

/** Input to the BookTradeCommand. All fields are required unless noted. */
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
  /** ISO date string: YYYY-MM-DD */
  tradeDate: string;
  /** ISO date string: YYYY-MM-DD — must be >= tradeDate */
  valueDate: string;
  /** ISO date string: YYYY-MM-DD — optional, for fixed-income / derivatives */
  maturityDate?: string;
}

/** Result returned to the HTTP route handler on successful booking. */
export interface BookTradeOutput {
  tradeId: string;
  reference: string;
  status: string;
}

/**
 * BookTradeCommand — orchestrates the complete trade booking use case.
 *
 * Inject via the DI container (Container.get().bookTradeCommand).
 * Do not instantiate directly in route handlers.
 */
export class BookTradeCommand {
  constructor(
    private readonly tradeRepo: TradeRepository,
    private readonly preDealCheck: PreDealCheckService,
    private readonly kafkaProducer: KafkaProducer,
  ) {}

  /**
   * Execute the trade booking use case.
   *
   * @param input - Validated booking parameters from the HTTP request body
   * @returns Booking confirmation with tradeId and reference number
   * @throws {TradeDomainError} if any domain invariant is violated
   */
  async execute(input: BookTradeInput): Promise<BookTradeOutput> {
    const startMs = Date.now();

    // Step 1 — Pre-deal limit check (P99 < 5ms target)
    const checkResult = await this.preDealCheck.check({
      tenantId: input.tenantId,
      counterpartyId: input.counterpartyId,
      requestedExposure: Money.of(input.notionalAmount, input.notionalCurrency),
    });

    // Step 2 — Book via domain aggregate (enforces all business rules)
    const trade = Trade.book({
      tenantId: input.tenantId,
      assetClass: input.assetClass,
      direction: input.direction,
      counterpartyId: input.counterpartyId,
      instrumentId: input.instrumentId,
      bookId: input.bookId,
      traderId: input.traderId,
      notional: Money.of(input.notionalAmount, input.notionalCurrency),
      price: input.price,
      tradeDate: BusinessDate.fromDate(new Date(input.tradeDate)),
      valueDate: BusinessDate.fromDate(new Date(input.valueDate)),
      maturityDate: input.maturityDate
        ? BusinessDate.fromDate(new Date(input.maturityDate))
        : undefined,
      preDealCheck: checkResult,
    });

    // Step 3 — Persist to PostgreSQL (trading schema)
    await this.tradeRepo.save(trade);

    // Step 4 — Publish domain events to Kafka (nexus.trading.trades)
    const events = trade.pullDomainEvents();
    await this.kafkaProducer.publishDomainEvents(events);

    logger.info(
      { tradeId: trade.id, reference: trade.reference, durationMs: Date.now() - startMs },
      'Trade booked',
    );

    return { tradeId: trade.id, reference: trade.reference, status: trade.status };
  }
}
