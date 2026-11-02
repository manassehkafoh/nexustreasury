import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PositionKafkaConsumer } from './consumer.js';

// Mock kafkajs
const connectMock = vi.fn().mockResolvedValue(undefined);
const subscribeMock = vi.fn().mockResolvedValue(undefined);
const runMock = vi.fn().mockResolvedValue(undefined);
const disconnectMock = vi.fn().mockResolvedValue(undefined);

vi.mock('kafkajs', () => ({
  Kafka: vi.fn().mockImplementation(() => ({
    consumer: vi.fn().mockReturnValue({
      connect: connectMock,
      subscribe: subscribeMock,
      run: runMock,
      disconnect: disconnectMock,
    }),
  })),
}));

describe('PositionKafkaConsumer', () => {
  let onBooked: ReturnType<typeof vi.fn>;
  let onCancelled: ReturnType<typeof vi.fn>;
  let consumer: PositionKafkaConsumer;

  beforeEach(() => {
    onBooked = vi.fn().mockResolvedValue(undefined);
    onCancelled = vi.fn().mockResolvedValue(undefined);
    consumer = new PositionKafkaConsumer(onBooked, onCancelled);
  });

  it('starts and subscribes to nexus.trading.trades', async () => {
    await consumer.start();
    expect(subscribeMock).toHaveBeenCalledWith(
      expect.objectContaining({ topics: ['nexus.trading.trades'] }),
    );
  });

  it('stops gracefully', async () => {
    await consumer.start();
    await consumer.stop();
    expect(disconnectMock).toHaveBeenCalled();
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
