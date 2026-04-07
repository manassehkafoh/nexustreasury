import Fastify from 'fastify';
import { healthRoutes } from './routes/health.routes.js';

const PORT = Number(process.env['PORT'] ?? 4005);

async function main(): Promise<void> {
  const app = Fastify({ trustProxy: true });
  await app.register(healthRoutes, { prefix: '/health' });
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log('Service bo-service started on port ' + PORT);
}
main().catch((err) => { console.error(err); process.exit(1); });
