/**
 * NotificationService — TDD test suite
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  NotificationService,
  type NotificationEvent,
  type AlertRule,
} from './notification.service.js';

const baseEvent: NotificationEvent = {
  topic: 'nexus.risk.limit-breach',
  tenantId: 'tenant-001',
  eventId: 'evt-001',
  eventType: 'nexus.risk.limit-breach',
  severity: 'CRITICAL',
  entityId: 'limit-123',
  entityType: 'Limit',
  payload: { limitId: 'limit-123', utilisationPct: 105, counterpartyId: 'cp-001' },
  occurredAt: new Date('2026-04-09T10:00:00Z'),
};

// ── Channel Mocks ────────────────────────────────────────────────────────────

function mockEmail() {
  return { send: vi.fn().mockResolvedValue(undefined) };
}
function mockWs() {
  return { push: vi.fn().mockResolvedValue(undefined) };
}
function mockWebhook() {
  return { post: vi.fn().mockResolvedValue(undefined) };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('NotificationService — channel dispatch', () => {
  it('sends to EMAIL when email channel configured', async () => {
    const email = mockEmail();
    const svc = new NotificationService(email);
    const result = await svc.notify(baseEvent);
    expect(email.send).toHaveBeenCalledOnce();
    expect(result.channelsSent).toContain('EMAIL');
  });

  it('sends to WEBSOCKET when WS channel configured', async () => {
    const ws = mockWs();
    const svc = new NotificationService(undefined, ws);
    const result = await svc.notify(baseEvent);
    expect(ws.push).toHaveBeenCalledOnce();
    expect(result.channelsSent).toContain('WEBSOCKET');
  });

  it('sends to both EMAIL and WEBSOCKET when both configured', async () => {
    const email = mockEmail();
    const ws = mockWs();
    const svc = new NotificationService(email, ws);
    const result = await svc.notify(baseEvent);
    expect(result.channelsSent).toContain('EMAIL');
    expect(result.channelsSent).toContain('WEBSOCKET');
  });

  it('records failure when email channel throws', async () => {
    const email = { send: vi.fn().mockRejectedValue(new Error('SMTP timeout')) };
    const svc = new NotificationService(email);
    const result = await svc.notify(baseEvent);
    expect(result.channelsFailed.some((f) => f.includes('EMAIL'))).toBe(true);
  });
});

describe('NotificationService — rule matching', () => {
  it('matches by topic prefix', async () => {
    const email = mockEmail();
    const svc = new NotificationService(email);
    const result = await svc.notify({ ...baseEvent, topic: 'nexus.risk.limit-breach' });
    expect(result.channelsSent.length).toBeGreaterThan(0);
  });

  it('returns empty channelsSent for unknown topic', async () => {
    const email = mockEmail();
    const svc = new NotificationService(email);
    const result = await svc.notify({ ...baseEvent, topic: 'nexus.completely.unknown' });
    expect(result.channelsSent).toHaveLength(0);
    expect(email.send).not.toHaveBeenCalled();
  });

  it('uses custom rules when provided', async () => {
    const email = mockEmail();
    const customRules: AlertRule[] = [
      {
        eventPattern: 'nexus.custom.event',
        channels: ['EMAIL'],
        emailRecipients: ['a@b.com'],
        severity: 'INFO',
      },
    ];
    const svc = new NotificationService(email, undefined, undefined, undefined, customRules);
    const result = await svc.notify({
      ...baseEvent,
      topic: 'nexus.custom.event',
      eventType: 'nexus.custom.event',
    });
    expect(result.channelsSent).toContain('EMAIL');
    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ to: ['a@b.com'] }));
  });
});

describe('NotificationService — message template', () => {
  it('includes severity and eventType in subject', async () => {
    const email = mockEmail();
    const svc = new NotificationService(email);
    await svc.notify(baseEvent);
    const call = email.send.mock.calls[0]![0] as { subject: string };
    expect(call.subject).toContain('CRITICAL');
    expect(call.subject).toContain('nexus.risk.limit-breach');
  });

  it('uses high priority for CRITICAL events', async () => {
    const email = mockEmail();
    const svc = new NotificationService(email);
    await svc.notify(baseEvent);
    const call = email.send.mock.calls[0]![0] as { priority: string };
    expect(call.priority).toBe('high');
  });

  it('uses normal priority for INFO events', async () => {
    const email = mockEmail();
    const customRules: AlertRule[] = [
      {
        eventPattern: 'nexus.market.rates-updated',
        channels: ['EMAIL'],
        emailRecipients: ['a@b.com'],
        severity: 'INFO',
      },
    ];
    const svc = new NotificationService(email, undefined, undefined, undefined, customRules);
    await svc.notify({ ...baseEvent, topic: 'nexus.market.rates-updated', severity: 'INFO' });
    const call = email.send.mock.calls[0]![0] as { priority: string };
    expect(call.priority).toBe('normal');
  });
});

describe('NotificationService — AI/ML personaliser', () => {
  it('uses personaliser output when configured', async () => {
    const email = mockEmail();
    const personaliser = {
      personalise: vi.fn().mockResolvedValue({
        subject: 'AI-generated subject',
        body: 'AI-generated context-aware body',
      }),
    };
    const svc = new NotificationService(email, undefined, undefined, personaliser);
    const result = await svc.notify(baseEvent);
    expect(personaliser.personalise).toHaveBeenCalledOnce();
    expect(result.messageSubject).toBe('AI-generated subject');
  });

  it('falls back to template when personaliser throws', async () => {
    const email = mockEmail();
    const personaliser = { personalise: vi.fn().mockRejectedValue(new Error('LLM timeout')) };
    const svc = new NotificationService(email, undefined, undefined, personaliser);
    const result = await svc.notify(baseEvent);
    // Should not throw; falls back to template
    expect(result.channelsSent).toContain('EMAIL');
    expect(result.messageSubject).toContain('CRITICAL');
  });
});
