import Fastify from 'fastify';
import { Kafka, Producer } from 'kafkajs';
import { healthRoutes } from './routes/health.routes.js';
import { MockRateAdapter } from './application/rate-publisher.js';
import type { MarketRate } from './application/rate-publisher.js';

const PORT = Number(process.env['PORT'] ?? 4006);
const log = (msg: string, data?: object): void =>
  process.stdout.write(JSON.stringify({
    level: 'info', service: 'market-data-service', msg,
    time: new Date().toISOString(), ...data,
  }) + '\n');

const INSTRUMENTS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDGHS', 'USDNGN', 'EURGBP', 'XAUUSD'];
const RATE_TOPIC  = 'nexus.marketdata.rates';

async function main(): Promise<void> {
  // Kafka producer for rate publishing
  const kafka: Kafka = new Kafka({
    clientId: 'market-data-service',
    brokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:9092').split(','),
  });
  const producer: Producer = kafka.producer({ idempotent: true });
  await producer.connect();
  log('Kafka producer connected');

  // Rate adapter — MockRateAdapter in dev, swap for BloombergBLPAPIAdapter in prod
  const adapter = new MockRateAdapter();
  adapter.onRate(async (rate: MarketRate) => {
    await producer.send({
      topic: RATE_TOPIC,
      messages: [{
        key:   rate.instrument,
        value: JSON.stringify(rate),
        headers: { source: rate.source, instrument: rate.instrument },
      }],
    });
    log('Rate published', { instrument: rate.instrument, mid: rate.mid });
  });
  adapter.subscribe(INSTRUMENTS);
  log('Rate adapter started', { instruments: INSTRUMENTS, topic: RATE_TOPIC });

  const app = Fastify({ trustProxy: true, logger: false });
  await app.register(healthRoutes, { prefix: '/health' });

  // Metrics endpoint for Prometheus
  app.get('/metrics/rates', async (_req, reply) => {
    return reply.send({
      instrumentsSubscribed: INSTRUMENTS.length,
      instruments: INSTRUMENTS,
      topic: RATE_TOPIC,
      source: process.env['RATE_SOURCE'] ?? 'MOCK',
    });
  });

  const shutdown = async (): Promise<void> => {
    log('Shutting down market-data-service');
    await adapter.disconnect();
    await producer.disconnect();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);

  await app.listen({ port: PORT, host: '0.0.0.0' });
  log(`Market data service ready on port ${PORT}`);
}

main().catch((err: unknown) => {
  process.stderr.write(JSON.stringify({ level: 'fatal', service: 'market-data-service', err: String(err) }) + '\n');
  process.exit(1);
});
