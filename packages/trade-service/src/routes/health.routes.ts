import type { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { Kafka } from 'kafkajs';
import { createClient } from 'redis';
import { logger } from '../infrastructure/logger.js';

interface HealthStatus {
  status: 'ok' | 'degraded' | 'down';
  latencyMs: number;
  error?: string;
}

interface ReadinessResponse {
  status: 'ready' | 'not-ready';
  checks: {
    db:    HealthStatus;
    kafka: HealthStatus;
    redis: HealthStatus;
  };
  timestamp: string;
}

async function checkPostgres(): Promise<HealthStatus> {
  const start = Date.now();
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'], max: 1, connectionTimeoutMillis: 3000 });
  try {
    await pool.query('SELECT 1');
    await pool.end();
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (err) {
    await pool.end().catch(() => undefined);
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
  const client = createClient({
    url: `redis://${process.env['REDIS_HOST'] ?? 'localhost'}:${process.env['REDIS_PORT'] ?? '6379'}`,
    socket: { connectTimeout: 3000 },
  });
  try {
    await client.connect();
    await client.ping();
    await client.disconnect();
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (err) {
    await client.disconnect().catch(() => undefined);
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

  /** Readiness — can the pod accept traffic? Real dependency checks. */
  app.get('/ready', async (_req, reply) => {
    const [db, kafka, redis] = await Promise.all([
      checkPostgres(),
      checkKafka(),
      checkRedis(),
    ]);

    const allReady = db.status === 'ok' && kafka.status === 'ok' && redis.status === 'ok';

    const response: ReadinessResponse = {
      status: allReady ? 'ready' : 'not-ready',
      checks: { db, kafka, redis },
      timestamp: new Date().toISOString(),
    };

    return reply.status(allReady ? 200 : 503).send(response);
  });

  /** Startup — for Kubernetes startupProbe */
  app.get('/startup', async () => ({
    status: 'started',
    version: process.env['npm_package_version'] ?? '1.0.0',
  }));
}
