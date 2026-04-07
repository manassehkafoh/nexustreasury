import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { healthRoutes } from './routes/health.routes.js';
import { PositionKafkaConsumer } from './infrastructure/kafka/consumer.js';
import { PrismaPositionRepository } from './infrastructure/postgres/position.repository.js';
import {
  Position, PositionId, InstrumentId, BookId, TenantId, BusinessDate,
  TradeBookedEvent, TradeCancelledEvent,
} from '@nexustreasury/domain';

const PORT = Number(process.env['PORT'] ?? 4002);
const log = (level: string, msg: string, data?: object): void => {
  process.stdout.write(JSON.stringify({
    level, service: 'position-service', msg, time: new Date().toISOString(), ...data,
  }) + '\n')
};

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  await prisma.$connect();
  const repo = new PrismaPositionRepository(prisma);

  const consumer = new PositionKafkaConsumer(
    async (event: TradeBookedEvent) => {
      const trade = event.trade;
      const posId  = PositionId(`${trade.tenantId}:${trade.bookId}:${trade.instrumentId}`);

      let position = await repo.findById(posId, trade.tenantId as TenantId);

      if (!position) {
        position = Position.create({
          id:           posId,
          tenantId:     trade.tenantId as TenantId,
          instrumentId: trade.instrumentId as InstrumentId,
          bookId:       trade.bookId as BookId,
          currency:     trade.notional.currency,
          openDate:     BusinessDate.today(),
        });
        position.applyTradeBooked(event);
        await repo.save(position);
      } else {
        position.applyTradeBooked(event);
        await repo.update(position);
      }

      position.pullDomainEvents(); // clear — Kafka publish handled by trade-service
      log('info', 'Position updated', { positionId: posId, tradeId: trade.id });
    },
    async (event: TradeCancelledEvent) => {
      const trade = event.trade;
      const posId  = PositionId(`${trade.tenantId}:${trade.bookId}:${trade.instrumentId}`);
      const position = await repo.findById(posId, trade.tenantId as TenantId);
      if (!position) { log('warn', 'Position not found for cancelled trade', { tradeId: trade.id }); return; }
      position.applyCancelledTrade(event);
      await repo.update(position);
      position.pullDomainEvents();
      log('info', 'Position reversed for cancelled trade', { positionId: posId });
    },
  );

  await consumer.start();
  log('info', 'Kafka consumer started');

  const app = Fastify({ trustProxy: true, logger: false });
  await app.register(healthRoutes, { prefix: '/health' });

  const shutdown = async (): Promise<void> => {
    log('info', 'Shutting down position-service');
    await consumer.stop();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);

  await app.listen({ port: PORT, host: '0.0.0.0' });
  log('info', `Position service ready on port ${PORT}`);
}

main().catch((err: unknown) => {
  process.stderr.write(JSON.stringify({ level: 'fatal', service: 'position-service', err: String(err) }) + '\n');
  process.exit(1);
});
