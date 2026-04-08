import { PrismaClient, Prisma } from '@prisma/client';
import {
  Trade,
  TradeRepository,
  TradeId,
  BookId,
  TenantId,
  AssetClass,
  TradeDirection,
  TradeStatus,
  Money,
  BusinessDate,
  CounterpartyId,
  InstrumentId,
  TraderId,
} from '@nexustreasury/domain';
import { logger } from '../logger.js';

export class PrismaTradeRepository implements TradeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: TradeId, tenantId: TenantId): Promise<Trade | null> {
    const row = await this.prisma.trade.findFirst({ where: { id, tenantId } });
    return row ? this.toDomain(row) : null;
  }

  async findByBookId(bookId: BookId, tenantId: TenantId): Promise<Trade[]> {
    const rows = await this.prisma.trade.findMany({
      where: { bookId, tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toDomain(r));
  }

  async save(trade: Trade): Promise<void> {
    await this.prisma.trade.create({ data: this.toCreateRow(trade) });
    await this.persistEvents(trade);
    logger.info({ tradeId: trade.id }, 'Trade persisted');
  }

  async update(trade: Trade): Promise<void> {
    await this.prisma.trade.update({
      where: { id: trade.id },
      data: this.toUpdateRow(trade),
    });
    await this.persistEvents(trade);
    logger.info({ tradeId: trade.id, version: trade.version }, 'Trade updated');
  }

  private async persistEvents(trade: Trade): Promise<void> {
    const events = trade.pullDomainEvents();
    if (events.length === 0) return;
    await this.prisma.tradeEvent.createMany({
      data: events.map((e) => ({
        tradeId: trade.id,
        tenantId: trade.tenantId,
        eventType: e.eventType,
        eventId: e.eventId,
        payload: JSON.stringify(e) as Prisma.InputJsonValue,
        occurredAt: e.occurredAt,
      })),
      skipDuplicates: true,
    });
  }

  private toCreateRow(trade: Trade): Prisma.TradeUncheckedCreateInput {
    return {
      id: trade.id,
      tenantId: trade.tenantId,
      reference: trade.reference,
      assetClass: trade.assetClass,
      direction: trade.direction,
      status: trade.status,
      counterpartyId: trade.counterpartyId,
      instrumentId: trade.instrumentId,
      bookId: trade.bookId,
      traderId: trade.traderId,
      notionalAmount: trade.notional.toNumber(),
      notionalCurrency: trade.notional.currency,
      price: trade.price,
      tradeDate: trade.tradeDate.toDate(),
      valueDate: trade.valueDate.toDate(),
      maturityDate: trade.maturityDate?.toDate() ?? null,
      version: trade.version,
    };
  }

  private toUpdateRow(trade: Trade): Prisma.TradeUncheckedUpdateInput {
    return {
      status: trade.status,
      notionalAmount: trade.notional.toNumber(),
      notionalCurrency: trade.notional.currency,
      price: trade.price,
      version: trade.version,
    };
  }

  private toDomain(row: Prisma.TradeGetPayload<object>): Trade {
    return Trade.book({
      tenantId: TenantId(row.tenantId),
      assetClass: row.assetClass as AssetClass,
      direction: row.direction as TradeDirection,
      counterpartyId: CounterpartyId(row.counterpartyId),
      instrumentId: InstrumentId(row.instrumentId),
      bookId: BookId(row.bookId),
      traderId: TraderId(row.traderId),
      notional: Money.of(Number(row.notionalAmount), row.notionalCurrency),
      price: Number(row.price),
      tradeDate: BusinessDate.fromDate(new Date(row.tradeDate)),
      valueDate: BusinessDate.fromDate(new Date(row.valueDate)),
      maturityDate: row.maturityDate
        ? BusinessDate.fromDate(new Date(row.maturityDate))
        : undefined,
      preDealCheck: {
        approved: true,
        limitUtilisationPct: 0,
        headroomAmount: Money.of(0, row.notionalCurrency),
        failureReasons: [],
        checkedAt: new Date(),
      },
    });
  }
}
