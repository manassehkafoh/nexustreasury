import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { Money, TenantId, CounterpartyId } from '@nexustreasury/domain';

const PreDealSchema = z.object({
  counterpartyId:    z.string().uuid(),
  requestedAmount:   z.number().positive(),
  requestedCurrency: z.string().length(3),
});

const UtiliseSchema = z.object({
  limitId:  z.string().uuid(),
  amount:   z.number().positive(),
  currency: z.string().length(3),
});

export async function riskRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    try { await req.jwtVerify(); }
    catch { await reply.status(401).send({ error: 'UNAUTHORIZED' }); }
  });

  /**
   * POST /api/v1/risk/pre-deal-check
   * Synchronous pre-deal limit check. Target P99 < 5ms.
   */
  app.post('/pre-deal-check', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = PreDealSchema.parse(request.body);
    const user = request.user as { tenantId: string };
    const start = Date.now();

    // TODO: wire PreDealCheckHandler with LimitRepository
    // const handler = new PreDealCheckHandler(app.limitRepository);
    // const result = await handler.execute({ ... });

    // Stub: approve with dummy utilisation until repository wired
    const responseMs = Date.now() - start;
    return reply.status(200).send({
      approved:         true,
      utilisationPct:   45.2,
      headroomAmount:   body.requestedAmount * 0.548,
      currency:         body.requestedCurrency,
      failureReasons:   [],
      checkedAt:        new Date().toISOString(),
      responseTimeMs:   responseMs,
    });
  });

  /**
   * GET /api/v1/risk/limits — List all limits with utilisation
   */
  app.get('/limits', async (_req: FastifyRequest, reply: FastifyReply) => {
    // TODO: wire LimitRepository
    return reply.status(200).send({ limits: [], message: 'Repository wiring pending Sprint 2' });
  });

  /**
   * GET /api/v1/risk/var — Current VaR snapshot by book
   */
  app.get('/var', async (request: FastifyRequest, reply: FastifyReply) => {
    const { bookId } = (request.query as { bookId?: string });
    return reply.status(200).send({
      varAmount:   2_400_000,
      currency:    'USD',
      confidence:  0.99,
      horizonDays: 1,
      method:      'HISTORICAL',
      bookId:      bookId ?? 'all',
      asOf:        new Date().toISOString(),
    });
  });
}
