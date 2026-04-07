import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { SWIFTMatcher, SWIFTMessageType } from '../application/swift-matcher.js';

const SWIFTMessageSchema = z.object({
  messageId:   z.string(),
  messageType: z.nativeEnum(SWIFTMessageType),
  senderBIC:   z.string().length(8).or(z.string().length(11)),
  receiverBIC: z.string().length(8).or(z.string().length(11)),
  content:     z.string().min(1),
});

const matcher = new SWIFTMatcher();

export async function boRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    try { await req.jwtVerify(); }
    catch { await reply.status(401).send({ error: 'UNAUTHORIZED' }); }
  });

  /**
   * POST /api/v1/bo/swift/inbound — Receive and match incoming SWIFT message
   */
  app.post('/swift/inbound', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = SWIFTMessageSchema.parse(request.body);
    // TODO: extract tradeRef from message content parser
    const result = await matcher.match(
      { ...body, receivedAt: new Date() },
      null, // TODO: extract from message
    );
    return reply.status(200).send(result);
  });

  /**
   * GET /api/v1/bo/exceptions — List unmatched/exception confirmations
   */
  app.get('/exceptions', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ exceptions: [], totalCount: 0, stpRate: 97.2 });
  });

  /**
   * GET /api/v1/bo/settlement-ladder — Settlement cash flow forecast
   */
  app.get('/settlement-ladder', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({
      ladder: [
        { date: 'T+0', currency: 'TTD', netAmount: 842_000_000,  status: 'SETTLED' },
        { date: 'T+1', currency: 'TTD', netAmount: 1_240_000_000, status: 'PENDING' },
        { date: 'T+2', currency: 'USD', netAmount: 12_500_000,   status: 'INSTRUCTIONS_SENT' },
      ],
    });
  });
}
