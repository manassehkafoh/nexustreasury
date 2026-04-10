import { describe, it, expect } from 'vitest';
import { SWIFTISO20022Migrator, MTMessageType, MXMessageType } from './swift-iso20022-migrator.js';

const migrator = new SWIFTISO20022Migrator({ dualRunMode: true, lei: '549300EXAMPLE00001' });
const MT103 = {
  transactionRef: 'REF001',
  valueDate: '2026-04-10',
  currency: 'USD',
  amount: 500_000,
  orderingCustomer: 'Acme Corp',
  beneficiaryName: 'Beta Ltd',
  beneficiaryIBAN: 'GB29NWBK60161331926819',
  orderingBankBIC: 'BARCGB2L',
  receiverBankBIC: 'CITIUS33',
  remittanceInfo: 'Invoice 2026-001',
  purposeCode: 'SUPP',
};
const MT202 = {
  transactionRef: 'REF002',
  valueDate: '2026-04-10',
  currency: 'USD',
  amount: 5_000_000,
  orderingBankBIC: 'BARCGB2L',
  receiverBankBIC: 'CITIUS33',
  beneficiaryBIC: 'DEUTDEFF',
  uetr: '12345678-1234-4abc-89ab-123456789abc',
};

describe('SWIFTISO20022Migrator — Sprint 10.3', () => {
  it('MT103 → pacs.008 msgType is correct', () => {
    const r = migrator.convertMT103ToPacs008(MT103);
    expect(r.mxMessageType).toBe(MXMessageType.PACS008);
    expect(r.mtMessageType).toBe(MTMessageType.MT103);
  });
  it('UETR is a valid UUID format', () => {
    const r = migrator.convertMT103ToPacs008(MT103);
    expect(r.uetr).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
  it('pacs.008 contains original transaction ref', () => {
    const r = migrator.convertMT103ToPacs008(MT103);
    expect(r.mxMessage.cdtTrfTxInf[0].pmtId.instrId).toBe('REF001');
  });
  it('pacs.008 amount matches MT103 amount', () => {
    const r = migrator.convertMT103ToPacs008(MT103);
    expect(r.mxMessage.ctrlSum).toBe(500_000);
  });
  it('MT103 with IBAN and purpose code is CBPR+ compliant', () => {
    const r = migrator.convertMT103ToPacs008(MT103);
    expect(r.mxMessage.cbprPlusCompliant).toBe(true);
  });
  it('MT103 without IBAN fails validation', () => {
    const noIban = { ...MT103, beneficiaryIBAN: undefined };
    const r = migrator.convertMT103ToPacs008(noIban);
    expect(r.validationErrors.some((e) => e.includes('IBAN'))).toBe(true);
  });
  it('dual-run flag is active when configured', () => {
    const r = migrator.convertMT103ToPacs008(MT103);
    expect(r.dualRunActive).toBe(true);
  });
  it('MT202 → pacs.009 msgType is correct', () => {
    const r = migrator.convertMT202ToPacs009(MT202);
    expect(r.mxMessageType).toBe(MXMessageType.PACS009);
  });
  it('pacs.009 preserves original UETR from MT202', () => {
    const r = migrator.convertMT202ToPacs009(MT202);
    expect(r.uetr).toBe(MT202.uetr);
  });
  it('pacs.009 maps beneficiary BIC correctly', () => {
    const r = migrator.convertMT202ToPacs009(MT202);
    expect(r.mxMessage.cdtTrfTxInf[0].cdtr.bicfi).toBe('DEUTDEFF');
  });
  it('pacs.009 is valid with all required fields', () => {
    const r = migrator.convertMT202ToPacs009(MT202);
    expect(r.isValid).toBe(true);
  });
  it('LEI is included in pacs.008 when configured', () => {
    const r = migrator.convertMT103ToPacs008(MT103);
    expect(r.mxMessage.lei).toBe('549300EXAMPLE00001');
  });
});
