/**
 * @module ISO20022Parser
 *
 * Parser for SWIFT MX (ISO 20022 XML) messages and legacy MT (FIN) messages.
 *
 * ## SWIFT Message Format Terminology
 *
 * **MX** (Message XML) — ISO 20022 format. XML-structured, namespace-declared.
 * Example: `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.009.001.10">`
 * These are the current SWIFT standard. SWIFT completed its cross-border
 * payments MX migration in November 2025.
 *
 * **MT** (Message Type) — Legacy SWIFT FIN format. Text-based, colon-tagged fields.
 * Example: `:20:FX-20260407-A3B2C1`, `:32B:USD12500000,`
 * Still accepted during the coexistence period (until 2028).
 *
 * ## MX → MT Migration Map
 *
 * | MX (ISO 20022)  | Replaces (MT) | Purpose |
 * |-----------------|---------------|---------|
 * | fxtr.008        | MT300         | FX Trade Confirmation |
 * | fxtr.014        | MT300         | FX Trade Status Advice |
 * | pacs.008        | MT103         | Customer Credit Transfer |
 * | pacs.009        | MT202         | FI Credit Transfer (FX settlement) |
 * | pacs.002        | MT199         | Payment Status Report |
 * | pacs.028        | MT192         | FI Payment Status Request |
 * | camt.053        | MT940         | Bank to Customer Statement |
 * | camt.054        | MT942         | Bank to Customer Debit/Credit Notification |
 * | camt.056        | MT192/MT292   | Payment Cancellation Request |
 *
 * ## Key ISO 20022 Identifiers
 * - **UTI** (Unique Transaction Identifier) — regulatory field in EndToEndId
 * - **LEI** (Legal Entity Identifier) — ISO 17442, 20 char alphanumeric
 * - **BIC** (Business Identifier Code) — ISO 9362, 8 or 11 characters
 */

import { XMLParser } from 'fast-xml-parser';

/**
 * All supported SWIFT message types.
 *
 * ── MX (ISO 20022 XML) ──────────────────────────────────────────────────────
 * These are XML-based messages following the ISO 20022 standard.
 * Format: `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:{msgtype}">` envelope.
 *
 * ── MT (Legacy SWIFT FIN) ───────────────────────────────────────────────────
 * These are text-based messages using colon-tagged fields (`:20:`, `:32B:`).
 * Still accepted during SWIFT's coexistence period (ends November 2028).
 */
export enum SWIFTMessageType {
  // ── Legacy MT (still supported during transition period) ───────────
  MT300 = 'MT300', // FX Confirmation → migrate to fxtr.008
  MT320 = 'MT320', // Money Market Confirmation
  MT360 = 'MT360', // Single Currency IRS
  MT361 = 'MT361', // Cross Currency IRS
  MT530 = 'MT530', // Transaction Processing Request
  MT548 = 'MT548', // Settlement Status & Advice
  MT940 = 'MT940', // Customer Statement → migrate to camt.053
  MT950 = 'MT950', // Statement Message

  // ── ISO 20022 — FX Trade Messages (fxtr) ───────────────────────────
  FXTR008 = 'fxtr.008', // FX Spot/Forward/Swap Trade Confirmation
  FXTR014 = 'fxtr.014', // FX Trade Status Advice

  // ── ISO 20022 — Payments Clearing & Settlement (pacs) ─────────────
  PACS002 = 'pacs.002', // Payment Status Report
  PACS008 = 'pacs.008', // Customer Credit Transfer Initiation
  PACS009 = 'pacs.009', // FI Credit Transfer (interbank FX settlement)
  PACS028 = 'pacs.028', // FI Payment Status Request

  // ── ISO 20022 — Cash Management (camt) ────────────────────────────
  CAMT053 = 'camt.053', // Bank to Customer Statement (Nostro recon)
  CAMT054 = 'camt.054', // Bank to Customer Debit/Credit Notification
  CAMT056 = 'camt.056', // FI to FI Payment Cancellation Request
}

