import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { Kafka } from 'kafkajs';
import Redis from 'ioredis';
import { logger } from '../infrastructure/logger.js';

interface HealthStatus {
  status: 'ok' | 'degraded' | 'down';
  latencyMs: number;
  error?: string;
}

interface ReadinessResponse {
  status: 'ready' | 'not-ready';
  checks: { db: HealthStatus; kafka: HealthStatus; redis: HealthStatus };
  timestamp: string;
}

async function checkPostgres(): Promise<HealthStatus> {
  const start = Date.now();
  const prisma = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL'] } } });
  try {
    await prisma.$queryRaw`SELECT 1`;
    await prisma.$disconnect();
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (err) {
    await prisma.$disconnect().catch(() => undefined);
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, 'Health check: PostgreSQL unreachable');
    return { status: 'down', latencyMs: Date.now() - start, error: msg };
  }
}

async function checkKafka(): Promise<HealthStatus> {
  const start = Date.now();
  const kafka = new Kafka({
    clientId: 'trade-service-health',
    brokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:9092').split(','),
    retry: { retries: 1 },
  });
  const admin = kafka.admin();
  try {
    await admin.connect();
    await admin.describeCluster();
    await admin.disconnect();
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (err) {
    await admin.disconnect().catch(() => undefined);
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, 'Health check: Kafka unreachable');
    return { status: 'down', latencyMs: Date.now() - start, error: msg };
  }
}

async function checkRedis(): Promise<HealthStatus> {
  const start = Date.now();
  const client = new Redis({
    host: process.env['REDIS_HOST'] ?? 'localhost',
    port: Number(process.env['REDIS_PORT'] ?? 6379),
    connectTimeout: 3000,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  try {
    await client.connect();
    await client.ping();
    await client.quit();
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (err) {
    await client.quit().catch(() => undefined);
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, 'Health check: Redis unreachable');
    return { status: 'down', latencyMs: Date.now() - start, error: msg };
  }
}

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  /** Liveness — is the process alive? */
  app.get('/live', async () => ({
    status: 'ok',
    service: 'trade-service',
    version: process.env['npm_package_version'] ?? '1.0.0',
    timestamp: new Date().toISOString(),
  }));

  /** Readiness — real dependency checks. Kubernetes stops routing on 503. */
  app.get('/ready', async (_req, reply) => {
    const [db, kafka, redis] = await Promise.all([checkPostgres(), checkKafka(), checkRedis()]);

    const allReady = db.status === 'ok' && kafka.status === 'ok' && redis.status === 'ok';
    const response: ReadinessResponse = {
      status: allReady ? 'ready' : 'not-ready',
      checks: { db, kafka, redis },
      timestamp: new Date().toISOString(),
    };
    return reply.status(allReady ? 200 : 503).send(response);
  });

  /** Startup probe */
  app.get('/startup', async () => ({
    status: 'started',
    version: process.env['npm_package_version'] ?? '1.0.0',
  }));
}
