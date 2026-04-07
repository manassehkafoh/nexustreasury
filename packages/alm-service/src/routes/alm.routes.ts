import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  ALMScenario, LiquidityTimeBucket, BusinessDate, TenantId,
} from '@nexustreasury/domain';
import { LCRCalculator } from '../application/lcr-calculator.js';

const GenerateReportSchema = z.object({
  scenario:  z.nativeEnum(ALMScenario),
  currency:  z.string().length(3),
  asOfDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  cashFlows: z.array(z.object({
    bucket:        z.nativeEnum(LiquidityTimeBucket),
    inflowAmount:  z.number(),
    outflowAmount: z.number(),
  })),
  lcr: z.object({
    hqlaLevel1:         z.number(),
    hqlaLevel2A:        z.number(),
    hqlaLevel2B:        z.number(),
    netCashOutflows30d: z.number(),
  }),
  nsfr: z.object({
    availableStableFunding: z.number(),
    requiredStableFunding:  z.number(),
  }),
});

const calculator = new LCRCalculator();

export async function almRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    try { await req.jwtVerify(); }
    catch { await reply.status(401).send({ error: 'UNAUTHORIZED' }); }
  });

  /**
   * POST /api/v1/alm/liquidity-gap — Generate liquidity gap report
   */
  app.post('/liquidity-gap', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = GenerateReportSchema.parse(request.body);
    const user = request.user as { tenantId: string };

    const report = calculator.generate({
      tenantId: TenantId(user.tenantId),
      asOfDate: body.asOfDate
        ? BusinessDate.fromDate(new Date(body.asOfDate))
        : BusinessDate.today(),
      scenario:  body.scenario,
      currency:  body.currency,
      cashFlows: body.cashFlows,
      lcr:       body.lcr,
      nsfr:      body.nsfr,
    });

    return reply.status(200).send({
      reportId:  report.id,
      asOfDate:  report.asOfDate.toString(),
      scenario:  report.scenario,
      lcr: {
        ratio:      Number(report.lcr.lcrRatio.toFixed(4)),
        isCompliant: report.lcr.isCompliant,
        totalHQLA:  report.lcr.totalHQLA.toNumber(),
        netOutflows: report.lcr.netCashOutflows30d.toNumber(),
      },
      nsfr: {
        ratio:      Number(report.nsfr.nsfrRatio.toFixed(4)),
        isCompliant: report.nsfr.isCompliant,
      },
      buckets: report.buckets.map((b) => ({
        bucket:         b.bucket,
        inflows:        b.inflows.toNumber(),
        outflows:       b.outflows.toNumber(),
        gap:            b.gap.toNumber(),
        cumulativeGap:  b.cumulativeGap.toNumber(),
      })),
      generatedAt: report.generatedAt.toISOString(),
    });
  });

  /**
   * GET /api/v1/alm/lcr — Latest LCR snapshot
   */
  app.get('/lcr', async (_req: FastifyRequest, reply: FastifyReply) => {
    // TODO: load from ALM repository
    return reply.status(200).send({ lcrRatio: 142.3, isCompliant: true, asOf: new Date().toISOString() });
  });

  /**
   * GET /api/v1/alm/nsfr — Latest NSFR snapshot
   */
  app.get('/nsfr', async (_req: FastifyRequest, reply: FastifyReply) => {
    // TODO: load from ALM repository
    return reply.status(200).send({ nsfrRatio: 118.7, isCompliant: true, asOf: new Date().toISOString() });
  });
}
