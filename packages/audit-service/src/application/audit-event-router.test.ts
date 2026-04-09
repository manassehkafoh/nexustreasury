/**
 * Audit Service — TDD test suite
 * Tests: HMAC tamper evidence, routing, search, anomaly scoring
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createAuditRecord,
  verifyAuditRecord,
  AuditCategory,
  AuditSeverity,
  type CreateAuditRecordInput,
} from '../domain/audit-record.js';
import { AuditEventRouter, InMemoryAuditRepository } from './audit-event-router.js';

const HMAC_KEY = 'test-hmac-key-32-chars-minimum!!';

const baseInput: CreateAuditRecordInput = {
  tenantId: 'tenant-001',
  eventId: 'evt-abc',
  eventType: 'nexus.trading.trades.booked',
  category: AuditCategory.TRADE,
  severity: AuditSeverity.INFO,
  entityId: 'trade-001',
  entityType: 'Trade',
  actor: { userId: 'user-01', username: 'alex.dealer', roles: ['TREASURY_DEALER'] },
  occurredAt: new Date('2026-04-09T10:00:00Z'),
  payload: { tradeId: 'trade-001', notional: 1_000_000, currency: 'USD' },
};

// ── Audit Record Factory ──────────────────────────────────────────────────────

describe('createAuditRecord', () => {
  it('creates a record with all required fields', () => {
    const rec = createAuditRecord(baseInput, HMAC_KEY);
    expect(rec.auditId).toBeTruthy();
    expect(rec.checksum).toBeTruthy();
    expect(rec.tenantId).toBe('tenant-001');
    expect(rec.category).toBe(AuditCategory.TRADE);
    expect(rec.severity).toBe(AuditSeverity.INFO);
  });

  it('generates a unique auditId each call', () => {
    const r1 = createAuditRecord(baseInput, HMAC_KEY);
    const r2 = createAuditRecord(baseInput, HMAC_KEY);
    expect(r1.auditId).not.toBe(r2.auditId);
  });

  it('sets recordedAt ≥ occurredAt', () => {
    const rec = createAuditRecord(baseInput, HMAC_KEY);
    expect(rec.recordedAt.getTime()).toBeGreaterThanOrEqual(rec.occurredAt.getTime());
  });

  it('checksum is a 64-char hex string (SHA-256)', () => {
    const rec = createAuditRecord(baseInput, HMAC_KEY);
    expect(rec.checksum).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ── HMAC Tamper Evidence ──────────────────────────────────────────────────────

describe('verifyAuditRecord', () => {
  it('returns true for an untampered record', () => {
    const rec = createAuditRecord(baseInput, HMAC_KEY);
    expect(verifyAuditRecord(rec, HMAC_KEY)).toBe(true);
  });

  it('returns false when payload is mutated', () => {
    const rec = createAuditRecord(baseInput, HMAC_KEY);
    const tampered = { ...rec, payload: { ...rec.payload, notional: 999_999_999 } };
    expect(verifyAuditRecord(tampered, HMAC_KEY)).toBe(false);
  });

  it('returns false when entityId is mutated', () => {
    const rec = createAuditRecord(baseInput, HMAC_KEY);
    const tampered = { ...rec, entityId: 'evil-trade' };
    expect(verifyAuditRecord(tampered, HMAC_KEY)).toBe(false);
  });

  it('returns false when wrong HMAC key used', () => {
    const rec = createAuditRecord(baseInput, HMAC_KEY);
    expect(verifyAuditRecord(rec, 'wrong-key')).toBe(false);
  });

  it('returns false when actor.userId is mutated', () => {
    const rec = createAuditRecord(baseInput, HMAC_KEY);
    const tampered = { ...rec, actor: { ...rec.actor, userId: 'attacker' } };
    expect(verifyAuditRecord(tampered, HMAC_KEY)).toBe(false);
  });
});

// ── Audit Event Router ────────────────────────────────────────────────────────

describe('AuditEventRouter', () => {
  let repo: InMemoryAuditRepository;
  let router: AuditEventRouter;

  beforeEach(() => {
    repo = new InMemoryAuditRepository();
    router = new AuditEventRouter(repo, undefined, HMAC_KEY);
  });

  it('routes nexus.trading.trades.booked to TRADE category', async () => {
    const record = await router.route({
      topic: 'nexus.trading.trades.booked',
      value: JSON.stringify({
        tradeId: 't1',
        tenantId: 'tenant-001',
        eventId: 'e1',
        occurredAt: new Date().toISOString(),
      }),
      offset: '0',
      partition: 0,
    });
    expect(record).not.toBeNull();
    expect(record!.category).toBe(AuditCategory.TRADE);
    expect(record!.entityType).toBe('Trade');
  });

  it('routes nexus.risk.limit-breach to RISK CRITICAL', async () => {
    const record = await router.route({
      topic: 'nexus.risk.limit-breach',
      value: JSON.stringify({
        limitId: 'l1',
        tenantId: 'tenant-001',
        eventId: 'e2',
        occurredAt: new Date().toISOString(),
      }),
      offset: '1',
      partition: 0,
    });
    expect(record!.category).toBe(AuditCategory.RISK);
    expect(record!.severity).toBe(AuditSeverity.CRITICAL);
  });

  it('routes nexus.bo.reconciliation-break to SETTLEMENT CRITICAL', async () => {
    const record = await router.route({
      topic: 'nexus.bo.reconciliation-break',
      value: JSON.stringify({
        statementEntryId: 'se1',
        tenantId: 'tenant-001',
        eventId: 'e3',
        occurredAt: new Date().toISOString(),
      }),
      offset: '2',
      partition: 0,
    });
    expect(record!.category).toBe(AuditCategory.SETTLEMENT);
    expect(record!.severity).toBe(AuditSeverity.CRITICAL);
  });

  it('extracts actor from Kafka headers', async () => {
    const record = await router.route({
      topic: 'nexus.trading.trades.booked',
      value: JSON.stringify({
        tradeId: 't2',
        tenantId: 'tenant-001',
        eventId: 'e4',
        occurredAt: new Date().toISOString(),
      }),
      headers: {
        'x-user-id': 'user-99',
        'x-username': 'sofia.risk',
        'x-roles': 'RISK_MANAGER,BO_SUPERVISOR',
      },
      offset: '3',
      partition: 0,
    });
    expect(record!.actor.userId).toBe('user-99');
    expect(record!.actor.username).toBe('sofia.risk');
    expect(record!.actor.roles).toContain('RISK_MANAGER');
  });

  it('appends record to repository', async () => {
    await router.route({
      topic: 'nexus.trading.trades.booked',
      value: JSON.stringify({
        tradeId: 't3',
        tenantId: 'tenant-001',
        eventId: 'e5',
        occurredAt: new Date().toISOString(),
      }),
      offset: '4',
      partition: 0,
    });
    expect(repo.records).toHaveLength(1);
  });

  it('returns null for unknown topic', async () => {
    const record = await router.route({
      topic: 'some.unknown.topic',
      value: '{}',
      offset: '5',
      partition: 0,
    });
    expect(record).toBeNull();
  });

  it('written record passes HMAC verification', async () => {
    const record = await router.route({
      topic: 'nexus.trading.trades.booked',
      value: JSON.stringify({
        tradeId: 't4',
        tenantId: 'tenant-001',
        eventId: 'e6',
        occurredAt: new Date().toISOString(),
      }),
      offset: '6',
      partition: 0,
    });
    expect(verifyAuditRecord(record!, HMAC_KEY)).toBe(true);
  });
});

// ── In-Memory Repository Search ───────────────────────────────────────────────

describe('InMemoryAuditRepository', () => {
  it('searches by tenantId and category', async () => {
    const repo = new InMemoryAuditRepository();
    const rec = createAuditRecord(baseInput, HMAC_KEY);
    await repo.append(rec);
    await repo.append(
      createAuditRecord(
        { ...baseInput, category: AuditCategory.RISK, eventId: 'e2', tenantId: 'tenant-002' },
        HMAC_KEY,
      ),
    );

    const result = await repo.search({ tenantId: 'tenant-001', category: AuditCategory.TRADE });
    expect(result.total).toBe(1);
    expect(result.records[0]!.category).toBe(AuditCategory.TRADE);
  });

  it('respects limit and offset', async () => {
    const repo = new InMemoryAuditRepository();
    for (let i = 0; i < 5; i++) {
      await repo.append(createAuditRecord({ ...baseInput, eventId: `e${i}` }, HMAC_KEY));
    }
    const page = await repo.search({ tenantId: 'tenant-001', limit: 2, offset: 0 });
    expect(page.records).toHaveLength(2);
    expect(page.total).toBe(5);
  });
});
