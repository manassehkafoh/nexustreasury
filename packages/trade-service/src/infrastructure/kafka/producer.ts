import { Kafka, Producer, Partitioners } from 'kafkajs';
import type { DomainEvent } from '@nexustreasury/domain';
import { logger } from '../logger.js';

const KAFKA_TOPICS = {
  TRADES:    'nexus.trading.trades',
  POSITIONS: 'nexus.position.positions',
  RISK:      'nexus.risk.events',
  ALM:       'nexus.alm.events',
} as const;

export class KafkaProducer {
  private readonly kafka: Kafka;
  private readonly producer: Producer;

  constructor() {
    this.kafka = new Kafka({
      clientId: 'trade-service',
      brokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:9092').split(','),
      ssl: process.env['NODE_ENV'] === 'production',
      retry: {
        initialRetryTime: 100,
        retries: 8,
      },
    });

    this.producer = this.kafka.producer({
      createPartitioner: Partitioners.LegacyPartitioner,
      idempotent: true,       // exactly-once semantics
      transactionalId: 'trade-service-producer',
    });
  }

  async connect(): Promise<void> {
    await this.producer.connect();
    logger.info('Kafka producer connected');
  }

  async publishDomainEvents(events: DomainEvent[]): Promise<void> {
    if (events.length === 0) return;

    await this.producer.sendBatch({
      topicMessages: [
        {
          topic: KAFKA_TOPICS.TRADES,
          messages: events.map((event) => ({
            key: event.aggregateId,
            value: JSON.stringify(event),
            headers: {
              eventType:     event.eventType,
              eventId:       event.eventId,
              schemaVersion: String(event.schemaVersion),
              tenantId:      event.tenantId,
              occurredAt:    event.occurredAt.toISOString(),
            },
          })),
        },
      ],
    });

    logger.info({ count: events.length }, 'Domain events published to Kafka');
  }

  async disconnect(): Promise<void> {
    await this.producer.disconnect();
    logger.info('Kafka producer disconnected');
  }
}
