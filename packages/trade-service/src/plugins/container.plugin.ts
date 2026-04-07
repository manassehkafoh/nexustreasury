import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { Container } from '../container.js';
import type { PrismaTradeRepository } from '../infrastructure/postgres/trade.repository.js';

declare module 'fastify' {
  interface FastifyInstance {
    tradeRepository: PrismaTradeRepository;
    container: Container;
  }
}

export const containerPlugin = fp(async (app: FastifyInstance) => {
  const container = Container.get();
  await container.connect();
  app.decorate('container',       container);
  app.decorate('tradeRepository', container.tradeRepository);
  app.addHook('onClose', async () => { await container.disconnect(); });
});
