import { PrismaClient } from '@prisma/client';
import {
  Position, PositionRepository, PositionId, BookId, InstrumentId, TenantId,
  Money, BusinessDate,
} from '@nexustreasury/domain';

export class PrismaPositionRepository implements PositionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: PositionId, tenantId: TenantId): Promise<Position | null> {
    const row = await this.prisma.position.findFirst({ where: { id, tenantId } });
    if (!row) return null;
    return this.toDomain(row);
  }

  async findByBook(bookId: BookId, tenantId: TenantId): Promise<Position[]> {
    const rows = await this.prisma.position.findMany({ where: { bookId, tenantId } });
    return rows.map((r) => this.toDomain(r));
  }

  async findByInstrument(instrumentId: InstrumentId, tenantId: TenantId): Promise<Position[]> {
    const rows = await this.prisma.position.findMany({ where: { instrumentId, tenantId } });
    return rows.map((r) => this.toDomain(r));
  }

  async save(position: Position): Promise<void> {
    await this.prisma.position.create({ data: this.toRow(position) });
  }

  async update(position: Position): Promise<void> {
    await this.prisma.position.update({
      where: { id: position.id },
      data: this.toRow(position),
    });
  }

  private toRow(p: Position): Record<string, unknown> {
    return {
      id: p.id, tenantId: p.tenantId,
      instrumentId: p.instrumentId, bookId: p.bookId,
      currency: p.currency,
      netQuantity: p.netQuantity,
      averageCostAmount: p.averageCost.toNumber(),
      mtmValueAmount: p.mtmValue.toNumber(),
      unrealisedPnlAmount: p.unrealisedPnl.toNumber(),
      openDate: p.openDate.toDate(),
      version: p.version,
    };
  }

  private toDomain(row: Record<string, unknown>): Position {
    return Position.create({
      id:           PositionId(String(row['id'])),
      tenantId:     TenantId(String(row['tenantId'])),
      instrumentId: InstrumentId(String(row['instrumentId'])),
      bookId:       BookId(String(row['bookId'])),
      currency:     String(row['currency']),
      openDate:     BusinessDate.fromDate(new Date(String(row['openDate']))),
    });
  }
}
