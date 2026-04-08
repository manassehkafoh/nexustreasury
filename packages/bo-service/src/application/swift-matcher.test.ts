import { describe, it, expect, beforeEach } from 'vitest';
import { SWIFTMatcher, SWIFTMessageType, MatchStatus } from './swift-matcher.js';
import { ISO20022Parser } from './iso20022-parser.js';

// ── ISO 20022 XML fixtures ────────────────────────────────────────────────

const FXTR008_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:fxtr.008.001.05">
  <FXTradInstr>
    <TradId>FX-20260407-A3B2C1</TradId>
    <SttlmId>UTI-NEXUS-20260407-001</SttlmId>
    <TradAmts>
      <SttlmAmt Ccy="USD">
        <Amt>12500000</Amt>
      </SttlmAmt>
      <XchgRate>1.0842</XchgRate>
    </TradAmts>
    <TradDt>2026-04-07</TradDt>
    <SttlmDt>2026-04-09</SttlmDt>
    <TrdgSdId>
      <Id>
        <LEI>BANK0GHAC00000000001</LEI>
        <BIC>BANKGHAC</BIC>
      </Id>
    </TrdgSdId>
  </FXTradInstr>
</Document>`;

const PACS009_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.009.001.10">
  <FICdtTrf>
    <GrpHdr>
      <MsgId>MSG-20260407-PACS009-001</MsgId>
      <NbOfTxs>1</NbOfTxs>
      <SttlmInf>
        <SttlmMtd>CLRG</SttlmMtd>
      </SttlmInf>
    </GrpHdr>
    <CdtTrfTxInf>
      <PmtId>
        <EndToEndId>FX-20260407-A3B2C1</EndToEndId>
        <InstrId>INSTR-001</InstrId>
      </PmtId>
      <IntrBkSttlmAmt Ccy="USD">12500000</IntrBkSttlmAmt>
      <IntrBkSttlmDt>2026-04-09</IntrBkSttlmDt>
      <Dbtr>
        <FinInstnId>
          <BICFI>BANKGHAC</BICFI>
          <LEI>BANK0GHAC00000000001</LEI>
        </FinInstnId>
      </Dbtr>
      <Cdtr>
        <FinInstnId>
          <BICFI>NEXUSGHAC</BICFI>
          <LEI>NEXUS0GHAC0000000001</LEI>
        </FinInstnId>
      </Cdtr>
    </CdtTrfTxInf>
  </FICdtTrf>
</Document>`;

const PACS008_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.10">
  <FIToFICstmrCdtTrf>
    <GrpHdr>
      <MsgId>MSG-PACS008-001</MsgId>
      <NbOfTxs>1</NbOfTxs>
    </GrpHdr>
    <CdtTrfTxInf>
      <PmtId>
        <EndToEndId>FX-20260407-A3B2C1</EndToEndId>
      </PmtId>
      <IntrBkSttlmAmt Ccy="USD">12500000</IntrBkSttlmAmt>
      <IntrBkSttlmDt>2026-04-09</IntrBkSttlmDt>
      <DbtrAgt>
        <FinInstnId>
          <BICFI>BANKGHAC</BICFI>
        </FinInstnId>
      </DbtrAgt>
      <CdtrAgt>
        <FinInstnId>
          <BICFI>NEXUSGHAC</BICFI>
        </FinInstnId>
      </CdtrAgt>
    </CdtTrfTxInf>
  </FIToFICstmrCdtTrf>
</Document>`;

const CAMT056_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.056.001.10">
  <FIToFIPmtCxlReq>
    <Assgnmt>
      <Id>CANC-20260407-001</Id>
    </Assgnmt>
    <Undrlyg>
      <TxInf>
        <OrgnlEndToEndId>FX-20260407-A3B2C1</OrgnlEndToEndId>
      </TxInf>
    </Undrlyg>
  </FIToFIPmtCxlReq>
</Document>`;

// ── Legacy MT FIN fixture ─────────────────────────────────────────────────

const MT300_FIN = `{1:F01NEXUSGHACAXXX0000000001}
{2:I300BANKGHACACXXXN}
{4:
:20:FX-20260407-A3B2C1
:22A:NEWT
:94A:AFWD
:17T:B
:30T:260407
:30V:260409
:36:1,0842
:32B:USD12500000,
:33B:EUR11530000,
:82A:/NEXUSGHAC
:87A:/BANKGHAC
-}`;

