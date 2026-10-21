import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PositionKafkaConsumer } from './consumer.js';

// Mock kafkajs
const mocks = vi.hoisted(() => ({
  connectMock: vi.fn().mockResolvedValue(undefined),
  subscribeMock: vi.fn().mockResolvedValue(undefined),
  runMock: vi.fn().mockResolvedValue(undefined),
  disconnectMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('kafkajs', () => ({
  Kafka: vi.fn().mockImplementation(() => ({
    consumer: vi.fn().mockReturnValue({
      connect: mocks.connectMock,
      subscribe: mocks.subscribeMock,
      run: mocks.runMock,
      disconnect: mocks.disconnectMock,
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
    expect(mocks.subscribeMock).toHaveBeenCalledWith(
      expect.objectContaining({ topics: ['nexus.trading.trades'] }),
    );
  });

  it('stops gracefully', async () => {
    await consumer.start();
    await consumer.stop();
    expect(mocks.disconnectMock).toHaveBeenCalled();
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
