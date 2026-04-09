import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { Money, TenantId, CounterpartyId } from '@nexustreasury/domain';
import { PreDealCheckHandler } from '../application/pre-deal-check.handler.js';
import { VaRCalculator } from '../application/var/var-calculator.js';
import { FRTBSAEngine, FRTBRiskClass } from '../application/frtb/frtb-sa-engine.js';
import type { PrismaLimitRepository } from '../infrastructure/postgres/limit.repository.js';

const PreDealSchema = z.object({
  counterpartyId: z.string().uuid(),
  requestedAmount: z.number().positive(),
  requestedCurrency: z.string().length(3),
});

interface RiskRouteOptions {
  limitRepo: PrismaLimitRepository;
}

const VaRHistoricalSchema = z.object({
  pnlHistory: z.array(z.object({ date: z.string(), pnl: z.number(), currency: z.string() })),
  confidence: z.number().min(0.9).max(0.999).default(0.99),
  currency: z.string().length(3).default('USD'),
});

const VaRStressedSchema = VaRHistoricalSchema;

const FRTBSensSchema = z.object({
  positionId: z.string(),
  riskClass: z.nativeEnum(FRTBRiskClass),
  bucket: z.string(),
  riskFactor: z.string(),
  sensitivity: z.number(),
  currency: z.string().length(3),
});

const FRTBCapitalSchema = z.object({
  sensitivities: z.array(FRTBSensSchema),
  currency: z.string().length(3).default('USD'),
});

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

  /** POST /api/v1/risk/var/historical — Historical Simulation VaR (Basel III 250-day, 99%) */
  app.post('/var/historical', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = VaRHistoricalSchema.parse(request.body);
    const varCalc = new VaRCalculator();
    const history = body.pnlHistory.map((o) => ({
      date: new Date(o.date),
      pnl: o.pnl,
      currency: o.currency,
    }));
    const result = await varCalc.historicalVaR(history, body.confidence, body.currency);
    return reply.send(result);
  });

  /** POST /api/v1/risk/var/stressed — Stressed VaR (2007-2009 period) */
  app.post('/var/stressed', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = VaRStressedSchema.parse(request.body);
    const varCalc = new VaRCalculator();
    const history = body.pnlHistory.map((o) => ({
      date: new Date(o.date),
      pnl: o.pnl,
      currency: o.currency,
    }));
    const result = await varCalc.stressedVaR(history, body.confidence, body.currency);
    return reply.send(result);
  });

  /** POST /api/v1/risk/frtb/sa — FRTB Standardised Approach capital */
  app.post('/frtb/sa', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = FRTBCapitalSchema.parse(request.body);
    const frtb = new FRTBSAEngine();
    const result = frtb.computeCapital(body.sensitivities, [], body.currency);
    return reply.send(result);
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