/** Extracted fields common to all message types */
export interface ParsedMessageFields {
  /** Message reference / End-to-End ID — maps to Trade.reference or UTI */
  messageRef: string | null;
  /** Trade reference extracted from content (legacy :20: or EndToEndId) */
  tradeReference: string | null;
  /** Unique Transaction Identifier (regulatory, EMIR/Dodd-Frank) */
  uti: string | null;
  /** Sender Legal Entity Identifier (ISO 17442) */
  senderLEI: string | null;
  /** Receiver Legal Entity Identifier */
  receiverLEI: string | null;
  /** Sender BIC (BICFI in ISO 20022) */
  senderBIC: string | null;
  /** Receiver BIC */
  receiverBIC: string | null;
  /** Settlement amount */
  notionalAmount: number | null;
  /** Settlement currency (ISO 4217) */
  currency: string | null;
  /** Exchange rate (FX messages) */
  exchangeRate: number | null;
  /** Trade date (YYYY-MM-DD) */
  tradeDate: string | null;
  /** Value / settlement date (YYYY-MM-DD) */
  valueDate: string | null;
  /** Instrument / product type */
  productType: string | null;
  /** Raw parsed object for advanced consumers */
  raw: Record<string, unknown>;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: true,
  trimValues: true,
});

/** ISO 20022 message parser — extracts normalised fields from XML envelope */
export class ISO20022Parser {
  /**
   * Parse any supported ISO 20022 XML message and extract treasury fields.
   * Handles the AppHdr (BAH) envelope wrapping (MX format).
   */
  static parse(xmlContent: string, messageType: SWIFTMessageType): ParsedMessageFields {
    try {
      const parsed = xmlParser.parse(xmlContent) as Record<string, unknown>;

      switch (messageType) {
        case SWIFTMessageType.FXTR008:
        case SWIFTMessageType.FXTR014:
          return ISO20022Parser.parseFxtr(parsed);
        case SWIFTMessageType.PACS009:
          return ISO20022Parser.parsePacs009(parsed);
        case SWIFTMessageType.PACS008:
          return ISO20022Parser.parsePacs008(parsed);
        case SWIFTMessageType.PACS002:
          return ISO20022Parser.parsePacs002(parsed);
        case SWIFTMessageType.PACS028:
          return ISO20022Parser.parsePacs028(parsed);
        case SWIFTMessageType.CAMT053:
          return ISO20022Parser.parseCamt053(parsed);
        case SWIFTMessageType.CAMT054:
          return ISO20022Parser.parseCamt054(parsed);
        case SWIFTMessageType.CAMT056:
          return ISO20022Parser.parseCamt056(parsed);
        default:
          return ISO20022Parser.empty(parsed);
      }
    } catch {
      return ISO20022Parser.empty({});
    }
  }

