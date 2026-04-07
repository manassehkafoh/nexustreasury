import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';

// Hoist all module mocks
vi.mock('../container.js', () => ({
  Container: {
    get: vi.fn(() => ({
      connect:         vi.fn().mockResolvedValue(undefined),
      disconnect:      vi.fn().mockResolvedValue(undefined),
      tradeRepository: {
        findById:    vi.fn().mockResolvedValue(null),
        save:        vi.fn().mockResolvedValue(undefined),
        update:      vi.fn().mockResolvedValue(undefined),
        findByBookId: vi.fn().mockResolvedValue([]),
      },
      bookTradeCommand: {
        execute: vi.fn().mockResolvedValue({
          tradeId: 'trade-uuid-001',
          reference: 'FX-20260407-TEST1',
          status: 'PENDING_VALIDATION',
        }),
      },
    })),
  },
}));

vi.mock('../infrastructure/kafka/producer.js', () => ({
  KafkaProducer: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    publishDomainEvents: vi.fn().mockResolvedValue(undefined),
  })),
}));

const TEST_SECRET = 'test-jwt-secret-route-tests';

async function buildTestServer() {
  const app = Fastify({ logger: false });

  await app.register(jwt, { secret: TEST_SECRET });

  // Minimal container plugin mock
  app.decorate('tradeRepository', {
    findById: vi.fn().mockResolvedValue({
      id: 'trade-uuid-001',
      reference: 'FX-20260407-TEST1',
      status: 'PENDING_VALIDATION',
    }),
    save: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
  });

  const { tradeRoutes } = await import('./trade.routes.js');
  await app.register(tradeRoutes, { prefix: '/api/v1/trades' });
  await app.ready();
  return app;
}

function makeToken(app: ReturnType<typeof Fastify>, tenantId = 'tenant-001') {
  // @ts-expect-error test helper
  return app.jwt.sign({ tenantId, sub: 'user-001' });
}

const VALID_BODY = {
  assetClass: 'FX', direction: 'BUY',
  counterpartyId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  instrumentId:   '7a1b2c3d-4e5f-6789-abcd-ef0123456789',
  bookId:         '1234abcd-ab12-1234-1234-123412341234',
  traderId:       'abcd1234-1234-abcd-abcd-abcd12341234',
  notionalAmount: 1_000_000, notionalCurrency: 'USD',
  price: 1.0842, tradeDate: '2026-04-07', valueDate: '2026-04-09',
};

describe('Trade Routes — HTTP layer', () => {
  let app: Awaited<ReturnType<typeof buildTestServer>>;
  let token: string;

  beforeAll(async () => {
    app = await buildTestServer();
    token = makeToken(app);
  });

  afterAll(async () => { await app.close(); });

  describe('POST /api/v1/trades', () => {
    it('returns 401 without JWT', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/trades', payload: VALID_BODY });
      expect(res.statusCode).toBe(401);
    });

    it('returns 201 with valid payload', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/trades',
        headers: { authorization: `Bearer ${token}` },
        payload: VALID_BODY,
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ tradeId: string; reference: string }>();
      expect(body.tradeId).toBeDefined();
      expect(body.reference).toMatch(/^FX-/);
    });

    it('returns 400 with invalid assetClass', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/trades',
        headers: { authorization: `Bearer ${token}` },
        payload: { ...VALID_BODY, assetClass: 'INVALID_CLASS' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 with negative notional', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/trades',
        headers: { authorization: `Bearer ${token}` },
        payload: { ...VALID_BODY, notionalAmount: -500 },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/v1/trades/:tradeId', () => {
    it('returns 401 without JWT', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/trades/trade-uuid-001' });
      expect(res.statusCode).toBe(401);
    });

    it('returns 200 for existing trade', async () => {
      const res = await app.inject({
        method: 'GET', url: '/api/v1/trades/trade-uuid-001',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
    });
  });
});