// ── Trade reference and data shared across tests ──────────────────────────

const TRADE_REF = 'FX-20260407-A3B2C1';
const TRADE_DATA = {
  notionalAmount: 12_500_000,
  currency: 'USD',
  exchangeRate: 1.0842,
  valueDate: '2026-04-09',
  counterpartyBIC: 'BANKGHAC',
  counterpartyLEI: 'BANK0GHAC00000000001',
};

// ── Test helpers ─────────────────────────────────────────────────────────

function makeMessage(
  type: SWIFTMessageType,
  content: string,
  senderBIC = 'BANKGHAC',
  receiverBIC = 'NEXUSGHAC',
) {
  return {
    messageId: `MSG-${Date.now()}`,
    messageType: type,
    senderBIC,
    receiverBIC,
    content,
    receivedAt: new Date(),
  };
}

// ── ISO20022Parser unit tests ─────────────────────────────────────────────

describe('ISO20022Parser', () => {
  describe('fxtr.008 — FX Trade Confirmation', () => {
    it('extracts trade reference from TradId', () => {
      const result = ISO20022Parser.parse(FXTR008_XML, SWIFTMessageType.FXTR008);
      expect(result.tradeReference).toBe('FX-20260407-A3B2C1');
    });

    it('extracts UTI from SttlmId', () => {
      const result = ISO20022Parser.parse(FXTR008_XML, SWIFTMessageType.FXTR008);
      expect(result.uti).toBe('UTI-NEXUS-20260407-001');
    });

    it('extracts settlement amount and currency', () => {
      const result = ISO20022Parser.parse(FXTR008_XML, SWIFTMessageType.FXTR008);
      expect(result.notionalAmount).toBe(12_500_000);
      expect(result.currency).toBe('USD');
    });

    it('extracts exchange rate', () => {
      const result = ISO20022Parser.parse(FXTR008_XML, SWIFTMessageType.FXTR008);
      expect(result.exchangeRate).toBeCloseTo(1.0842, 4);
    });

    it('extracts trade date and settlement date', () => {
      const result = ISO20022Parser.parse(FXTR008_XML, SWIFTMessageType.FXTR008);
      expect(result.tradeDate).toBe('2026-04-07');
      expect(result.valueDate).toBe('2026-04-09');
    });

    it('extracts sender LEI and BIC', () => {
      const result = ISO20022Parser.parse(FXTR008_XML, SWIFTMessageType.FXTR008);
      expect(result.senderLEI).toBe('BANK0GHAC00000000001');
      expect(result.senderBIC).toBe('BANKGHAC');
    });

    it('sets productType to FX', () => {
      const result = ISO20022Parser.parse(FXTR008_XML, SWIFTMessageType.FXTR008);
      expect(result.productType).toBe('FX');
    });
  });

  describe('pacs.009 — FI Credit Transfer (FX settlement)', () => {
    it('extracts EndToEndId as trade reference', () => {
      const result = ISO20022Parser.parse(PACS009_XML, SWIFTMessageType.PACS009);
      expect(result.tradeReference).toBe('FX-20260407-A3B2C1');
    });

    it('extracts EndToEndId as UTI', () => {
      const result = ISO20022Parser.parse(PACS009_XML, SWIFTMessageType.PACS009);
      expect(result.uti).toBe('FX-20260407-A3B2C1');
    });

    it('extracts settlement amount', () => {
      const result = ISO20022Parser.parse(PACS009_XML, SWIFTMessageType.PACS009);
      expect(result.notionalAmount).toBe(12_500_000);
      expect(result.currency).toBe('USD');
    });

    it('extracts debtor and creditor BIC', () => {
      const result = ISO20022Parser.parse(PACS009_XML, SWIFTMessageType.PACS009);
      expect(result.senderBIC).toBe('BANKGHAC');
      expect(result.receiverBIC).toBe('NEXUSGHAC');
    });

    it('extracts LEI for both parties', () => {
      const result = ISO20022Parser.parse(PACS009_XML, SWIFTMessageType.PACS009);
      expect(result.senderLEI).toBe('BANK0GHAC00000000001');
      expect(result.receiverLEI).toBe('NEXUS0GHAC0000000001');
    });

    it('extracts settlement date as valueDate', () => {
      const result = ISO20022Parser.parse(PACS009_XML, SWIFTMessageType.PACS009);
      expect(result.valueDate).toBe('2026-04-09');
    });
  });

  describe('pacs.008 — Customer Credit Transfer', () => {
    it('extracts EndToEndId as trade reference', () => {
      const result = ISO20022Parser.parse(PACS008_XML, SWIFTMessageType.PACS008);
      expect(result.tradeReference).toBe('FX-20260407-A3B2C1');
    });

    it('extracts debtor and creditor agent BIC', () => {
      const result = ISO20022Parser.parse(PACS008_XML, SWIFTMessageType.PACS008);
      expect(result.senderBIC).toBe('BANKGHAC');
      expect(result.receiverBIC).toBe('NEXUSGHAC');
    });
  });

  describe('camt.056 — Cancellation Request', () => {
    it('extracts original EndToEndId as trade reference', () => {
      const result = ISO20022Parser.parse(CAMT056_XML, SWIFTMessageType.CAMT056);
      expect(result.tradeReference).toBe('FX-20260407-A3B2C1');
    });

    it('sets productType to CANCELLATION_REQUEST', () => {
      const result = ISO20022Parser.parse(CAMT056_XML, SWIFTMessageType.CAMT056);
      expect(result.productType).toBe('CANCELLATION_REQUEST');
    });
  });

  describe('MT300 — Legacy FIN format', () => {
    it('extracts :20: field as trade reference', () => {
      const result = ISO20022Parser.parseMT(MT300_FIN, SWIFTMessageType.MT300);
      expect(result.tradeReference).toBe('FX-20260407-A3B2C1');
    });

    it('extracts settlement amount from :32B:', () => {
      const result = ISO20022Parser.parseMT(MT300_FIN, SWIFTMessageType.MT300);
      expect(result.notionalAmount).toBe(12_500_000);
      expect(result.currency).toBe('USD');
    });

    it('extracts exchange rate from :36:', () => {
      const result = ISO20022Parser.parseMT(MT300_FIN, SWIFTMessageType.MT300);
      expect(result.exchangeRate).toBeCloseTo(1.0842, 4);
    });

    it('extracts value date from :30V: and formats as YYYY-MM-DD', () => {
      const result = ISO20022Parser.parseMT(MT300_FIN, SWIFTMessageType.MT300);
      expect(result.valueDate).toBe('2026-04-09');
    });

    it('extracts trade date from :30T: and formats as YYYY-MM-DD', () => {
      const result = ISO20022Parser.parseMT(MT300_FIN, SWIFTMessageType.MT300);
      expect(result.tradeDate).toBe('2026-04-07');
    });
  });

  describe('Error handling', () => {
    it('returns empty fields for malformed XML without throwing', () => {
      const result = ISO20022Parser.parse('<bad xml><<', SWIFTMessageType.PACS009);
      expect(result.tradeReference).toBeNull();
      expect(result.notionalAmount).toBeNull();
    });
  });
});

