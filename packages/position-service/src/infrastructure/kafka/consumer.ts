import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import type { TradeBookedEvent, TradeCancelledEvent } from '@nexustreasury/domain';

type TradeEventPayload = TradeBookedEvent | TradeCancelledEvent;

export class PositionKafkaConsumer {
  private readonly kafka: Kafka;
  private readonly consumer: Consumer;

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

  async start(): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({
      topics: ['nexus.trading.trades'],
      fromBeginning: false,
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
      },
    });
  }

  async stop(): Promise<void> {
    await this.consumer.disconnect();
  }
}
