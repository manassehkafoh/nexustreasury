import { PrismaClient } from '@prisma/client';
import {
  Limit, LimitRepository, LimitId, LimitType, LimitLevel,
  CounterpartyId, BookId, TenantId, Money, Percentage,
} from '@nexustreasury/domain';

export class PrismaLimitRepository implements LimitRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: LimitId, tenantId: TenantId): Promise<Limit | null> {
    const row = await this.prisma.limit.findFirst({ where: { id, tenantId } });
    return row ? this.toDomain(row) : null;
  }

  async findByCounterparty(counterpartyId: CounterpartyId, tenantId: TenantId): Promise<Limit[]> {
    const rows = await this.prisma.limit.findMany({
      where: { entityId: counterpartyId, tenantId },
    });
    return rows.map((r) => this.toDomain(r));
  }

  async findByBook(bookId: BookId, tenantId: TenantId): Promise<Limit[]> {
    const rows = await this.prisma.limit.findMany({
      where: { entityId: bookId, tenantId, level: LimitLevel.BOOK },
    });
    return rows.map((r) => this.toDomain(r));
  }

  async findAllInBreach(tenantId: TenantId): Promise<Limit[]> {
    const rows = await this.prisma.limit.findMany({
      where: { tenantId, inBreach: true },
    });
    return rows.map((r) => this.toDomain(r));
  }

  async save(limit: Limit): Promise<void> {
    await this.prisma.limit.create({ data: this.toRow(limit) });
  }

  async update(limit: Limit): Promise<void> {
    await this.prisma.limit.update({
      where: { id: limit.id },
      data: this.toRow(limit),
    });
  }

  private toRow(l: Limit): Record<string, unknown> {
    return {
      id:               l.id,
      tenantId:         l.tenantId,
      limitType:        l.limitType,
      level:            l.level,
      entityId:         l['_entityId'] as string,
      limitAmount:      l.limitAmount.toNumber(),
      limitCurrency:    l.limitAmount.currency,
      utilisedAmount:   l.utilisedAmount.toNumber(),
      warningThreshold: l.warningThreshold.value,
      inBreach:         l.inBreach,
      version:          l.version,
    };
  }

  private toDomain(row: Record<string, unknown>): Limit {
    return Limit.create({
      tenantId:         TenantId(String(row['tenantId'])),
      limitType:        row['limitType'] as LimitType,
      level:            row['level'] as LimitLevel,
      limitAmount:      Money.of(Number(row['limitAmount']), String(row['limitCurrency'])),
      warningThreshold: Percentage.of(Number(row['warningThreshold'])),
      entityId:         String(row['entityId']),
    });
  }
}