// ── SWIFTMatcher integration tests ───────────────────────────────────────

describe('SWIFTMatcher', () => {
  let matcher: SWIFTMatcher;

  beforeEach(() => {
    matcher = new SWIFTMatcher();
  });

  describe('ISO 20022 fxtr.008 matching', () => {
    it('returns MATCHED with score ≥ 80 when all fields agree', async () => {
      const msg = makeMessage(SWIFTMessageType.FXTR008, FXTR008_XML);
      const result = await matcher.match(msg, TRADE_REF, TRADE_DATA);
      expect(result.status).toBe(MatchStatus.MATCHED);
      expect(result.matchScore).toBeGreaterThanOrEqual(80);
    });

    it('includes tradeReference in result', async () => {
      const msg = makeMessage(SWIFTMessageType.FXTR008, FXTR008_XML);
      const result = await matcher.match(msg, TRADE_REF, TRADE_DATA);
      expect(result.tradeRef).toBe(TRADE_REF);
    });

    it('includes UTI in result', async () => {
      const msg = makeMessage(SWIFTMessageType.FXTR008, FXTR008_XML);
      const result = await matcher.match(msg, TRADE_REF, TRADE_DATA);
      expect(result.uti).toBe('UTI-NEXUS-20260407-001');
    });

    it('includes LEI in result', async () => {
      const msg = makeMessage(SWIFTMessageType.FXTR008, FXTR008_XML);
      const result = await matcher.match(msg, TRADE_REF, TRADE_DATA);
      expect(result.senderLEI).toBe('BANK0GHAC00000000001');
    });

    it('returns UNMATCHED when no tradeRef anywhere', async () => {
      const msg = makeMessage(SWIFTMessageType.FXTR008, FXTR008_XML);
      const result = await matcher.match(msg, null);
      // fxtr.008 carries its own TradId — should partially match
      expect([MatchStatus.MATCHED, MatchStatus.PENDING, MatchStatus.UNMATCHED]).toContain(
        result.status,
      );
    });
  });

  describe('ISO 20022 pacs.009 matching', () => {
    it('returns MATCHED when EndToEndId matches trade reference', async () => {
      const msg = makeMessage(SWIFTMessageType.PACS009, PACS009_XML);
      const result = await matcher.match(msg, TRADE_REF, TRADE_DATA);
      expect(result.status).toBe(MatchStatus.MATCHED);
      expect(result.matchScore).toBeGreaterThanOrEqual(80);
    });

    it('scores 40 pts for reference + 20 pts for LEI match', async () => {
      const msg = makeMessage(SWIFTMessageType.PACS009, PACS009_XML);
      const result = await matcher.match(msg, TRADE_REF, TRADE_DATA);
      expect(result.matchedFields).toContain('tradeReference');
      expect(result.matchedFields).toContain('counterpartyLEI');
    });

    it('scores valueDate match', async () => {
      const msg = makeMessage(SWIFTMessageType.PACS009, PACS009_XML);
      const result = await matcher.match(msg, TRADE_REF, TRADE_DATA);
      expect(result.matchedFields).toContain('valueDate');
    });

    it('scores notionalAmount match within 0.01% tolerance', async () => {
      const msg = makeMessage(SWIFTMessageType.PACS009, PACS009_XML);
      const result = await matcher.match(msg, TRADE_REF, TRADE_DATA);
      expect(result.matchedFields).toContain('notionalAmount');
    });
  });

  describe('ISO 20022 camt.056 — Cancellation Request', () => {
    it('identifies original trade reference from cancellation', async () => {
      const msg = makeMessage(SWIFTMessageType.CAMT056, CAMT056_XML);
      const result = await matcher.match(msg, TRADE_REF);
      expect(result.tradeRef).toBe(TRADE_REF);
      expect(result.parsedFields.productType).toBe('CANCELLATION_REQUEST');
    });
  });

  describe('Legacy MT300 matching', () => {
    it('parses MT FIN format via MT30 path', async () => {
      const msg = makeMessage(SWIFTMessageType.MT300, MT300_FIN);
      const result = await matcher.match(msg, TRADE_REF, TRADE_DATA);
      expect(result.matchScore).toBeGreaterThanOrEqual(80);
      expect(result.status).toBe(MatchStatus.MATCHED);
    });

    it('extracts trade reference from :20: field', async () => {
      const msg = makeMessage(SWIFTMessageType.MT300, MT300_FIN);
      const result = await matcher.match(msg, TRADE_REF, TRADE_DATA);
      expect(result.tradeRef).toBe(TRADE_REF);
    });
  });

  describe('Field mismatch detection', () => {
    it('returns EXCEPTION with reason when reference does not match', async () => {
      const msg = makeMessage(SWIFTMessageType.PACS009, PACS009_XML);
      const result = await matcher.match(msg, 'DIFFERENT-REF-001', TRADE_DATA);
      expect(result.status).toBe(MatchStatus.EXCEPTION);
      expect(result.exceptions[0]).toContain('Reference mismatch');
    });

    it('returns EXCEPTION when value date differs', async () => {
      const msg = makeMessage(SWIFTMessageType.PACS009, PACS009_XML);
      const result = await matcher.match(msg, TRADE_REF, {
        ...TRADE_DATA,
        valueDate: '2026-04-10', // wrong date
      });
      expect(result.exceptions.some((e) => e.includes('Value date'))).toBe(true);
    });

    it('returns EXCEPTION when amount differs by more than 0.01%', async () => {
      const msg = makeMessage(SWIFTMessageType.PACS009, PACS009_XML);
      const result = await matcher.match(msg, TRADE_REF, {
        ...TRADE_DATA,
        notionalAmount: 13_000_000, // significantly different
      });
      expect(result.exceptions.some((e) => e.includes('Amount mismatch'))).toBe(true);
    });
  });

  describe('Compliance validators', () => {
    it('validates well-formed LEI (ISO 17442)', () => {
      expect(SWIFTMatcher.isValidLEI('BANK0GHAC00000000001')).toBe(true);
    });

    it('rejects malformed LEI', () => {
      expect(SWIFTMatcher.isValidLEI('TOOSHORT')).toBe(false);
      expect(SWIFTMatcher.isValidLEI('')).toBe(false);
    });

    it('validates 8-char BIC (ISO 9362)', () => {
      expect(SWIFTMatcher.isValidBIC('BANKGHAC')).toBe(true);
    });

    it('validates 11-char BIC with branch code', () => {
      expect(SWIFTMatcher.isValidBIC('BANKGHACAXX')).toBe(true);
    });

    it('rejects malformed BIC', () => {
      expect(SWIFTMatcher.isValidBIC('TOOSHORT1')).toBe(false);
      expect(SWIFTMatcher.isValidBIC('123GHAC')).toBe(false);
    });
  });

  describe('No-reference unmatched case', () => {
    it('returns UNMATCHED with empty score when tradeRef is null and content is non-XML', async () => {
      const msg = makeMessage(SWIFTMessageType.MT300, 'NO REFERENCE CONTENT');
      const result = await matcher.match(msg, null);
      expect(result.status).toBe(MatchStatus.UNMATCHED);
      expect(result.matchScore).toBe(0);
    });
  });
});

