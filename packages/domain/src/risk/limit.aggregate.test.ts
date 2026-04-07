import { describe, it, expect } from 'vitest';
import { Limit, LimitType, LimitLevel, LimitDomainError } from './limit.aggregate.js';
import { TenantId, Money, Percentage, CounterpartyId } from '../shared/value-objects.js';

const tenantId = TenantId('tenant-001');
const params = {
  tenantId,
  limitType: LimitType.COUNTERPARTY_CREDIT,
  level: LimitLevel.COUNTERPARTY,
  limitAmount: Money.of(50_000_000, 'USD'),
  warningThreshold: Percentage.of(80),
  entityId: 'cpty-001',
};

describe('Limit Aggregate', () => {
  describe('create()', () => {
    it('creates a limit with zero utilisation', () => {
      const limit = Limit.create(params);
      expect(limit.utilisedAmount.toNumber()).toBe(0);
      expect(limit.utilisationPct).toBe(0);
      expect(limit.inBreach).toBe(false);
    });

    it('throws on non-positive limit amount', () => {
      expect(() =>
        Limit.create({ ...params, limitAmount: Money.of(0, 'USD') }),
      ).toThrow(LimitDomainError);
    });

    it('throws when warning threshold is 100%', () => {
      expect(() =>
        Limit.create({ ...params, warningThreshold: Percentage.of(100) }),
      ).toThrow(LimitDomainError);
    });
  });

  describe('checkPreDeal()', () => {
    it('approves within limit', () => {
      const limit = Limit.create(params);
      const result = limit.checkPreDeal({
        counterpartyId: CounterpartyId('cpty-001'),
        requestedExposure: Money.of(20_000_000, 'USD'),
        tenantId,
      });
      expect(result.approved).toBe(true);
      expect(result.utilisationPct).toBe(40);
    });

    it('rejects when projected exposure exceeds hard limit', () => {
      const limit = Limit.create(params);
      limit.utilise(Money.of(45_000_000, 'USD'));
      const result = limit.checkPreDeal({
        counterpartyId: CounterpartyId('cpty-001'),
        requestedExposure: Money.of(10_000_000, 'USD'),
        tenantId,
      });
      expect(result.approved).toBe(false);
      expect(result.failureReasons.length).toBeGreaterThan(0);
    });
  });

  describe('utilise()', () => {
    it('fires LimitBreachedEvent when hard limit crossed', () => {
      const limit = Limit.create(params);
      limit.utilise(Money.of(51_000_000, 'USD'));
      const events = limit.pullDomainEvents();
      expect(events.some(e => e.eventType === 'nexus.risk.limit.breached')).toBe(true);
    });

    it('throws on negative utilisation amount', () => {
      const limit = Limit.create(params);
      expect(() => limit.utilise(Money.of(-1, 'USD'))).toThrow(LimitDomainError);
    });
  });

  describe('release()', () => {
    it('releases exposure correctly', () => {
      const limit = Limit.create(params);
      limit.utilise(Money.of(20_000_000, 'USD'));
      limit.pullDomainEvents();
      limit.release(Money.of(5_000_000, 'USD'));
      expect(limit.utilisedAmount.toNumber()).toBe(15_000_000);
    });

    it('throws when releasing more than utilised', () => {
      const limit = Limit.create(params);
      limit.utilise(Money.of(10_000_000, 'USD'));
      expect(() => limit.release(Money.of(20_000_000, 'USD'))).toThrow(LimitDomainError);
    });

    it('fires LimitResolvedEvent when breach clears', () => {
      const limit = Limit.create(params);
      limit.utilise(Money.of(52_000_000, 'USD'));
      limit.pullDomainEvents();
      limit.release(Money.of(10_000_000, 'USD'));
      const events = limit.pullDomainEvents();
      expect(events.some(e => e.eventType === 'nexus.risk.limit.resolved')).toBe(true);
    });
  });
});
