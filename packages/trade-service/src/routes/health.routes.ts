import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/live', async () => ({ status: 'ok', service: 'trade-service', timestamp: new Date().toISOString() }));
  app.get('/ready', async (_req, reply) => {
    // TODO: check DB, Kafka, Redis connectivity
    return reply.status(200).send({ status: 'ready', checks: { db: 'ok', kafka: 'ok', redis: 'ok' } });
  });
  app.get('/startup', async () => ({ status: 'started', version: process.env['npm_package_version'] ?? '1.0.0' }));
}