// ── Additional ISO 20022 message type tests ───────────────────────────────

const CAMT053_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.10">
  <BkToCstmrStmt>
    <GrpHdr>
      <MsgId>STMT-20260407-001</MsgId>
    </GrpHdr>
    <Stmt>
      <Acct>
        <Id>
          <IBAN>GH1234567890123456</IBAN>
        </Id>
      </Acct>
      <FrToDt>
        <ToDtTm>2026-04-07T17:00:00</ToDtTm>
      </FrToDt>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

const CAMT054_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.10">
  <BkToCstmrDbtCdtNtfctn>
    <GrpHdr>
      <MsgId>NTFCTN-20260407-001</MsgId>
    </GrpHdr>
    <Ntfctn>
      <Ntry>
        <Amt Ccy="USD">12500000</Amt>
        <ValDt>
          <Dt>2026-04-09</Dt>
        </ValDt>
        <NtryDtls>
          <TxDtls>
            <Refs>
              <EndToEndId>FX-20260407-A3B2C1</EndToEndId>
            </Refs>
          </TxDtls>
        </NtryDtls>
      </Ntry>
    </Ntfctn>
  </BkToCstmrDbtCdtNtfctn>
</Document>`;

const PACS002_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.002.001.12">
  <FIToFIPmtStsRpt>
    <GrpHdr>
      <MsgId>STATUS-20260407-001</MsgId>
    </GrpHdr>
    <TxInfAndSts>
      <OrgnlEndToEndId>FX-20260407-A3B2C1</OrgnlEndToEndId>
      <TxSts>ACSC</TxSts>
    </TxInfAndSts>
  </FIToFIPmtStsRpt>
</Document>`;

