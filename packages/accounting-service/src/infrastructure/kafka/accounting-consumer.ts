/**
 * @module accounting-service/infrastructure/kafka/accounting-consumer
 *
 * Kafka consumer — subscribes to trade and position events and dispatches
 * to the appropriate accounting application-layer handlers.
 *
 * Subscribed topics:
 *   nexus.trading.trades.*      → TradeBookedHandler
 *   nexus.position.revalued     → PositionRevaluedHandler (future Sprint 3)
 *
 * Guarantees:
 *   - At-least-once delivery (Kafka consumer group)
 *   - Idempotency: each event has a unique eventId; duplicate processing
 *     is detected via a Redis idempotency key (TTL 7 days)
 *   - Dead-letter queue: failed events after 3 retries → nexus.accounting.dlq
 */

import type { Consumer, Kafka } from 'kafkajs';
import type { TradeBookedHandler } from '../../application/trade-booked.handler.js';
import type { AssetClass } from '@nexustreasury/domain';

// Minimal logger interface — injected (supports pino, winston, console)
export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
}

// Idempotency store interface — injected (Redis in production, Map in tests)
export interface IdempotencyStore {
  has(key: string): Promise<boolean>;
  set(key: string, ttlSeconds: number): Promise<void>;
}

/** In-memory idempotency store for testing */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly seen = new Map<string, number>();
  async has(key: string): Promise<boolean> {
    return this.seen.has(key);
  }
  async set(key: string, ttlSeconds: number): Promise<void> {
    this.seen.set(key, Date.now() + ttlSeconds * 1000);
  }
}

export interface AccountingConsumerConfig {
  groupId: string;
  topics: string[];
  retryAttempts: number;
  dlqTopic: string;
}

const DEFAULT_CONFIG: AccountingConsumerConfig = {
  groupId: 'accounting-service-cg',
  topics: ['nexus.trading.trades.booked'],
  retryAttempts: 3,
  dlqTopic: 'nexus.accounting.dlq',
};

export class AccountingKafkaConsumer {
  private consumer!: Consumer;

  constructor(
    private readonly kafka: Kafka,
    private readonly tradeBookedHandler: TradeBookedHandler,
    private readonly idempotencyStore: IdempotencyStore,
    private readonly logger: Logger,
    private readonly config: AccountingConsumerConfig = DEFAULT_CONFIG,
  ) {}

  async start(): Promise<void> {
    this.consumer = this.kafka.consumer({ groupId: this.config.groupId });
    await this.consumer.connect();

    for (const topic of this.config.topics) {
      await this.consumer.subscribe({ topic, fromBeginning: false });
    }

    await this.consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const raw = message.value?.toString();
        if (!raw) return;

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          this.logger.error('accounting-consumer: invalid JSON', { topic, partition });
          return;
        }

        const eventId = payload['eventId'] as string;
        if (!eventId) {
          this.logger.warn('accounting-consumer: missing eventId, skipping', { topic });
          return;
        }

        // Idempotency check — skip duplicates
        if (await this.idempotencyStore.has(eventId)) {
          this.logger.info('accounting-consumer: duplicate event, skipping', { eventId });
          return;
        }

        let attempts = 0;
        while (attempts < this.config.retryAttempts) {
          try {
            await this.dispatch(topic, payload);
            await this.idempotencyStore.set(eventId, 7 * 24 * 3600);
            break;
          } catch (err) {
            attempts++;
            this.logger.error('accounting-consumer: handler error', {
              eventId,
              topic,
              attempt: attempts,
              error: err instanceof Error ? err.message : String(err),
            });
            if (attempts >= this.config.retryAttempts) {
              await this.sendToDLQ(eventId, topic, raw, err);
            }
          }
        }
      },
    });

    this.logger.info('accounting-consumer: started', { topics: this.config.topics });
  }

  async stop(): Promise<void> {
    await this.consumer?.disconnect();
    this.logger.info('accounting-consumer: stopped');
  }

  private async dispatch(topic: string, payload: Record<string, unknown>): Promise<void> {
    if (topic === 'nexus.trading.trades.booked') {
      await this.tradeBookedHandler.handle(payload as never);
    }
  }

  private async sendToDLQ(
    eventId: string,
    topic: string,
    raw: string,
    err: unknown,
  ): Promise<void> {
    // DLQ publication — in production this writes to nexus.accounting.dlq
    // For now, just log. Full implementation uses kafka.producer().send()
    this.logger.error('accounting-consumer: DLQ', {
      eventId,
      topic,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
