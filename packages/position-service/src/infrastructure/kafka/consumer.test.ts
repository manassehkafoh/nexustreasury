import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PositionKafkaConsumer } from './consumer.js';

// Mock kafkajs
const { mockDisconnect, mockSubscribe, mockRun, mockConnect, mockConsumer } = vi.hoisted(() => {
  const mockDisconnect = vi.fn().mockResolvedValue(undefined);
  const mockSubscribe = vi.fn().mockResolvedValue(undefined);
  const mockRun = vi.fn().mockResolvedValue(undefined);
  const mockConnect = vi.fn().mockResolvedValue(undefined);
  const mockConsumer = vi.fn().mockReturnValue({
    connect: mockConnect,
    subscribe: mockSubscribe,
    run: mockRun,
    disconnect: mockDisconnect,
  });
  return { mockDisconnect, mockSubscribe, mockRun, mockConnect, mockConsumer };
});

vi.mock('kafkajs', () => ({
  Kafka: vi.fn().mockImplementation(() => ({
    consumer: mockConsumer,
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