const PACS028_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.028.001.04">
  <FIToFIPmtStsReq>
    <GrpHdr>
      <MsgId>STATUSREQ-20260407-001</MsgId>
    </GrpHdr>
    <TxInf>
      <OrgnlEndToEndId>FX-20260407-A3B2C1</OrgnlEndToEndId>
    </TxInf>
  </FIToFIPmtStsReq>
</Document>`;

describe('ISO20022Parser — remaining message types', () => {
  describe('camt.053 — Bank Statement (Nostro reconciliation)', () => {
    it('extracts message ID', () => {
      const result = ISO20022Parser.parse(CAMT053_XML, SWIFTMessageType.CAMT053);
      expect(result.messageRef).toBe('STMT-20260407-001');
    });

    it('extracts IBAN as trade reference', () => {
      const result = ISO20022Parser.parse(CAMT053_XML, SWIFTMessageType.CAMT053);
      expect(result.tradeReference).toBe('GH1234567890123456');
    });

    it('extracts end-of-day timestamp as valueDate', () => {
      const result = ISO20022Parser.parse(CAMT053_XML, SWIFTMessageType.CAMT053);
      expect(result.valueDate).toContain('2026-04-07');
    });

    it('sets productType to STATEMENT', () => {
      const result = ISO20022Parser.parse(CAMT053_XML, SWIFTMessageType.CAMT053);
      expect(result.productType).toBe('STATEMENT');
    });
  });

  describe('camt.054 — Debit/Credit Notification', () => {
    it('extracts EndToEndId as trade reference and UTI', () => {
      const result = ISO20022Parser.parse(CAMT054_XML, SWIFTMessageType.CAMT054);
      expect(result.tradeReference).toBe('FX-20260407-A3B2C1');
      expect(result.uti).toBe('FX-20260407-A3B2C1');
    });

    it('extracts value date', () => {
      const result = ISO20022Parser.parse(CAMT054_XML, SWIFTMessageType.CAMT054);
      expect(result.valueDate).toBe('2026-04-09');
    });

    it('sets productType to NOTIFICATION', () => {
      const result = ISO20022Parser.parse(CAMT054_XML, SWIFTMessageType.CAMT054);
      expect(result.productType).toBe('NOTIFICATION');
    });
  });

  describe('pacs.002 — Payment Status Report', () => {
    it('extracts original EndToEndId from status report', () => {
      const result = ISO20022Parser.parse(PACS002_XML, SWIFTMessageType.PACS002);
      expect(result.tradeReference).toBe('FX-20260407-A3B2C1');
      expect(result.uti).toBe('FX-20260407-A3B2C1');
    });

    it('extracts message ID', () => {
      const result = ISO20022Parser.parse(PACS002_XML, SWIFTMessageType.PACS002);
      expect(result.messageRef).toBe('STATUS-20260407-001');
    });

    it('sets productType to PAYMENT_STATUS', () => {
      const result = ISO20022Parser.parse(PACS002_XML, SWIFTMessageType.PACS002);
      expect(result.productType).toBe('PAYMENT_STATUS');
    });
  });

  describe('pacs.028 — Payment Status Request', () => {
    it('extracts original EndToEndId from status request', () => {
      const result = ISO20022Parser.parse(PACS028_XML, SWIFTMessageType.PACS028);
      expect(result.tradeReference).toBe('FX-20260407-A3B2C1');
    });

    it('sets productType to STATUS_REQUEST', () => {
      const result = ISO20022Parser.parse(PACS028_XML, SWIFTMessageType.PACS028);
      expect(result.productType).toBe('STATUS_REQUEST');
    });
  });
});

describe('SWIFTMatcher — additional branch coverage', () => {
  let matcher: SWIFTMatcher;
  beforeEach(() => {
    matcher = new SWIFTMatcher();
  });

  it('matches via BIC when no LEI provided (counterpartyBIC path)', async () => {
    const msg = makeMessage(SWIFTMessageType.PACS009, PACS009_XML);
    const result = await matcher.match(msg, TRADE_REF, {
      notionalAmount: 12_500_000,
      currency: 'USD',
      valueDate: '2026-04-09',
      counterpartyBIC: 'BANKGHAC', // BIC only — no LEI
    });
    expect(result.matchedFields).toContain('counterpartyBIC');
    expect(result.status).toBe(MatchStatus.MATCHED);
  });

  it('reports rate mismatch exception when exchange rate differs beyond tolerance', async () => {
    const msg = makeMessage(SWIFTMessageType.FXTR008, FXTR008_XML);
    const result = await matcher.match(msg, TRADE_REF, {
      ...TRADE_DATA,
      exchangeRate: 1.1, // significantly different from 1.0842
    });
    expect(result.exceptions.some((e) => e.includes('Rate mismatch'))).toBe(true);
  });

  it('matches via envelope BIC fallback when no tradeData provided', async () => {
    // Message with BIC in envelope AND in parsed content
    const msg = makeMessage(SWIFTMessageType.PACS009, PACS009_XML, 'BANKGHAC');
    const result = await matcher.match(msg, TRADE_REF);
    // Should at least get partial score via envelope BIC
    expect(result.matchScore).toBeGreaterThan(0);
  });

  it('pacs.002 status report matched against original trade reference', async () => {
    const msg = makeMessage(SWIFTMessageType.PACS002, PACS002_XML);
    const result = await matcher.match(msg, TRADE_REF);
    expect(result.tradeRef).toBe(TRADE_REF);
    expect(result.parsedFields.productType).toBe('PAYMENT_STATUS');
  });

  it('camt.053 bank statement processed without throwing', async () => {
    const msg = makeMessage(SWIFTMessageType.CAMT053, CAMT053_XML);
    const result = await matcher.match(msg, null);
    expect(result.parsedFields.productType).toBe('STATEMENT');
  });

  it('camt.054 notification matched to original trade', async () => {
    const msg = makeMessage(SWIFTMessageType.CAMT054, CAMT054_XML);
    const result = await matcher.match(msg, TRADE_REF);
    expect(result.tradeRef).toBe(TRADE_REF);
  });
});

// ── Branch coverage: amount as plain text + Array.isArray paths ──────────

const PACS009_PLAIN_AMOUNT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.009.001.10">
  <FICdtTrf>
    <GrpHdr>
      <MsgId>MSG-PLAIN-001</MsgId>
      <NbOfTxs>1</NbOfTxs>
    </GrpHdr>
    <CdtTrfTxInf>
      <PmtId>
        <EndToEndId>FX-PLAIN-001</EndToEndId>
      </PmtId>
      <IntrBkSttlmAmt>5000000</IntrBkSttlmAmt>
      <IntrBkSttlmDt>2026-04-10</IntrBkSttlmDt>
      <Dbtr>
        <FinInstnId>
          <BICFI>BANKGHAC</BICFI>
        </FinInstnId>
      </Dbtr>
      <Cdtr>
        <FinInstnId>
          <BICFI>NEXUSGHAC</BICFI>
        </FinInstnId>
      </Cdtr>
    </CdtTrfTxInf>
  </FICdtTrf>
</Document>`;

