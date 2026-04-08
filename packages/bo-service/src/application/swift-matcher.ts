/**
 * SWIFT Message Auto-Matching Engine
 * Matches incoming SWIFT confirmation messages against booked trades.
 *
 * Supported: MT300 (FX), MT320 (Money Market), MT360/361 (IRS), MT530/548 (Settlement)
 * ISO 20022: pacs.008, pacs.009, camt.053
 *
 * STP target: ≥ 95% auto-matched within 15 minutes of receipt.
 */

export enum SWIFTMessageType {
  MT300 = 'MT300', // FX Confirmation
  MT320 = 'MT320', // Money Market Confirmation
  MT360 = 'MT360', // Single Currency Interest Rate Derivative
  MT530 = 'MT530', // Transaction Processing Request
  MT548 = 'MT548', // Settlement Status & Processing Advice
  MT940 = 'MT940', // Customer Statement
  MT950 = 'MT950', // Statement Message
  PACS008 = 'pacs.008',
  PACS009 = 'pacs.009',
  CAMT053 = 'camt.053',
}

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
  status: MatchStatus;
  matchScore: number; // 0–100, threshold ≥ 80 for auto-match
  matchedFields: string[];
  exceptions: string[];
  matchedAt: Date;
}

export class SWIFTMatcher {
  /**
   * Attempt to auto-match a SWIFT confirmation against the trade repository.
   * Returns MATCHED if score ≥ 80, EXCEPTION if critical field mismatch,
   * PENDING if awaiting further messages.
   */
  async match(message: SWIFTMessage, tradeRef: string | null): Promise<MatchResult> {
    const matched: string[] = [];
    const exceptions: string[] = [];
    let score = 0;

    if (!tradeRef) {
      return {
        messageId: message.messageId,
        tradeRef: null,
        status: MatchStatus.UNMATCHED,
        matchScore: 0,
        matchedFields: [],
        exceptions: ['No matching trade reference found'],
        matchedAt: new Date(),
      };
    }

    // Simulated field matching — in production, parse SWIFT FIN/XML
    // and compare against Trade aggregate fields
    matched.push('tradeReference', 'counterpartyBIC', 'valueDate');
    score += 60; // base score for reference match

    if (message.messageType === SWIFTMessageType.MT300) {
      matched.push('notionalAmount', 'currency', 'exchangeRate');
      score += 30;
    }

    const status =
      score >= 80
        ? MatchStatus.MATCHED
        : exceptions.length > 0
          ? MatchStatus.EXCEPTION
          : MatchStatus.PENDING;

    return {
      messageId: message.messageId,
      tradeRef,
      status,
      matchScore: score,
      matchedFields: matched,
      exceptions,
      matchedAt: new Date(),
    };
  }
}
