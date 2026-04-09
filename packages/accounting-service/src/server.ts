/**
 * @module accounting-service/server
 *
 * NexusTreasury Accounting Service — Fastify application bootstrap.
 *
 * Port: 4007
 * Prefix: /api/v1/accounting
 */

import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import { ChartOfAccounts } from './domain/chart-of-accounts.js';
import { accountingRoutes } from './routes/accounting.routes.js';

// ── Stub Repository (replace with Prisma impl in production) ─────────────────
import type { JournalEntryRepository } from './domain/journal-entry.aggregate.js';

class StubJournalEntryRepository implements JournalEntryRepository {
  private store = new Map<string, import('./domain/journal-entry.aggregate.js').JournalEntry>();
  async save(e: import('./domain/journal-entry.aggregate.js').JournalEntry) {
    this.store.set(e.id, e);
  }
  async findById(id: import('./domain/value-objects.js').JournalEntryId) {
    return this.store.get(id) ?? null;
  }
  async findByTradeId(
    tradeId: import('@nexustreasury/domain').TradeId,
    tenantId: import('@nexustreasury/domain').TenantId,
  ) {
    return [...this.store.values()].filter(
      (e) => e.sourceTradeId === tradeId && e.tenantId === tenantId,
    );
  }
  async findByDateRange(from: Date, to: Date, tenantId: import('@nexustreasury/domain').TenantId) {
    return [...this.store.values()].filter(
      (e) => e.tenantId === tenantId && e.postingDate >= from && e.postingDate <= to,
    );
  }
}

// ── Build App ─────────────────────────────────────────────────────────────────

export async function buildApp() {
  const app = Fastify({
    logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
  });

  await app.register(helmet);
  await app.register(rateLimit, { max: 200, timeWindow: '1 minute' });
  await app.register(jwt, {
    secret: process.env['JWT_SECRET'] ?? 'nexus-dev-secret-CHANGE-IN-PRODUCTION',
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'NexusTreasury Accounting Service',
        description: 'IFRS 9 accounting sub-ledger — journal entries, ECL, hedge accounting',
        version: '1.0.0',
      },
      tags: [{ name: 'accounting', description: 'Accounting operations' }],
    },
  });
  await app.register(swaggerUI, { routePrefix: '/docs' });

  // Health check
  app.get('/live', async () => ({ status: 'ok', service: 'accounting-service' }));
  app.get('/ready', async () => ({ status: 'ok', service: 'accounting-service' }));

  await app.register(accountingRoutes, {
    prefix: '/api/v1/accounting',
    journalEntryRepo: new StubJournalEntryRepository(),
    coa: ChartOfAccounts.standard(),
  });

  return app;
}

// ── Start ─────────────────────────────────────────────────────────────────────

if (process.env['NODE_ENV'] !== 'test') {
  const app = await buildApp();
  const port = parseInt(process.env['PORT'] ?? '4007', 10);
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`accounting-service listening on port ${port}`);
}