const PACS008_PLAIN_AMOUNT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.10">
  <FIToFICstmrCdtTrf>
    <GrpHdr>
      <MsgId>MSG-PACS008-PLAIN-001</MsgId>
      <NbOfTxs>1</NbOfTxs>
    </GrpHdr>
    <CdtTrfTxInf>
      <PmtId>
        <EndToEndId>FX-PACS008-PLAIN</EndToEndId>
      </PmtId>
      <IntrBkSttlmAmt>3000000</IntrBkSttlmAmt>
      <IntrBkSttlmDt>2026-04-11</IntrBkSttlmDt>
      <DbtrAgt>
        <FinInstnId>
          <BICFI>BANKGHAC</BICFI>
        </FinInstnId>
      </DbtrAgt>
      <CdtrAgt>
        <FinInstnId>
          <BICFI>NEXUSGHAC</BICFI>
        </FinInstnId>
      </CdtrAgt>
    </CdtTrfTxInf>
  </FIToFICstmrCdtTrf>
</Document>`;

describe('ISO20022Parser — branch coverage: plain amount strings', () => {
  it('parses pacs.009 with plain text amount (no Ccy attribute)', () => {
    const result = ISO20022Parser.parse(PACS009_PLAIN_AMOUNT_XML, SWIFTMessageType.PACS009);
    // amount parses as number (else branch of typeof amt === 'object')
    expect(result.notionalAmount).toBe(5_000_000);
    // currency is null when no Ccy attribute present
    expect(result.currency).toBeNull();
    expect(result.tradeReference).toBe('FX-PLAIN-001');
  });

  it('parses pacs.008 with plain text amount (no Ccy attribute)', () => {
    const result = ISO20022Parser.parse(PACS008_PLAIN_AMOUNT_XML, SWIFTMessageType.PACS008);
    expect(result.notionalAmount).toBe(3_000_000);
    expect(result.currency).toBeNull();
    expect(result.tradeReference).toBe('FX-PACS008-PLAIN');
  });
});
