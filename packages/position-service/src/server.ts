import Fastify from 'fastify';
import { healthRoutes } from './routes/health.routes.js';
import { PositionKafkaConsumer } from './infrastructure/kafka/consumer.js';

const PORT = Number(process.env['PORT'] ?? 4002);
const log = (msg: string): void => process.stdout.write(JSON.stringify({
  level: 'info', service: 'position-service', msg, time: new Date().toISOString(),
}) + '\n');

async function main(): Promise<void> {
  const app = Fastify({ trustProxy: true, logger: false });
  await app.register(healthRoutes, { prefix: '/health' });

  // Wire Kafka consumer — subscribes to nexus.trading.trades
  const consumer = new PositionKafkaConsumer(
    async (event) => {
      log(`TradeBooked received: ${event.aggregateId}`);
      // TODO: load Position aggregate from repository, applyTradeBooked, save + publish
    },
    async (event) => {
      log(`TradeCancelled received: ${event.aggregateId}`);
      // TODO: load Position aggregate, applyCancelledTrade, save + publish
    },
  );

  await consumer.start();
  log('Kafka consumer started — subscribed to nexus.trading.trades');

  const shutdown = async (): Promise<void> => {
    log('Shutting down...');
    await consumer.stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);

  await app.listen({ port: PORT, host: '0.0.0.0' });
  log(`Position service started on port ${PORT}`);
}

main().catch((err: unknown) => {
  process.stderr.write(JSON.stringify({ level: 'fatal', service: 'position-service', err: String(err) }) + '\n');
  process.exit(1);
});
