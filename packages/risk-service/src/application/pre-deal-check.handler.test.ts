import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PreDealCheckHandler } from './pre-deal-check.handler.js';
import {
  Limit,
  LimitType,
  LimitLevel,
  TenantId,
  CounterpartyId,
  Money,
  Percentage,
} from '@nexustreasury/domain';

const tenantId = TenantId('tenant-001');
const counterpartyId = CounterpartyId('cpty-001');
const usd50m = Money.of(50_000_000, 'USD');

function makeLimit(utilised = 0): Limit {
  const limit = Limit.create({
    tenantId,
    limitType: LimitType.COUNTERPARTY_CREDIT,
    level: LimitLevel.COUNTERPARTY,
    limitAmount: usd50m,
    warningThreshold: Percentage.of(80),
    entityId: 'cpty-001',
  });
  if (utilised > 0) limit.utilise(Money.of(utilised, 'USD'));
  limit.pullDomainEvents();
  return limit;
}

const makeRepo = (limits: Limit[]) => ({
  findByCounterparty: vi.fn().mockResolvedValue(limits),
  findById: vi.fn(),
  findByBook: vi.fn(),
  findAllInBreach: vi.fn(),
  save: vi.fn(),
  update: vi.fn(),
});

describe('PreDealCheckHandler', () => {
  it('approves when within limits', async () => {
    const handler = new PreDealCheckHandler(makeRepo([makeLimit(10_000_000)]) as never);
    const result = await handler.execute({
      tenantId,
      counterpartyId,
      requestedExposure: Money.of(5_000_000, 'USD'),
    });
    expect(result.approved).toBe(true);
  });

  it('rejects when projected exposure exceeds hard limit', async () => {
    const handler = new PreDealCheckHandler(makeRepo([makeLimit(48_000_000)]) as never);
    const result = await handler.execute({
      tenantId,
      counterpartyId,
      requestedExposure: Money.of(5_000_000, 'USD'),
    });
    expect(result.approved).toBe(false);
    expect(result.failureReasons.length).toBeGreaterThan(0);
  });

  it('approves when no limits configured', async () => {
    const handler = new PreDealCheckHandler(makeRepo([]) as never);
    const result = await handler.execute({
      tenantId,
      counterpartyId,
      requestedExposure: Money.of(100_000_000, 'USD'),
    });
    expect(result.approved).toBe(true);
  });

  it('returns correct headroom across multiple limits', async () => {
    const l1 = makeLimit(30_000_000);
    const l2 = makeLimit(40_000_000);
    const handler = new PreDealCheckHandler(makeRepo([l1, l2]) as never);
    const result = await handler.execute({
      tenantId,
      counterpartyId,
      requestedExposure: Money.of(5_000_000, 'USD'),
    });
    // Tightest limit: l2 has 10M headroom
    expect(result.headroom.toNumber()).toBeLessThanOrEqual(10_000_000);
  });

  it('populates responseTimeMs', async () => {
    const handler = new PreDealCheckHandler(makeRepo([makeLimit()]) as never);
    const result = await handler.execute({
      tenantId,
      counterpartyId,
      requestedExposure: Money.of(1_000_000, 'USD'),
    });
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
  });
});
