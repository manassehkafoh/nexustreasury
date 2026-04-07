import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BookTradeCommand } from './book-trade.command.js';
import { PassThroughPreDealCheck } from '../services/pre-deal-check.service.js';
import {
  AssetClass, TradeDirection, TenantId, CounterpartyId,
  InstrumentId, BookId, TraderId, TradeStatus, TradeDomainError,
} from '@nexustreasury/domain';

const mockRepo = {
  save:        vi.fn().mockResolvedValue(undefined),
  update:      vi.fn().mockResolvedValue(undefined),
  findById:    vi.fn().mockResolvedValue(null),
  findByBookId: vi.fn().mockResolvedValue([]),
};

const mockKafka = {
  publishDomainEvents: vi.fn().mockResolvedValue(undefined),
  connect:    vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
};

const validInput = {
  tenantId:        TenantId('tenant-001'),
  assetClass:      AssetClass.FX,
  direction:       TradeDirection.BUY,
  counterpartyId:  CounterpartyId('cpty-001'),
  instrumentId:    InstrumentId('instr-001'),
  bookId:          BookId('book-001'),
  traderId:        TraderId('trader-001'),
  notionalAmount:  1_000_000,
  notionalCurrency:'USD',
  price:           1.0842,
  tradeDate:       '2026-04-07',
  valueDate:       '2026-04-09',
};

describe('BookTradeCommand', () => {
  let command: BookTradeCommand;

  beforeEach(() => {
    vi.clearAllMocks();
    command = new BookTradeCommand(
      mockRepo as never,
      new PassThroughPreDealCheck(),
      mockKafka as never,
    );
  });

  it('books a trade and returns tradeId + reference', async () => {
    const result = await command.execute(validInput);
    expect(result.tradeId).toBeDefined();
    expect(result.reference).toMatch(/^FX-/);
    expect(result.status).toBe(TradeStatus.PENDING_VALIDATION);
  });

  it('persists the trade via repository', async () => {
    await command.execute(validInput);
    expect(mockRepo.save).toHaveBeenCalledTimes(1);
  });

  it('publishes TradeBookedEvent to Kafka', async () => {
    await command.execute(validInput);
    expect(mockKafka.publishDomainEvents).toHaveBeenCalledTimes(1);
    const events = mockKafka.publishDomainEvents.mock.calls[0][0];
    expect(events.some((e: { eventType: string }) => e.eventType === 'nexus.trading.trade.booked')).toBe(true);
  });

  it('throws TradeDomainError when pre-deal check fails', async () => {
    const failingCheck = {
      check: vi.fn().mockResolvedValue({
        approved: false,
        limitUtilisationPct: 110,
        headroomAmount: { toNumber: () => 0 },
        failureReasons: ['Counterparty limit exceeded: 110% > 100%'],
        checkedAt: new Date(),
      }),
    };
    const cmd = new BookTradeCommand(mockRepo as never, failingCheck as never, mockKafka as never);
    await expect(cmd.execute(validInput)).rejects.toThrow(TradeDomainError);
    expect(mockRepo.save).not.toHaveBeenCalled();
    expect(mockKafka.publishDomainEvents).not.toHaveBeenCalled();
  });

  it('throws when valueDate is before tradeDate', async () => {
    await expect(command.execute({
      ...validInput,
      tradeDate: '2026-04-09',
      valueDate:  '2026-04-07',
    })).rejects.toThrow(TradeDomainError);
  });

  it('throws when notional is zero', async () => {
    await expect(command.execute({ ...validInput, notionalAmount: 0 }))
      .rejects.toThrow(TradeDomainError);
  });

  it('does not persist or publish if domain invariant fails', async () => {
    await expect(command.execute({ ...validInput, notionalAmount: -500 }))
      .rejects.toThrow();
    expect(mockRepo.save).not.toHaveBeenCalled();
    expect(mockKafka.publishDomainEvents).not.toHaveBeenCalled();
  });
});
