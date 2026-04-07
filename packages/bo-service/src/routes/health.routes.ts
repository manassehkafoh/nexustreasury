import type { FastifyInstance } from 'fastify';
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/live',  async () => ({ status: 'ok', service: 'bo-service', timestamp: new Date().toISOString() }));
  app.get('/ready', async () => ({ status: 'ready' }));
}
