/**
 * @module SWIFTMatcher
 *
 * SWIFT Message Auto-Matching Engine — ISO 20022 compliant.
 *
 * SWIFT completed its ISO 20022 cross-border payment migration in November 2025.
 * NexusTreasury supports both SWIFT MX (ISO 20022 XML) and legacy MT (FIN) formats.
 * MX = ISO 20022 XML envelope. MT = legacy colon-tagged FIN text messages.
 *
 * ## Matching Algorithm
 * Weighted field scoring (total 100 points):
 * - Trade reference / EndToEndId / UTI match: 40 pts
 * - Counterparty BIC / LEI match:             20 pts
 * - Value / settlement date match:            15 pts
 * - Notional amount match (±0.01% tolerance): 15 pts
 * - Exchange rate match (±0.005% tolerance):  10 pts
 *
 * Score ≥ 80 → MATCHED (auto-confirmed, no human review needed)
 * Score 50–79 → PENDING (requires back-office review)
 * Score < 50 → UNMATCHED (exception raised)
 *
 * STP target: ≥ 95% auto-matched within 15 minutes of receipt.
 *
 * ## Regulatory Identifiers
 * - **UTI** (Unique Transaction Identifier) — carried in EndToEndId for EMIR/Dodd-Frank
 * - **LEI** (Legal Entity Identifier, ISO 17442) — 20-char code for legal entities
 * - **BIC** (Business Identifier Code, ISO 9362) — 8 or 11 character bank identifier
 */

import { ISO20022Parser, SWIFTMessageType, type ParsedMessageFields } from './iso20022-parser.js';

export { SWIFTMessageType };

export enum MatchStatus {
  MATCHED = 'MATCHED',
  UNMATCHED = 'UNMATCHED',
  EXCEPTION = 'EXCEPTION',
  PENDING = 'PENDING',
}

export interface SWIFTMessage {
  messageId: string;
  messageType: SWIFTMessageType;
  senderBIC: string;
  receiverBIC: string;
  content: string;
  receivedAt: Date;
}

export interface MatchResult {
  messageId: string;
  tradeRef: string | null;
  uti: string | null;
  senderLEI: string | null;
  receiverLEI: string | null;
  status: MatchStatus;
  matchScore: number;
  matchedFields: string[];
  exceptions: string[];
  parsedFields: ParsedMessageFields;
  matchedAt: Date;
}

/** Percentage tolerance for numeric field comparison */
const AMOUNT_TOLERANCE = 0.0001; // 0.01%
const RATE_TOLERANCE = 0.00005; // 0.005%

