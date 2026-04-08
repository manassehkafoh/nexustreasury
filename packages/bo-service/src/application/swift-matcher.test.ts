import { describe, it, expect } from 'vitest';
import { SWIFTMatcher, SWIFTMessageType, MatchStatus } from './swift-matcher.js';

const matcher = new SWIFTMatcher();

function makeMessage(type = SWIFTMessageType.MT300): Parameters<typeof matcher.match>[0] {
  return {
    messageId: 'MSG-' + Math.random().toString(36).slice(2),
    messageType: type,
    senderBIC: 'BARCLONDON',
    receiverBIC: 'NEXUSGB2L',
    content: ':20:TRDE-2026-001\n:32A:260409USD12500000\n:33B:EUR11535000',
    receivedAt: new Date(),
  };
}

describe('SWIFTMatcher', () => {
  it('returns UNMATCHED when no trade reference provided', async () => {
    const result = await matcher.match(makeMessage(), null);
    expect(result.status).toBe(MatchStatus.UNMATCHED);
    expect(result.matchScore).toBe(0);
    expect(result.exceptions.length).toBeGreaterThan(0);
  });

  it('returns MATCHED when MT300 matches trade reference', async () => {
    const result = await matcher.match(makeMessage(SWIFTMessageType.MT300), 'FX-20260407-A3B2');
    expect(result.status).toBe(MatchStatus.MATCHED);
    expect(result.matchScore).toBeGreaterThanOrEqual(80);
  });

  it('includes matched fields in result', async () => {
    const result = await matcher.match(makeMessage(SWIFTMessageType.MT300), 'FX-20260407-A3B2');
    expect(result.matchedFields.length).toBeGreaterThan(0);
    expect(result.matchedFields).toContain('tradeReference');
  });

  it('preserves messageId in result', async () => {
    const msg = makeMessage();
    const result = await matcher.match(msg, 'FX-20260407-XYZ');
    expect(result.messageId).toBe(msg.messageId);
  });

  it('populates matchedAt timestamp', async () => {
    const before = new Date();
    const result = await matcher.match(makeMessage(), null);
    expect(result.matchedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('handles MT320 message type', async () => {
    const result = await matcher.match(makeMessage(SWIFTMessageType.MT320), 'MM-20260407-A1B2');
    expect(result.status).not.toBe(MatchStatus.MATCHED); // MT320 doesn't have full field match
    expect(result.tradeRef).toBe('MM-20260407-A1B2');
  });
});
