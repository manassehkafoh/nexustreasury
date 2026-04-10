import { describe, it, expect, beforeEach } from 'vitest';
import { SSEStreamPublisher, StreamEventType } from './sse-stream-publisher.js';

describe('SSEStreamPublisher — Sprint 11.3', () => {
  let pub: SSEStreamPublisher;
  beforeEach(() => { pub = new SSEStreamPublisher(); });

  it('subscribe returns a subscription with active=true', () => {
    const s = pub.subscribe({ tenantId:'bank-001', userId:'user-01' });
    expect(s.isActive).toBe(true);
    expect(s.subscriptionId).toContain('SSE-');
  });

  it('subscribes to all event types by default', () => {
    const s = pub.subscribe({ tenantId:'bank-001', userId:'user-01' });
    expect(s.eventTypes).toContain(StreamEventType.POSITION_MTM);
    expect(s.eventTypes).toContain(StreamEventType.RATE_FEED);
  });

  it('publish delivers to matching tenant subscriptions', () => {
    pub.subscribe({ tenantId:'bank-001', userId:'user-01' });
    const deliveries = pub.publish({
      type: StreamEventType.POSITION_MTM, tenantId:'bank-001',
      data:{ pair:'EUR/USD', mtm:54_200_000 }, timestamp: new Date().toISOString(),
    });
    expect(deliveries).toHaveLength(1);
  });

  it('publish isolates by tenant (no cross-tenant delivery)', () => {
    pub.subscribe({ tenantId:'bank-001', userId:'user-01' });
    pub.subscribe({ tenantId:'bank-002', userId:'user-02' });
    const deliveries = pub.publish({
      type:StreamEventType.LCR_INTRADAY, tenantId:'bank-001',
      data:{ lcrRatio:142.5 }, timestamp: new Date().toISOString(),
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].ssePayload).toContain('lcr.intraday.updated');
  });

  it('SSE payload contains event, id, and data fields', () => {
    pub.subscribe({ tenantId:'bank-001', userId:'u1' });
    const [d] = pub.publish({
      type:StreamEventType.RATE_FEED, tenantId:'bank-001',
      data:{ pair:'EUR/USD', mid:1.0842 }, timestamp: new Date().toISOString(),
    });
    expect(d.ssePayload).toContain('event:');
    expect(d.ssePayload).toContain('data:');
    expect(d.ssePayload).toContain('id:');
  });

  it('unsubscribe stops delivery', () => {
    const s = pub.subscribe({ tenantId:'bank-001', userId:'u1' });
    pub.unsubscribe(s.subscriptionId);
    const deliveries = pub.publish({
      type:StreamEventType.HEARTBEAT, tenantId:'bank-001',
      data:{}, timestamp: new Date().toISOString(),
    });
    expect(deliveries).toHaveLength(0);
  });

  it('activeCount returns correct count', () => {
    pub.subscribe({ tenantId:'bank-001', userId:'u1' });
    pub.subscribe({ tenantId:'bank-001', userId:'u2' });
    expect(pub.activeCount('bank-001')).toBe(2);
  });

  it('heartbeat publishes to active subscriptions', () => {
    pub.subscribe({ tenantId:'bank-001', userId:'u1' });
    const hb = pub.heartbeat('bank-001');
    expect(hb.type).toBe(StreamEventType.HEARTBEAT);
  });

  it('event log is populated after publish', () => {
    pub.subscribe({ tenantId:'bank-001', userId:'u1' });
    pub.publish({ type:StreamEventType.RATE_FEED, tenantId:'bank-001', data:{}, timestamp:new Date().toISOString() });
    expect(pub.getEventLog('bank-001').length).toBeGreaterThan(0);
  });

  it('filtered subscriptions only receive requested event types', () => {
    pub.subscribe({ tenantId:'bank-001', userId:'u1', eventTypes:[StreamEventType.RATE_FEED] });
    const lcr = pub.publish({ type:StreamEventType.LCR_INTRADAY, tenantId:'bank-001', data:{}, timestamp:new Date().toISOString() });
    const rate = pub.publish({ type:StreamEventType.RATE_FEED,    tenantId:'bank-001', data:{}, timestamp:new Date().toISOString() });
    expect(lcr).toHaveLength(0);
    expect(rate).toHaveLength(1);
  });
});