  /** Parse legacy MT FIN (Message Type) format using colon-tagged field extraction. Not MX. */
  static parseMT(finContent: string, messageType: SWIFTMessageType): ParsedMessageFields {
    const field = (tag: string): string | null => {
      // MT FIN format: :TAG:VALUE or :TAG:SUBFIELD1SUBFIELD2
      const match = finContent.match(
        new RegExp(`:${tag}:([^\r\n:]+(?:\r?\n(?!:)[^\r\n:]+)*)`, 's'),
      );
      return match ? match[1].trim() : null;
    };

    const raw: Record<string, unknown> = {};

    if (messageType === SWIFTMessageType.MT300) {
      // MT300 FX Confirmation key fields:
      // :20: Reference
      // :22A: Type of Operation (NEWT/AMND/CANC)
      // :94A: Scope of Operation
      // :17T: Fund/Sales/Purchase
      // :82A: Party A
      // :87A: Party B
      // :30T: Trade Date
      // :30V: Value Date
      // :32B: Currency Bought Amount
      // :33B: Currency Sold Amount
      // :36: Exchange Rate
      const ref = field('20');
      const tradeDate = field('30T');
      const valueDate = field('30V');
      const ccy32 = field('32B');
      const rate = field('36');
      const party82 = field('82A');

      // :32B: = CCCAMOUNT (e.g. USD12500000,)
      const ccyMatch = ccy32?.match(/^([A-Z]{3})([\d,]+)/);
      const currency = ccyMatch ? ccyMatch[1] : null;
      const amount = ccyMatch ? parseFloat(ccyMatch[2].replace(',', '.')) : null;
      const exRate = rate ? parseFloat(rate.replace(',', '.')) : null;
      const bicMatch = party82?.match(/[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?/);
      const senderBIC = bicMatch ? bicMatch[0] : null;

      // Format trade date: YYMMDD → YYYY-MM-DD
      const fmtDate = (d: string | null) =>
        d ? `20${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 6)}` : null;

      return {
        messageRef: ref,
        tradeReference: ref,
        uti: null,
        senderLEI: null,
        receiverLEI: null,
        senderBIC,
        receiverBIC: null,
        notionalAmount: amount,
        currency,
        exchangeRate: exRate,
        tradeDate: fmtDate(tradeDate),
        valueDate: fmtDate(valueDate),
        productType: 'FX_SPOT',
        raw,
      };
    }

    // Generic MT fallback — extract :20: reference
    return {
      messageRef: field('20'),
      tradeReference: field('20'),
      uti: null,
      senderLEI: null,
      receiverLEI: null,
      senderBIC: null,
      receiverBIC: null,
      notionalAmount: null,
      currency: null,
      exchangeRate: null,
      tradeDate: null,
      valueDate: null,
      productType: null,
      raw,
    };
  }

  // ── fxtr.008 / fxtr.014 ──────────────────────────────────────────────────
  private static parseFxtr(doc: Record<string, unknown>): ParsedMessageFields {
    // Unwrap Document > FXTradInstr or FXTradStsAdvc envelope
    const root =
      (doc['Document'] as Record<string, unknown> | undefined) ??
      (doc['fxtr.008'] as Record<string, unknown> | undefined) ??
      doc;

    const msg =
      (root['FXTradInstr'] as Record<string, unknown> | undefined) ??
      (root['FXTradStsAdvc'] as Record<string, unknown> | undefined) ??
      {};

    const trdId = String(msg['TradId'] ?? '');
    const trdAmts = (msg['TradAmts'] as Record<string, unknown> | undefined) ?? {};
    const sttlmAmt = (trdAmts['SttlmAmt'] as Record<string, unknown> | undefined) ?? {};
    // fast-xml-parser encodes XML attributes with the configured prefix (@_)
    // Nested text content is accessible as #text when mixed with attributes
    const amtVal = sttlmAmt['Amt'] ?? sttlmAmt['#text'];
    const amount = parseFloat(String(amtVal ?? '0')) || null;
    const currency = String(sttlmAmt['@_Ccy'] ?? sttlmAmt['Ccy'] ?? '') || null;
    // XchgRate may be inside TradAmts or at the top level depending on schema version
    const xchgRateVal = trdAmts['XchgRate'] ?? msg['XchgRate'];
    const xchgRate = parseFloat(String(xchgRateVal ?? '0')) || null;
    const trdDt = String(msg['TradDt'] ?? '') || null;
    const sttlmDt = String(msg['SttlmDt'] ?? '') || null;

    const trdgSdId = (msg['TrdgSdId'] as Record<string, unknown> | undefined) ?? {};
    const idOrg = (trdgSdId['Id'] as Record<string, unknown> | undefined) ?? {};
    const lei = String(idOrg['LEI'] ?? '') || null;
    const bic = String(idOrg['BIC'] ?? '') || null;

    // UTI is carried in SttlmId or TradId for fxtr messages
    const uti = String((msg['SttlmId'] as string | undefined) ?? '') || trdId || null;

    return {
      messageRef: trdId || null,
      tradeReference: trdId || null,
      uti,
      senderLEI: lei,
      receiverLEI: null,
      senderBIC: bic,
      receiverBIC: null,
      notionalAmount: amount,
      currency,
      exchangeRate: xchgRate,
      tradeDate: trdDt,
      valueDate: sttlmDt,
      productType: 'FX',
      raw: doc,
    };
  }

  // ── pacs.009 (FI Credit Transfer — FX interbank settlement) ─────────────
  private static parsePacs009(doc: Record<string, unknown>): ParsedMessageFields {
    const grp = ISO20022Parser.dig(doc, 'Document.FICdtTrf.GrpHdr');
    const tx = ISO20022Parser.dig(doc, 'Document.FICdtTrf.CdtTrfTxInf');
    const txArr = Array.isArray(tx) ? tx[0] : (tx ?? {});

    const e2eId = String(ISO20022Parser.dig(txArr, 'PmtId.EndToEndId') ?? '');
    const instrId = String(ISO20022Parser.dig(txArr, 'PmtId.InstrId') ?? '');
    const msgId = String(ISO20022Parser.dig(grp, 'MsgId') ?? '');

    const amt = ISO20022Parser.dig(txArr, 'IntrBkSttlmAmt');
    const amtVal =
      typeof amt === 'object' && amt !== null
        ? parseFloat(
            String(
              (amt as Record<string, unknown>)['#text'] ??
                (amt as Record<string, unknown>)['Amt'] ??
                '0',
            ),
          )
        : parseFloat(String(amt ?? '0'));
    const ccy =
      typeof amt === 'object' && amt !== null
        ? String(
            (amt as Record<string, unknown>)['@_Ccy'] ??
              (amt as Record<string, unknown>)['Ccy'] ??
              '',
          )
        : null;

    const sttlmDt = String(ISO20022Parser.dig(txArr, 'IntrBkSttlmDt') ?? '') || null;
    const dbtrBIC = String(ISO20022Parser.dig(txArr, 'Dbtr.FinInstnId.BICFI') ?? '') || null;
    const cdtrBIC = String(ISO20022Parser.dig(txArr, 'Cdtr.FinInstnId.BICFI') ?? '') || null;
    const dbtrLEI = String(ISO20022Parser.dig(txArr, 'Dbtr.FinInstnId.LEI') ?? '') || null;
    const cdtrLEI = String(ISO20022Parser.dig(txArr, 'Cdtr.FinInstnId.LEI') ?? '') || null;

    return {
      messageRef: msgId || null,
      tradeReference: e2eId || instrId || null,
      uti: e2eId || null,
      senderLEI: dbtrLEI,
      receiverLEI: cdtrLEI,
      senderBIC: dbtrBIC,
      receiverBIC: cdtrBIC,
      notionalAmount: amtVal || null,
      currency: ccy || null,
      exchangeRate: null,
      tradeDate: null,
      valueDate: sttlmDt,
      productType: 'FX_SETTLEMENT',
      raw: doc,
    };
  }

  // ── pacs.008 (Customer Credit Transfer) ─────────────────────────────────
  private static parsePacs008(doc: Record<string, unknown>): ParsedMessageFields {
    const grp = ISO20022Parser.dig(doc, 'Document.FIToFICstmrCdtTrf.GrpHdr');
    const tx = ISO20022Parser.dig(doc, 'Document.FIToFICstmrCdtTrf.CdtTrfTxInf');
    const txArr = Array.isArray(tx) ? tx[0] : (tx ?? {});

    const e2eId = String(ISO20022Parser.dig(txArr, 'PmtId.EndToEndId') ?? '');
    const msgId = String(ISO20022Parser.dig(grp, 'MsgId') ?? '');
    const amt = ISO20022Parser.dig(txArr, 'IntrBkSttlmAmt');
    const amtVal =
      typeof amt === 'object' && amt !== null
        ? parseFloat(String((amt as Record<string, unknown>)['#text'] ?? '0'))
        : parseFloat(String(amt ?? '0'));
    const ccy =
      typeof amt === 'object' && amt !== null
        ? String((amt as Record<string, unknown>)['@_Ccy'] ?? '')
        : null;
    const sttlmDt = String(ISO20022Parser.dig(txArr, 'IntrBkSttlmDt') ?? '') || null;
    const dbtrBIC = String(ISO20022Parser.dig(txArr, 'DbtrAgt.FinInstnId.BICFI') ?? '') || null;
    const cdtrBIC = String(ISO20022Parser.dig(txArr, 'CdtrAgt.FinInstnId.BICFI') ?? '') || null;
    const dbtrLEI = String(ISO20022Parser.dig(txArr, 'Dbtr.Id.OrgId.LEI') ?? '') || null;

    return {
      messageRef: msgId || null,
      tradeReference: e2eId || null,
      uti: e2eId || null,
      senderLEI: dbtrLEI,
      receiverLEI: null,
      senderBIC: dbtrBIC,
      receiverBIC: cdtrBIC,
      notionalAmount: amtVal || null,
      currency: ccy || null,
      exchangeRate: null,
      tradeDate: null,
      valueDate: sttlmDt,
      productType: 'PAYMENT',
      raw: doc,
    };
  }

  // ── pacs.002 (Payment Status Report) ────────────────────────────────────
  private static parsePacs002(doc: Record<string, unknown>): ParsedMessageFields {
    const grp = ISO20022Parser.dig(doc, 'Document.FIToFIPmtStsRpt.GrpHdr');
    const info = ISO20022Parser.dig(doc, 'Document.FIToFIPmtStsRpt.TxInfAndSts');
    const infoA = Array.isArray(info) ? info[0] : (info ?? {});
    const msgId = String(ISO20022Parser.dig(grp, 'MsgId') ?? '');
    const origE2e = String(ISO20022Parser.dig(infoA, 'OrgnlEndToEndId') ?? '');

    return {
      messageRef: msgId || null,
      tradeReference: origE2e || null,
      uti: origE2e || null,
      senderLEI: null,
      receiverLEI: null,
      senderBIC: null,
      receiverBIC: null,
      notionalAmount: null,
      currency: null,
      exchangeRate: null,
      tradeDate: null,
      valueDate: null,
      productType: 'PAYMENT_STATUS',
      raw: doc,
    };
  }

  // ── pacs.028 (FI Payment Status Request) ────────────────────────────────
  private static parsePacs028(doc: Record<string, unknown>): ParsedMessageFields {
    const grp = ISO20022Parser.dig(doc, 'Document.FIToFIPmtStsReq.GrpHdr');
    const tx = ISO20022Parser.dig(doc, 'Document.FIToFIPmtStsReq.TxInf');
    const txA = Array.isArray(tx) ? tx[0] : (tx ?? {});
    const msgId = String(ISO20022Parser.dig(grp, 'MsgId') ?? '');
    const origE2e = String(ISO20022Parser.dig(txA, 'OrgnlEndToEndId') ?? '');

    return {
      messageRef: msgId || null,
      tradeReference: origE2e || null,
      uti: origE2e || null,
      senderLEI: null,
      receiverLEI: null,
      senderBIC: null,
      receiverBIC: null,
      notionalAmount: null,
      currency: null,
      exchangeRate: null,
      tradeDate: null,
      valueDate: null,
      productType: 'STATUS_REQUEST',
      raw: doc,
    };
  }

  // ── camt.053 (Bank Statement — Nostro reconciliation) ───────────────────
  private static parseCamt053(doc: Record<string, unknown>): ParsedMessageFields {
    const stmt = ISO20022Parser.dig(doc, 'Document.BkToCstmrStmt.Stmt');
    const stmtA = Array.isArray(stmt) ? stmt[0] : (stmt ?? {});
    const msgId = String(ISO20022Parser.dig(doc, 'Document.BkToCstmrStmt.GrpHdr.MsgId') ?? '');
    const acct =
      String(ISO20022Parser.dig(stmtA, 'Acct.Id.IBAN') ?? '') ||
      String(ISO20022Parser.dig(stmtA, 'Acct.Id.Othr.Id') ?? '') ||
      null;

    return {
      messageRef: msgId || null,
      tradeReference: acct,
      uti: null,
      senderLEI: null,
      receiverLEI: null,
      senderBIC: null,
      receiverBIC: null,
      notionalAmount: null,
      currency: null,
      exchangeRate: null,
      tradeDate: null,
      valueDate: String(ISO20022Parser.dig(stmtA, 'FrToDt.ToDtTm') ?? '') || null,
      productType: 'STATEMENT',
      raw: doc,
    };
  }

  // ── camt.054 (Debit/Credit Notification) ────────────────────────────────
  private static parseCamt054(doc: Record<string, unknown>): ParsedMessageFields {
    const ntfctn = ISO20022Parser.dig(doc, 'Document.BkToCstmrDbtCdtNtfctn.Ntfctn');
    const ntfA = Array.isArray(ntfctn) ? ntfctn[0] : (ntfctn ?? {});
    const msgId = String(
      ISO20022Parser.dig(doc, 'Document.BkToCstmrDbtCdtNtfctn.GrpHdr.MsgId') ?? '',
    );
    const e2eId = String(ISO20022Parser.dig(ntfA, 'Ntry.NtryDtls.TxDtls.Refs.EndToEndId') ?? '');

    return {
      messageRef: msgId || null,
      tradeReference: e2eId || null,
      uti: e2eId || null,
      senderLEI: null,
      receiverLEI: null,
      senderBIC: null,
      receiverBIC: null,
      notionalAmount: parseFloat(String(ISO20022Parser.dig(ntfA, 'Ntry.Amt') ?? '0')) || null,
      currency: String(ISO20022Parser.dig(ntfA, 'Ntry.@_Ccy') ?? '') || null,
      exchangeRate: null,
      tradeDate: null,
      valueDate: String(ISO20022Parser.dig(ntfA, 'Ntry.ValDt.Dt') ?? '') || null,
      productType: 'NOTIFICATION',
      raw: doc,
    };
  }

  // ── camt.056 (Payment Cancellation Request) ──────────────────────────────
  private static parseCamt056(doc: Record<string, unknown>): ParsedMessageFields {
    const grp = ISO20022Parser.dig(doc, 'Document.FIToFIPmtCxlReq.Assgnmt');
    const txInfo = ISO20022Parser.dig(doc, 'Document.FIToFIPmtCxlReq.Undrlyg.TxInf');
    const txA = Array.isArray(txInfo) ? txInfo[0] : (txInfo ?? {});
    const msgId = String(ISO20022Parser.dig(grp, 'Id') ?? '');
    const origE2e = String(ISO20022Parser.dig(txA, 'OrgnlEndToEndId') ?? '');

    return {
      messageRef: msgId || null,
      tradeReference: origE2e || null,
      uti: origE2e || null,
      senderLEI: null,
      receiverLEI: null,
      senderBIC: null,
      receiverBIC: null,
      notionalAmount: null,
      currency: null,
      exchangeRate: null,
      tradeDate: null,
      valueDate: null,
      productType: 'CANCELLATION_REQUEST',
      raw: doc,
    };
  }

  private static empty(raw: Record<string, unknown>): ParsedMessageFields {
    return {
      messageRef: null,
      tradeReference: null,
      uti: null,
      senderLEI: null,
      receiverLEI: null,
      senderBIC: null,
      receiverBIC: null,
      notionalAmount: null,
      currency: null,
      exchangeRate: null,
      tradeDate: null,
      valueDate: null,
      productType: null,
      raw,
    };
  }

  /** Safe deep path accessor: dig(obj, 'a.b.c') */
  static dig(obj: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((curr, key) => {
      if (curr === null || curr === undefined) return undefined;
      return (curr as Record<string, unknown>)[key];
    }, obj);
  }
}
