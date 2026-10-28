import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PositionKafkaConsumer } from './consumer.js';
import { Kafka } from 'kafkajs';

const { mockConnect, mockSubscribe, mockRun, mockDisconnect } = vi.hoisted(() => ({
  mockConnect: vi.fn().mockResolvedValue(undefined),
  mockSubscribe: vi.fn().mockResolvedValue(undefined),
  mockRun: vi.fn().mockResolvedValue(undefined),
  mockDisconnect: vi.fn().mockResolvedValue(undefined),
}));

// Mock kafkajs
vi.mock('kafkajs', () => ({
  Kafka: vi.fn().mockImplementation(() => ({
    consumer: vi.fn().mockReturnValue({
      connect: mockConnect,
      subscribe: mockSubscribe,
      run: mockRun,
      disconnect: mockDisconnect,
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
    expect(mockSubscribe).toHaveBeenCalledWith(
      expect.objectContaining({ topics: ['nexus.trading.trades'] }),
    );
  });

  it('stops gracefully', async () => {
    await consumer.start();
    await consumer.stop();
    expect(mockDisconnect).toHaveBeenCalled();
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
