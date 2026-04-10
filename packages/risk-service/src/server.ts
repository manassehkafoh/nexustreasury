import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { PrismaClient } from '@prisma/client';
import { healthRoutes } from './routes/health.routes.js';
import { riskRoutes } from './routes/risk.routes.js';
import { PrismaLimitRepository } from './infrastructure/postgres/limit.repository.js';

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});


const PORT = Number(process.env['PORT'] ?? 4003);
const log = (msg: string, data?: object): void => {
  process.stdout.write(
    JSON.stringify({
      level: 'info',
      service: 'risk-service',
      msg,
      time: new Date().toISOString(),
      ...data,
    }) + '\n',
  );
};

async function main(): Promise<void> {
  const jwtSecret = process.env['JWT_SECRET'];
  if (!jwtSecret) throw new Error('JWT_SECRET is required');

  const prisma = new PrismaClient();
  await prisma.$connect();
  const limitRepo = new PrismaLimitRepository(prisma);

  const app = Fastify({ trustProxy: true, logger: false });
  await app.register(jwt, { secret: jwtSecret });
  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(riskRoutes, { prefix: '/api/v1/risk', limitRepo });

  const shutdown = async (): Promise<void> => {
    log('Shutting down risk-service');
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ port: PORT, host: '0.0.0.0' });
  log('Risk service ready', { port: PORT });
}

main().catch((err: unknown) => {
  process.stderr.write(
    JSON.stringify({ level: 'fatal', service: 'risk-service', err: String(err) }) + '\n',
  );
  process.exit(1);
});
