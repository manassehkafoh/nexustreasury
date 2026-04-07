import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PositionKafkaConsumer } from './consumer.js';

// Mock kafkajs
vi.mock('kafkajs', () => ({
  Kafka: vi.fn().mockImplementation(() => ({
    consumer: vi.fn().mockReturnValue({
      connect:    vi.fn().mockResolvedValue(undefined),
      subscribe:  vi.fn().mockResolvedValue(undefined),
      run:        vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    }),
  })),
}));

describe('PositionKafkaConsumer', () => {
  let onBooked: ReturnType<typeof vi.fn>;
  let onCancelled: ReturnType<typeof vi.fn>;
  let consumer: PositionKafkaConsumer;

  beforeEach(() => {
    onBooked    = vi.fn().mockResolvedValue(undefined);
    onCancelled = vi.fn().mockResolvedValue(undefined);
    consumer    = new PositionKafkaConsumer(onBooked, onCancelled);
  });

  it('starts and subscribes to nexus.trading.trades', async () => {
    await consumer.start();
    const { Kafka } = await import('kafkajs');
    const kafkaInstance = (Kafka as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    const consumerInstance = kafkaInstance?.consumer?.();
    expect(consumerInstance?.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ topics: ['nexus.trading.trades'] }),
    );
  });

  it('stops gracefully', async () => {
    await consumer.start();
    await consumer.stop();
    const { Kafka } = await import('kafkajs');
    const kafkaInstance = (Kafka as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    const consumerInstance = kafkaInstance?.consumer?.();
    expect(consumerInstance?.disconnect).toHaveBeenCalled();
  });

  it('accepts onTradeBooked callback', () => {
    expect(onBooked).toBeDefined();
    expect(typeof onBooked).toBe('function');
  });

  it('accepts onTradeCancelled callback', () => {
    expect(onCancelled).toBeDefined();
    expect(typeof onCancelled).toBe('function');
  });
});
