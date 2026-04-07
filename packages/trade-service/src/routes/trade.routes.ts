import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  AssetClass, TradeDirection, TenantId,
  CounterpartyId, InstrumentId, BookId, TraderId,
} from '@nexustreasury/domain';
import { BookTradeCommand } from '../application/commands/book-trade.command.js';
import { PassThroughPreDealCheck } from '../application/services/pre-deal-check.service.js';
import { KafkaProducer } from '../infrastructure/kafka/producer.js';

// Zod schemas
const BookTradeSchema = z.object({
  assetClass:       z.nativeEnum(AssetClass),
  direction:        z.nativeEnum(TradeDirection),
  counterpartyId:   z.string().uuid(),
  instrumentId:     z.string().uuid(),
  bookId:           z.string().uuid(),
  traderId:         z.string().uuid(),
  notionalAmount:   z.number().positive(),
  notionalCurrency: z.string().length(3),
  price:            z.number().positive(),
  tradeDate:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  valueDate:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  maturityDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const AmendTradeSchema = z.object({
  newNotionalAmount:   z.number().positive(),
  newNotionalCurrency: z.string().length(3),
  newPrice:            z.number().positive(),
});

const CancelTradeSchema = z.object({ reason: z.string().min(1).max(500) });

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
   * POST /api/v1/trades  — Book a new trade
   */
  app.post(
    '/',
    {
      schema: {
        tags: ['trades'],
        summary: 'Book a new trade',
        description: 'Creates a new trade after passing pre-deal limit checks. P99 < 100ms.',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = BookTradeSchema.parse(request.body);
      const user = request.user as { tenantId: string };
      const tenantId = TenantId(user.tenantId);

      const kafkaProducer = new KafkaProducer();
      await kafkaProducer.connect();

      const command = new BookTradeCommand(
        app.tradeRepository,
        new PassThroughPreDealCheck(),
        kafkaProducer,
      );

      const result = await command.execute({
        tenantId,
        assetClass:       body.assetClass,
        direction:        body.direction,
        counterpartyId:   CounterpartyId(body.counterpartyId),
        instrumentId:     InstrumentId(body.instrumentId),
        bookId:           BookId(body.bookId),
        traderId:         TraderId(body.traderId),
        notionalAmount:   body.notionalAmount,
        notionalCurrency: body.notionalCurrency,
        price:            body.price,
        tradeDate:        body.tradeDate,
        valueDate:        body.valueDate,
        maturityDate:     body.maturityDate,
      });

      await kafkaProducer.disconnect();
      return reply.status(201).send(result);
    },
  );

  /**
   * GET /api/v1/trades/:tradeId — Get trade by ID
   */
  app.get(
    '/:tradeId',
    {
      schema: {
        tags: ['trades'],
        summary: 'Get trade by ID',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tradeId } = request.params as { tradeId: string };
      const user = request.user as { tenantId: string };
      const trade = await app.tradeRepository.findById(
        tradeId as ReturnType<typeof import('@nexustreasury/domain').TradeId>,
        TenantId(user.tenantId),
      );
      if (!trade) return reply.status(404).send({ error: 'NOT_FOUND', message: `Trade ${tradeId} not found` });
      return reply.status(200).send({ tradeId: trade.id, reference: trade.reference, status: trade.status });
    },
  );

  /**
   * PATCH /api/v1/trades/:tradeId — Amend trade
   */
  app.patch(
    '/:tradeId',
    { schema: { tags: ['trades'], summary: 'Amend a trade', security: [{ bearerAuth: [] }] } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tradeId } = request.params as { tradeId: string };
      const body = AmendTradeSchema.parse(request.body);
      const user = request.user as { tenantId: string };
      const { Money } = await import('@nexustreasury/domain');

      const trade = await app.tradeRepository.findById(
        tradeId as ReturnType<typeof import('@nexustreasury/domain').TradeId>,
        TenantId(user.tenantId),
      );
      if (!trade) return reply.status(404).send({ error: 'NOT_FOUND', message: `Trade ${tradeId} not found` });

      trade.amend(Money.of(body.newNotionalAmount, body.newNotionalCurrency), body.newPrice);
      await app.tradeRepository.update(trade);

      const events = trade.pullDomainEvents();
      const kafkaProducer = new KafkaProducer();
      await kafkaProducer.connect();
      await kafkaProducer.publishDomainEvents(events);
      await kafkaProducer.disconnect();

      return reply.status(200).send({ tradeId, status: trade.status, message: 'Trade amended' });
    },
  );

  /**
   * DELETE /api/v1/trades/:tradeId — Cancel trade
   */
  app.delete(
    '/:tradeId',
    { schema: { tags: ['trades'], summary: 'Cancel a trade', security: [{ bearerAuth: [] }] } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tradeId } = request.params as { tradeId: string };
      const { reason } = CancelTradeSchema.parse(request.body);
      const user = request.user as { tenantId: string };

      const trade = await app.tradeRepository.findById(
        tradeId as ReturnType<typeof import('@nexustreasury/domain').TradeId>,
        TenantId(user.tenantId),
      );
      if (!trade) return reply.status(404).send({ error: 'NOT_FOUND', message: `Trade ${tradeId} not found` });

      trade.cancel(reason);
      await app.tradeRepository.update(trade);

      const events = trade.pullDomainEvents();
      const kafkaProducer = new KafkaProducer();
      await kafkaProducer.connect();
      await kafkaProducer.publishDomainEvents(events);
      await kafkaProducer.disconnect();

      return reply.status(200).send({ tradeId, status: trade.status, message: `Trade cancelled: ${reason}` });
    },
  );
}
