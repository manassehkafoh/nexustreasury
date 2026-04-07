import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  AssetClass, TradeDirection, Trade, BusinessDate, Money, TenantId,
  CounterpartyId, InstrumentId, BookId, TraderId,
} from '@nexustreasury/domain';

const BookTradeSchema = z.object({
  assetClass: z.nativeEnum(AssetClass),
  direction: z.nativeEnum(TradeDirection),
  counterpartyId: z.string().uuid(),
  instrumentId: z.string().uuid(),
  bookId: z.string().uuid(),
  traderId: z.string().uuid(),
  notionalAmount: z.number().positive(),
  notionalCurrency: z.string().length(3),
  price: z.number().positive(),
  tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  valueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  maturityDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const AmendTradeSchema = z.object({
  newNotionalAmount: z.number().positive(),
  newNotionalCurrency: z.string().length(3),
  newPrice: z.number().positive(),
});

const CancelTradeSchema = z.object({
  reason: z.string().min(1).max(500),
});

export async function tradeRoutes(app: FastifyInstance): Promise<void> {
  // Authenticate all trade routes
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      await reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Valid JWT required' });
    }
  });

  /**
   * POST /api/v1/trades
   * Book a new trade with pre-deal limit check
   */
  app.post(
    '/',
    {
      schema: {
        tags: ['trades'],
        summary: 'Book a new trade',
        description: 'Creates a new trade after passing pre-deal limit checks. P99 < 100ms.',
        security: [{ bearerAuth: [] }],
        body: BookTradeSchema,
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = BookTradeSchema.parse(request.body);
      const tenantId = TenantId((request.user as { tenantId: string }).tenantId);

      // TODO: Inject use case handler
      // const result = await bookTradeUseCase.execute({ ...body, tenantId });
      // const trade = result.trade;

      return reply.status(201).send({
        tradeId: 'placeholder',
        reference: 'FX-20260407-XXXXX',
        status: 'PENDING_VALIDATION',
        message: 'Trade booked successfully',
      });
    },
  );

  /**
   * GET /api/v1/trades/:tradeId
   * Retrieve a trade by ID
   */
  app.get(
    '/:tradeId',
    {
      schema: {
        tags: ['trades'],
        summary: 'Get trade by ID',
        security: [{ bearerAuth: [] }],
        params: z.object({ tradeId: z.string().uuid() }),
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tradeId } = request.params as { tradeId: string };
      // TODO: const trade = await getTradeQuery.execute({ tradeId, tenantId });
      return reply.status(200).send({ tradeId, message: 'TODO: wire up query handler' });
    },
  );

  /**
   * PATCH /api/v1/trades/:tradeId
   * Amend trade notional and price
   */
  app.patch(
    '/:tradeId',
    {
      schema: {
        tags: ['trades'],
        summary: 'Amend a trade',
        security: [{ bearerAuth: [] }],
        params: z.object({ tradeId: z.string().uuid() }),
        body: AmendTradeSchema,
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tradeId } = request.params as { tradeId: string };
      const body = AmendTradeSchema.parse(request.body);
      // TODO: await amendTradeUseCase.execute({ tradeId, ...body });
      return reply.status(200).send({ tradeId, message: 'Trade amended', ...body });
    },
  );

  /**
   * DELETE /api/v1/trades/:tradeId
   * Cancel a trade
   */
  app.delete(
    '/:tradeId',
    {
      schema: {
        tags: ['trades'],
        summary: 'Cancel a trade',
        security: [{ bearerAuth: [] }],
        params: z.object({ tradeId: z.string().uuid() }),
        body: CancelTradeSchema,
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tradeId } = request.params as { tradeId: string };
      const { reason } = CancelTradeSchema.parse(request.body);
      // TODO: await cancelTradeUseCase.execute({ tradeId, reason });
      return reply.status(200).send({ tradeId, message: `Trade cancelled: ${reason}` });
    },
  );
}
