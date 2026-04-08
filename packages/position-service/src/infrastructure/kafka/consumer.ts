/**
 * @module PositionKafkaConsumer
 *
 * Kafka consumer for the position-service bounded context.
 *
 * ## What it does
 * Subscribes to the `nexus.trading.trades` topic and routes incoming
 * domain events to the position-keeping handlers:
 * - `TradeBookedEvent`    → updates (or creates) the Position aggregate
 * - `TradeCancelledEvent` → reverses the position effect
 *
 * ## Consumer Group
 * `position-service-group` — Kafka guarantees exactly-once delivery
 * within this group across all replicas of position-service.
 *
 * ## Dependency Injection
 * The two handler callbacks (`onTradeBooked`, `onTradeCancelled`) are
 * injected at construction time. This keeps the consumer infrastructure
 * separate from the domain logic and makes the consumer unit-testable
 * by injecting mock handlers.
 *
 * @example
 * ```typescript
 * const consumer = new PositionKafkaConsumer(
 *   async (event) => {
 *     // load position, applyTradeBooked(), save
 *   },
 *   async (event) => {
 *     // load position, applyCancelledTrade(), save
 *   },
 * );
 * await consumer.start();  // starts consuming — call in server.ts startup
 * await consumer.stop();   // graceful shutdown — call in SIGTERM handler
 * ```
 */
import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import type { TradeBookedEvent, TradeCancelledEvent } from '@nexustreasury/domain';

/** Union of the two trade event types this consumer handles. */
type TradeEventPayload = TradeBookedEvent | TradeCancelledEvent;

/**
 * Infrastructure adapter that bridges Kafka messages into domain event handlers.
 *
 * Each call to `start()` opens a long-lived consumer connection.
 * Call `stop()` in the process SIGTERM handler for a clean shutdown.
 */
export class PositionKafkaConsumer {
  private readonly kafka: Kafka;
  private readonly consumer: Consumer;

  /**
   * @param onTradeBooked    - Handler called when a trade is successfully booked.
   *                           Should load or create the Position aggregate and save it.
   * @param onTradeCancelled - Handler called when a trade is cancelled.
   *                           Should reverse the position effect and save.
   */
  constructor(
    private readonly onTradeBooked: (event: TradeBookedEvent) => Promise<void>,
    private readonly onTradeCancelled: (event: TradeCancelledEvent) => Promise<void>,
  ) {
    this.kafka = new Kafka({
      clientId: 'position-service',
      brokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:9092').split(','),
    });
    this.consumer = this.kafka.consumer({ groupId: 'position-service-group' });
  }

  /**
   * Connect to Kafka and begin consuming `nexus.trading.trades`.
   * This method does not return — it runs until `stop()` is called.
   */
  async start(): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({
      topics: ['nexus.trading.trades'],
      fromBeginning: false, // only process events from this point forward
    });

    await this.consumer.run({
      eachMessage: async ({ message }: EachMessagePayload) => {
        if (!message.value) return;

        const event = JSON.parse(message.value.toString()) as TradeEventPayload;

        if (event.eventType === 'nexus.trading.trade.booked') {
          await this.onTradeBooked(event as TradeBookedEvent);
        } else if (event.eventType === 'nexus.trading.trade.cancelled') {
          await this.onTradeCancelled(event as TradeCancelledEvent);
        }
        // Other event types (amended, settled) are ignored by position-service
      },
    });
  }

  /** Gracefully disconnect from Kafka. Call in SIGTERM/SIGINT handlers. */
  async stop(): Promise<void> {
    await this.consumer.disconnect();
  }
}
