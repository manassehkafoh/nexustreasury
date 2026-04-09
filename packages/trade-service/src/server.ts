import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ZodError } from 'zod';
import { tradeRoutes } from './routes/trade.routes.js';
import { healthRoutes } from './routes/health.routes.js';
import { registerTelemetry } from './infrastructure/telemetry.js';
import { KafkaProducer } from './infrastructure/kafka/producer.js';
import { logger } from './infrastructure/logger.js';

const PORT = Number(process.env['PORT'] ?? 4001);
const HOST = process.env['HOST'] ?? '0.0.0.0';

export async function buildServer(): Promise<ReturnType<typeof Fastify>> {
  // FIX BUG-002: Fail fast — never fall back to a predictable literal secret
  const jwtSecret = process.env['JWT_SECRET'];
  if (!jwtSecret) {
    throw new Error(
      'JWT_SECRET environment variable is required. ' +
        'Set it via Vault agent injection or your .env file.',
    );
  }

  const app = Fastify({
    logger: false,
    trustProxy: true,
    requestIdHeader: 'x-request-id',
  });

  await app.register(helmet, { contentSecurityPolicy: false });

  await app.register(rateLimit, {
    max: 1000,
    timeWindow: '1 minute',
    redis: {
      host: process.env['REDIS_HOST'] ?? 'localhost',
      port: Number(process.env['REDIS_PORT'] ?? 6379),
    },
  });

  await app.register(jwt, {
    secret: jwtSecret,
    sign: { expiresIn: '15m' },
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'NexusTreasury Trade Service',
        description: 'Real-time trade booking, amendment, and position management API',
        version: '1.0.0',
      },
      tags: [
        { name: 'trades', description: 'Trade lifecycle operations' },
        { name: 'health', description: 'Service health endpoints' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list' },
  });

  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(tradeRoutes, { prefix: '/api/v1/trades' });

  app.setErrorHandler((error: Error & { statusCode?: number; code?: string; validation?: unknown }, request, reply) => {
    logger.error({ err: error, reqId: request.id }, 'Unhandled error');
    // Fastify built-in JSON schema validation
    if (error.validation) {
      return reply
        .status(400)
        .send({ error: 'VALIDATION_ERROR', message: error.message, statusCode: 400 });
    }
    // Zod validation errors — parse() throws ZodError, not a Fastify validation error
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
        statusCode: 400,
      });
    }
    const statusCode = error.statusCode ?? 500;
    return reply.status(statusCode).send({
      error: error.code ?? 'INTERNAL_ERROR',
      message: statusCode < 500 ? error.message : 'Internal server error',
      statusCode,
    });
  });

  return app;
}

async function main(): Promise<void> {
  registerTelemetry('trade-service');
  const kafkaProducer = new KafkaProducer();
  await kafkaProducer.connect();
  const app = await buildServer();

  try {
    await app.listen({ port: PORT, host: HOST });
    logger.info({ port: PORT }, '🚀 Trade Service started');
  } catch (err) {
    logger.error(err, 'Failed to start Trade Service');
    process.exit(1);
  }

  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down Trade Service...');
    await app.close();
    await kafkaProducer.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
