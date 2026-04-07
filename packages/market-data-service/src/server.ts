import Fastify from 'fastify';
import { healthRoutes } from './routes/health.routes.js';

const PORT = Number(process.env['PORT'] ?? 4006);
const HOST = process.env['HOST'] ?? '0.0.0.0';

const log = (msg: string): void => {
  process.stdout.write(JSON.stringify({
    level: 'info', service: 'market-data-service',
    msg, time: new Date().toISOString(),
    port: PORT, env: process.env['NODE_ENV'] ?? 'development',
  }) + '\n');
};

async function main(): Promise<void> {
  const app = Fastify({ trustProxy: true, logger: false });

  await app.register(healthRoutes, { prefix: '/health' });

  const shutdown = async (): Promise<void> => {
    log('Shutting down...');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);

  await app.listen({ port: PORT, host: HOST });
  log('Service started');
}

main().catch((err: unknown) => {
  process.stderr.write(JSON.stringify({ level: 'fatal', service: 'market-data-service', err: String(err) }) + '\n');
  process.exit(1);
});
