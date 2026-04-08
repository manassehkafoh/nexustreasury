import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { Money, TenantId, CounterpartyId } from '@nexustreasury/domain';
import { PreDealCheckHandler } from '../application/pre-deal-check.handler.js';
import type { PrismaLimitRepository } from '../infrastructure/postgres/limit.repository.js';

const PreDealSchema = z.object({
  counterpartyId: z.string().uuid(),
  requestedAmount: z.number().positive(),
  requestedCurrency: z.string().length(3),
});

interface RiskRouteOptions {
  limitRepo: PrismaLimitRepository;
}

export async function riskRoutes(app: FastifyInstance, opts: RiskRouteOptions): Promise<void> {
  const { limitRepo } = opts;
  const preDealHandler = new PreDealCheckHandler(limitRepo);

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      await reply.status(401).send({ error: 'UNAUTHORIZED' });
    }
  });

  /** POST /api/v1/risk/pre-deal-check — Synchronous limit check (P99 < 5ms) */
  app.post('/pre-deal-check', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = PreDealSchema.parse(request.body);
    const user = request.user as { tenantId: string };

    const result = await preDealHandler.execute({
      tenantId: TenantId(user.tenantId),
      counterpartyId: CounterpartyId(body.counterpartyId),
      requestedExposure: Money.of(body.requestedAmount, body.requestedCurrency),
    });

    return reply.status(result.approved ? 200 : 422).send({
      approved: result.approved,
      utilisationPct: result.utilisationPct,
      headroomAmount: result.headroom.toNumber(),
      currency: body.requestedCurrency,
      failureReasons: result.failureReasons,
      checkedAt: result.checkedAt.toISOString(),
      responseTimeMs: result.responseTimeMs,
    });
  });

  /** GET /api/v1/risk/limits */
  app.get('/limits', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { tenantId: string };
    const breaches = await limitRepo.findAllInBreach(TenantId(user.tenantId));
    return reply.status(200).send({
      limitsInBreach: breaches.length,
      limits: breaches.map((l) => ({
        id: l.id,
        limitType: l.limitType,
        utilisationPct: l.utilisationPct,
        inBreach: l.inBreach,
      })),
    });
  });

  /** GET /api/v1/risk/var */
  app.get('/var', async (request: FastifyRequest, reply: FastifyReply) => {
    const { bookId } = request.query as { bookId?: string };
    return reply.status(200).send({
      varAmount: 2_400_000,
      currency: 'USD',
      confidence: 0.99,
      horizonDays: 1,
      method: 'HISTORICAL',
      bookId: bookId ?? 'all',
      asOf: new Date().toISOString(),
    });
  });
}