export class SWIFTMatcher {
  /**
   * Parse and match a SWIFT message (ISO 20022 MX or legacy MT FIN format)
   * against the provided trade reference.
   *
   * @param message   - Incoming SWIFT message (content is XML for ISO 20022, FIN for MT)
   * @param tradeRef  - Expected trade reference from the trade repository
   * @param tradeData - Optional trade fields for detailed field-level matching
   */
  async match(
    message: SWIFTMessage,
    tradeRef: string | null,
    tradeData?: {
      notionalAmount?: number;
      currency?: string;
      exchangeRate?: number;
      valueDate?: string;
      counterpartyBIC?: string;
      counterpartyLEI?: string;
    },
  ): Promise<MatchResult> {
    // ── Step 1: Parse the message content ────────────────────────────────────
    const parsed = SWIFTMatcher.parseMessage(message);

    // ── Step 2: Handle no-match case ─────────────────────────────────────────
    if (!tradeRef && !parsed.tradeReference) {
      return {
        messageId: message.messageId,
        tradeRef: null,
        uti: null,
        senderLEI: null,
        receiverLEI: null,
        status: MatchStatus.UNMATCHED,
        matchScore: 0,
        matchedFields: [],
        exceptions: ['No matching trade reference found'],
        parsedFields: parsed,
        matchedAt: new Date(),
      };
    }

    const matched: string[] = [];
    const exceptions: string[] = [];
    let score = 0;

    // ── Step 3: Reference / UTI matching (40 pts) ────────────────────────────
    const effectiveRef = parsed.tradeReference ?? parsed.uti ?? parsed.messageRef;
    if (effectiveRef && tradeRef) {
      if (
        effectiveRef === tradeRef ||
        effectiveRef.includes(tradeRef) ||
        tradeRef.includes(effectiveRef)
      ) {
        matched.push('tradeReference');
        score += 40;
      } else {
        exceptions.push(`Reference mismatch: expected ${tradeRef}, got ${effectiveRef}`);
      }
    } else if (effectiveRef || tradeRef) {
      // Partial — one side has it, other doesn't
      score += 10;
      matched.push('partialReference');
    }

    // ── Step 4: Counterparty BIC / LEI matching (20 pts) ────────────────────
    const msgBIC = parsed.senderBIC ?? parsed.receiverBIC;
    const msgLEI = parsed.senderLEI ?? parsed.receiverLEI;

    if (tradeData?.counterpartyLEI && msgLEI && msgLEI === tradeData.counterpartyLEI) {
      matched.push('counterpartyLEI');
      score += 20; // LEI is more reliable than BIC (unique, non-reusable)
    } else if (tradeData?.counterpartyBIC && msgBIC) {
      // BIC matching: compare first 8 chars (institution code, ignoring branch)
      if (msgBIC.slice(0, 8) === tradeData.counterpartyBIC.slice(0, 8)) {
        matched.push('counterpartyBIC');
        score += 20;
      } else {
        exceptions.push(`BIC mismatch: expected ${tradeData.counterpartyBIC}, got ${msgBIC}`);
      }
    } else if (
      message.senderBIC &&
      parsed.senderBIC &&
      message.senderBIC.slice(0, 8) === parsed.senderBIC.slice(0, 8)
    ) {
      // Fallback: compare envelope BIC with parsed BIC
      matched.push('envelopeBIC');
      score += 15;
    }

    // ── Step 5: Value date matching (15 pts) ─────────────────────────────────
    if (tradeData?.valueDate && parsed.valueDate) {
      // Normalise both to YYYY-MM-DD
      const d1 = tradeData.valueDate.slice(0, 10);
      const d2 = parsed.valueDate.slice(0, 10);
      if (d1 === d2) {
        matched.push('valueDate');
        score += 15;
      } else {
        exceptions.push(`Value date mismatch: expected ${d1}, got ${d2}`);
      }
    }

    // ── Step 6: Notional amount matching (15 pts) ────────────────────────────
    if (tradeData?.notionalAmount !== undefined && parsed.notionalAmount !== null) {
      const diff = Math.abs(parsed.notionalAmount - tradeData.notionalAmount);
      const pct = tradeData.notionalAmount > 0 ? diff / tradeData.notionalAmount : diff;
      if (pct <= AMOUNT_TOLERANCE) {
        matched.push('notionalAmount');
        score += 15;
      } else {
        exceptions.push(
          `Amount mismatch: expected ${tradeData.notionalAmount}, got ${parsed.notionalAmount}` +
            ` (${(pct * 100).toFixed(4)}% diff)`,
        );
      }
    }

    // ── Step 7: Exchange rate matching (10 pts, FX only) ────────────────────
    if (tradeData?.exchangeRate !== undefined && parsed.exchangeRate !== null) {
      const diff = Math.abs(parsed.exchangeRate - tradeData.exchangeRate);
      const pct = tradeData.exchangeRate > 0 ? diff / tradeData.exchangeRate : diff;
      if (pct <= RATE_TOLERANCE) {
        matched.push('exchangeRate');
        score += 10;
      } else {
        exceptions.push(
          `Rate mismatch: expected ${tradeData.exchangeRate}, got ${parsed.exchangeRate}`,
        );
      }
    }

    // ── Step 8: Determine status ─────────────────────────────────────────────
    const status: MatchStatus =
      score >= 80
        ? MatchStatus.MATCHED
        : exceptions.length > 0
          ? MatchStatus.EXCEPTION
          : MatchStatus.PENDING;

    return {
      messageId: message.messageId,
      tradeRef: parsed.tradeReference ?? tradeRef,
      uti: parsed.uti,
      senderLEI: parsed.senderLEI,
      receiverLEI: parsed.receiverLEI,
      status,
      matchScore: Math.min(score, 100),
      matchedFields: matched,
      exceptions,
      parsedFields: parsed,
      matchedAt: new Date(),
    };
  }

  /**
   * Auto-detect message format:
   * - MX (ISO 20022): content starts with `<` — parse as XML
   * - MT (legacy FIN): colon-tagged text format — use MT field parser
   * Note: MX ≠ MT. These are completely different wire formats.
   */
  private static parseMessage(message: SWIFTMessage): ParsedMessageFields {
    const isXML = message.content.trimStart().startsWith('<');

    if (isXML) {
      return ISO20022Parser.parse(message.content, message.messageType);
    }
    // Legacy MT FIN format
    return ISO20022Parser.parseMT(message.content, message.messageType);
  }

  /**
   * Validate that a string is a well-formed LEI (ISO 17442).
   * Format: 20 alphanumeric characters, last 2 are check digits.
   */
  static isValidLEI(lei: string): boolean {
    return /^[A-Z0-9]{18}[0-9]{2}$/.test(lei);
  }

  /**
   * Validate a BIC (ISO 9362) — 8 or 11 alphanumeric characters.
   * Format: BBBBCCLLBBB (Bank + Country + Location + Branch)
   */
  static isValidBIC(bic: string): boolean {
    return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic);
  }
}
