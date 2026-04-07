import { PrismaClient } from '@prisma/client';
import {
  Trade, TradeRepository, TradeId, BookId, TenantId,
  AssetClass, TradeDirection, TradeStatus,
  Money, BusinessDate, CounterpartyId, InstrumentId, TraderId,
} from '@nexustreasury/domain';
import { logger } from '../logger.js';

/**
 * PostgreSQL implementation of TradeRepository using Prisma.
 * Operates within the `trading` schema with Row Level Security.
 */
export class PrismaTradeRepository implements TradeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: TradeId, tenantId: TenantId): Promise<Trade | null> {
    const row = await this.prisma.trade.findFirst({
      where: { id, tenantId },
    });
    if (!row) return null;
    return this.toDomain(row);
  }

  async findByBookId(bookId: BookId, tenantId: TenantId): Promise<Trade[]> {
    const rows = await this.prisma.trade.findMany({
      where: { bookId, tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toDomain(r));
  }

  async save(trade: Trade): Promise<void> {
    const data = this.toRow(trade);
    await this.prisma.trade.create({ data });
    await this.persistEvents(trade);
    logger.info({ tradeId: trade.id }, 'Trade persisted');
  }

  async update(trade: Trade): Promise<void> {
    const { id, tenantId, ...data } = this.toRow(trade);
    await this.prisma.trade.update({
      where: { id },
      data: { ...data, version: trade.version },
    });
    await this.persistEvents(trade);
    logger.info({ tradeId: trade.id, version: trade.version }, 'Trade updated');
  }

  private async persistEvents(trade: Trade): Promise<void> {
    const events = trade.pullDomainEvents();
    if (events.length === 0) return;
    await this.prisma.tradeEvent.createMany({
      data: events.map((e) => ({
        tradeId:    trade.id,
        tenantId:   trade.tenantId,
        eventType:  e.eventType,
        eventId:    e.eventId,
        payload:    JSON.stringify(e),
        occurredAt: e.occurredAt,
      })),
      skipDuplicates: true,  // idempotency: safe to replay
    });
  }

  private toRow(trade: Trade): Record<string, unknown> {
    return {
      id:              trade.id,
      tenantId:        trade.tenantId,
      reference:       trade.reference,
      assetClass:      trade.assetClass,
      direction:       trade.direction,
      status:          trade.status,
      counterpartyId:  trade.counterpartyId,
      instrumentId:    trade.instrumentId,
      bookId:          trade.bookId,
      traderId:        trade.traderId,
      notionalAmount:  trade.notional.toNumber(),
      notionalCurrency:trade.notional.currency,
      price:           trade.price,
      tradeDate:       trade.tradeDate.toDate(),
      valueDate:       trade.valueDate.toDate(),
      maturityDate:    trade.maturityDate?.toDate() ?? null,
      version:         trade.version,
    };
  }

  private toDomain(row: Record<string, unknown>): Trade {
    // Reconstitute aggregate from persisted row
    // NOTE: This uses the internal factory bypass for rehydration.
    // In production, consider a full event-sourced replay from TradeEvent table.
    return Trade.book({
      tenantId:       TenantId(String(row['tenantId'])),
      assetClass:     row['assetClass'] as AssetClass,
      direction:      row['direction'] as TradeDirection,
      counterpartyId: CounterpartyId(String(row['counterpartyId'])),
      instrumentId:   InstrumentId(String(row['instrumentId'])),
      bookId:         BookId(String(row['bookId'])),
      traderId:       TraderId(String(row['traderId'])),
      notional:       Money.of(Number(row['notionalAmount']), String(row['notionalCurrency'])),
      price:          Number(row['price']),
      tradeDate:      BusinessDate.fromDate(new Date(String(row['tradeDate']))),
      valueDate:      BusinessDate.fromDate(new Date(String(row['valueDate']))),
      maturityDate:   row['maturityDate']
        ? BusinessDate.fromDate(new Date(String(row['maturityDate'])))
        : undefined,
      preDealCheck: {
        approved: true,
        limitUtilisationPct: 0,
        headroomAmount: Money.of(0, String(row['notionalCurrency'])),
        failureReasons: [],
        checkedAt: new Date(),
      },
    });
  }
}
