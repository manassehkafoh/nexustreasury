import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { healthRoutes } from './routes/health.routes.js';
import { almRoutes } from './routes/alm.routes.js';

const PORT = Number(process.env['PORT'] ?? 4004);
const log = (msg: string): void => process.stdout.write(JSON.stringify({
  level: 'info', service: 'alm-service', msg, time: new Date().toISOString(),
}) + '\n');

async function main(): Promise<void> {
  const jwtSecret = process.env['JWT_SECRET'];
  if (!jwtSecret) throw new Error('JWT_SECRET is required');

  const app = Fastify({ trustProxy: true, logger: false });
  await app.register(jwt, { secret: jwtSecret });
  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(almRoutes,    { prefix: '/api/v1/alm' });

  const shutdown = async (): Promise<void> => {
    log('Shutting down alm-service');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);

  await app.listen({ port: PORT, host: '0.0.0.0' });
  log(`ALM Service ready on port ${PORT}`);
}
main().catch((err: unknown) => {
  process.stderr.write(JSON.stringify({ level: 'fatal', service: 'alm-service', err: String(err) }) + '\n');
  process.exit(1);
});
