/**
 * SettlementInstructionGenerator — TDD test suite
 */
import { describe, it, expect } from 'vitest';
import {
  SettlementInstructionGenerator,
  MessageType,
  SettlementInstructionStatus,
} from './settlement-instruction-generator.js';
import { AssetClass, TradeId } from '@nexustreasury/domain';
import type { SSIRecord } from './ssi.service.js';
import { SettlementMethod } from './ssi.service.js';

const gen = new SettlementInstructionGenerator();

const citiSSI: SSIRecord = {
  id: 'ssi-001',
  tenantId: 'tenant-001',
  counterpartyId: 'cp-001',
  currency: 'USD',
  instrumentType: 'FX',
  method: SettlementMethod.SWIFT_MT,
  beneficiaryBank: { bic: 'CITIUS33XXX', bankName: 'Citibank NA' },
  beneficiaryAccount: '36838271',
  beneficiaryName: 'Citibank Treasury',
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  version: 1,
};

const baseTrade = {
  tradeId: TradeId('trade-001'),
  tenantId: 'tenant-001',
  direction: 'BUY' as const,
  notional: 1_000_000,
  currency: 'EUR',
  counterpartyCurrency: 'USD',
  spotRate: 1.0842,
  valueDate: new Date('2026-04-11'),
  tradeDate: new Date('2026-04-09'),
  counterpartyId: 'cp-001',
  tradeRef: 'FX-20260409-A1B2',
  isCorporateClient: false,
};

describe('SettlementInstructionGenerator — FX', () => {
  it('generates 2 instructions for FX spot (pay leg + receive notice)', async () => {
    const insts = await gen.generate(
      { ...baseTrade, assetClass: AssetClass.FX, instrumentType: 'SPOT' },
      citiSSI,
    );
    expect(insts).toHaveLength(2);
  });

  it('pay leg is MT202 for bank-to-bank FX', async () => {
    const [payLeg] = await gen.generate(
      { ...baseTrade, assetClass: AssetClass.FX, instrumentType: 'SPOT' },
      citiSSI,
    );
    expect(payLeg!.messageType).toBe(MessageType.MT202);
  });

  it('notice to receive is MT210', async () => {
    const [, recvLeg] = await gen.generate(
      { ...baseTrade, assetClass: AssetClass.FX, instrumentType: 'SPOT' },
      citiSSI,
    );
    expect(recvLeg!.messageType).toBe(MessageType.MT210);
  });

  it('pay leg MT message contains BIC and trade ref', async () => {
    const [payLeg] = await gen.generate(
      { ...baseTrade, assetClass: AssetClass.FX, instrumentType: 'SPOT' },
      citiSSI,
    );
    expect(payLeg!.mtMessage).toContain('CITIUS33XXX');
    expect(payLeg!.mtMessage).toContain('FX-20260409');
  });

  it('uses MT103 when isCorporateClient=true', async () => {
    const [payLeg] = await gen.generate(
      { ...baseTrade, assetClass: AssetClass.FX, instrumentType: 'SPOT', isCorporateClient: true },
      citiSSI,
    );
    expect(payLeg!.messageType).toBe(MessageType.MT103);
  });

  it('instructions start with PENDING status', async () => {
    const insts = await gen.generate(
      { ...baseTrade, assetClass: AssetClass.FX, instrumentType: 'SPOT' },
      citiSSI,
    );
    expect(insts.every((i) => i.status === SettlementInstructionStatus.PENDING)).toBe(true);
  });

  it('works with null SSI (unknown counterparty)', async () => {
    const insts = await gen.generate(
      { ...baseTrade, assetClass: AssetClass.FX, instrumentType: 'SPOT' },
      null,
    );
    expect(insts).toHaveLength(2);
    expect(insts[0]!.counterpartyBic).toBe('UNKNOWN');
  });
});

describe('SettlementInstructionGenerator — Fixed Income', () => {
  it('generates MT541 for bond purchase (receive against payment)', async () => {
    const [inst] = await gen.generate(
      { ...baseTrade, assetClass: AssetClass.FIXED_INCOME, instrumentType: 'BOND' },
      citiSSI,
    );
    expect(inst!.messageType).toBe(MessageType.MT541);
  });

  it('generates MT543 for bond sale (deliver against payment)', async () => {
    const [inst] = await gen.generate(
      {
        ...baseTrade,
        assetClass: AssetClass.FIXED_INCOME,
        instrumentType: 'BOND',
        direction: 'SELL',
      },
      citiSSI,
    );
    expect(inst!.messageType).toBe(MessageType.MT543);
  });

  it('MT54x message contains GENL and FIAC blocks', async () => {
    const [inst] = await gen.generate(
      { ...baseTrade, assetClass: AssetClass.FIXED_INCOME, instrumentType: 'BOND' },
      citiSSI,
    );
    expect(inst!.mtMessage).toContain(':16R:GENL');
    expect(inst!.mtMessage).toContain(':16R:FIAC');
  });
});

describe('SettlementInstructionGenerator — Money Market', () => {
  it('generates MT202 for interbank MM placement', async () => {
    const [inst] = await gen.generate(
      { ...baseTrade, assetClass: AssetClass.MONEY_MARKET, instrumentType: 'DEPOSIT' },
      citiSSI,
    );
    expect(inst!.messageType).toBe(MessageType.MT202);
  });
});
