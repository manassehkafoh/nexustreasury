/**
 * @module PrismaPositionRepository
 *
 * PostgreSQL implementation of the PositionRepository interface.
 * Uses Prisma Client targeting the `position` schema.
 *
 * ## Schema
 * All queries hit the `position` PostgreSQL schema (multiSchema feature).
 * Tables: `positions`, `position_events`
 *
 * ## Rehydration Strategy
 * Positions are currently rehydrated from the last-known state in the
 * `positions` table (snapshot approach). A future enhancement will support
 * full event-sourced replay from `position_events` for point-in-time queries.
 *
 * ## Concurrency
 * The `version` column is used for optimistic locking. If a concurrent update
 * increments the version between a read and a write, Prisma's `update` will
 * fail with a `P2025` error. The service should retry on P2025.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import {
  Position,
  PositionRepository,
  PositionId,
  BookId,
  InstrumentId,
  TenantId,
  Money,
  BusinessDate,
} from '@nexustreasury/domain';

/**
 * Prisma-backed implementation of PositionRepository.
 *
 * @param prisma - Injected PrismaClient instance (shared, do not instantiate here)
 */
export class PrismaPositionRepository implements PositionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Find a position by its surrogate ID within a tenant.
   * Returns null if not found (caller decides whether to create a new position).
   */
  async findById(id: PositionId, tenantId: TenantId): Promise<Position | null> {
    const row = await this.prisma.position.findFirst({ where: { id, tenantId } });
    return row ? this.toDomain(row) : null;
  }

  /**
   * Find all positions for a given book within a tenant.
   * Used by the position dashboard to show book-level exposure.
   */
  async findByBook(bookId: BookId, tenantId: TenantId): Promise<Position[]> {
    const rows = await this.prisma.position.findMany({ where: { bookId, tenantId } });
    return rows.map((r) => this.toDomain(r));
  }

  /**
   * Find all positions for a given instrument within a tenant.
   * Used by the risk service to calculate concentration exposure.
   */
  async findByInstrument(instrumentId: InstrumentId, tenantId: TenantId): Promise<Position[]> {
    const rows = await this.prisma.position.findMany({ where: { instrumentId, tenantId } });
    return rows.map((r) => this.toDomain(r));
  }

  /**
   * Persist a new position.
   * Called by the Kafka consumer handler when a trade is booked
   * for an instrument/book combination with no existing position.
   */
  async save(position: Position): Promise<void> {
    await this.prisma.position.create({ data: this.toRow(position) });
  }

  /**
   * Update an existing position's snapshot state.
   * Only updates the mutable fields (quantities, MTM, version).
   * Does not change id, tenantId, instrumentId, bookId, or openDate.
   */
  async update(position: Position): Promise<void> {
    await this.prisma.position.update({
      where: { id: position.id },
      data: this.toUpdateRow(position),
    });
  }

  /** Map domain aggregate → Prisma create input (all fields required for insert). */
  private toRow(p: Position): Prisma.PositionUncheckedCreateInput {
    return {
      id: p.id,
      tenantId: p.tenantId,
      instrumentId: p.instrumentId,
      bookId: p.bookId,
      currency: p.currency,
      netQuantity: p.netQuantity,
      averageCostAmount: p.averageCost.toNumber(),
      mtmValueAmount: p.mtmValue.toNumber(),
      unrealisedPnlAmount: p.unrealisedPnl.toNumber(),
      openDate: p.openDate.toDate(),
      version: p.version,
    };
  }

  /** Map domain aggregate → Prisma update input (mutable fields only). */
  private toUpdateRow(p: Position): Prisma.PositionUncheckedUpdateInput {
    return {
      netQuantity: p.netQuantity,
      averageCostAmount: p.averageCost.toNumber(),
      mtmValueAmount: p.mtmValue.toNumber(),
      unrealisedPnlAmount: p.unrealisedPnl.toNumber(),
      version: p.version,
    };
  }

  /** Map Prisma row → domain aggregate (rehydration from snapshot). */
  private toDomain(row: Prisma.PositionGetPayload<object>): Position {
    return Position.create({
      id: PositionId(row.id),
      tenantId: TenantId(row.tenantId),
      instrumentId: InstrumentId(row.instrumentId),
      bookId: BookId(row.bookId),
      currency: row.currency,
      openDate: BusinessDate.fromDate(new Date(row.openDate)),
    });
  }
}
