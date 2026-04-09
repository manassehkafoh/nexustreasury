/**
 * @module notification-service/application/notification.service
 *
 * Notification Service — multi-channel alerting for NexusTreasury events.
 *
 * Subscribed Kafka topics → channels:
 *   nexus.risk.limit-breach          → Email + WebSocket + Webhook
 *   nexus.bo.reconciliation-break    → Email + WebSocket
 *   nexus.bo.settlement-instructions (FAILED status) → Email + Webhook
 *   nexus.security.login-failed      → Email (security team)
 *   nexus.security.anomaly-detected  → Email + Webhook (CRITICAL)
 *   nexus.alm.lcr-breach             → Email + WebSocket
 *
 * Channel implementations:
 *   Email   — SMTP / AWS SES adapter (configurable per tenant)
 *   WebSocket — push notification to connected dealer sessions
 *   Webhook — HTTP POST to configured URL (Slack, Teams, PagerDuty)
 *
 * AI/ML hook: MessagePersonaliser
 *   - Uses LLM to generate context-aware alert descriptions
 *   - Example: "USD/GBP position breach — $2.3M above limit set 2 days ago.
 *     Last 3 trades by Alex Dealer in this book totalled $8M. Review advised."
 *
 * @see PRD REQ-R-005 — Real-time limit breach alerts
 * @see BRD BR-RECON-004 — Automated nostro break alerts
 */

// ── Channel Interfaces ────────────────────────────────────────────────────────

export interface EmailChannel {
  send(params: {
    to: string[];
    subject: string;
    body: string;
    priority: 'normal' | 'high';
  }): Promise<void>;
}

export interface WebSocketChannel {
  push(params: {
    tenantId: string;
    rooms: string[]; // e.g. ['risk-managers', 'desk:fx']
    event: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
}

export interface WebhookChannel {
  post(params: {
    url: string;
    payload: Record<string, unknown>;
    secret?: string; // HMAC-SHA256 signature for Slack/Teams verification
  }): Promise<void>;
}

// ── AI/ML Personaliser Hook ────────────────────────────────────────────────────

/**
 * Optional LLM hook for context-aware notification text.
 * Falls back to template-based messages if not configured.
 */
export interface MessagePersonaliser {
  personalise(params: {
    eventType: string;
    severity: string;
    entityId: string;
    entityType: string;
    payload: Record<string, unknown>;
  }): Promise<{ subject: string; body: string }>;
}

// ── Alert Rule ────────────────────────────────────────────────────────────────

export interface AlertRule {
  eventPattern: string; // topic prefix match, e.g. 'nexus.risk.limit-breach'
  channels: ('EMAIL' | 'WEBSOCKET' | 'WEBHOOK')[];
  emailRecipients?: string[];
  wsRooms?: string[];
  webhookUrl?: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
}

// ── Notification Event (consumed from Kafka) ──────────────────────────────────

export interface NotificationEvent {
  topic: string;
  tenantId: string;
  eventId: string;
  eventType: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  entityId: string;
  entityType: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
}

// ── Default Rules ────────────────────────────────────────────────────────────

const DEFAULT_RULES: AlertRule[] = [
  {
    eventPattern: 'nexus.risk.limit-breach',
    channels: ['EMAIL', 'WEBSOCKET', 'WEBHOOK'],
    emailRecipients: ['risk-manager@bank.com', 'head-treasury@bank.com'],
    wsRooms: ['risk-managers', 'all-dealers'],
    severity: 'CRITICAL',
  },
  {
    eventPattern: 'nexus.bo.reconciliation-break',
    channels: ['EMAIL', 'WEBSOCKET'],
    emailRecipients: ['bo-supervisor@bank.com'],
    wsRooms: ['back-office'],
    severity: 'WARNING',
  },
  {
    eventPattern: 'nexus.alm.lcr-breach',
    channels: ['EMAIL', 'WEBSOCKET'],
    emailRecipients: ['alm-manager@bank.com', 'cfo@bank.com'],
    wsRooms: ['alm-dashboard'],
    severity: 'CRITICAL',
  },
  {
    eventPattern: 'nexus.security.login-failed',
    channels: ['EMAIL'],
    emailRecipients: ['security@bank.com'],
    severity: 'CRITICAL',
  },
  {
    eventPattern: 'nexus.security.anomaly-detected',
    channels: ['EMAIL', 'WEBHOOK'],
    emailRecipients: ['ciso@bank.com', 'security@bank.com'],
    severity: 'CRITICAL',
  },
];

// ── Notification Result (for testing + observability) ─────────────────────────

export interface NotificationResult {
  eventId: string;
  channelsSent: string[];
  channelsFailed: string[];
  messageSubject: string;
  messageBody: string;
  sentAt: Date;
}

// ── Notification Service ──────────────────────────────────────────────────────

export class NotificationService {
  private readonly rules: AlertRule[];

  constructor(
    private readonly emailChannel?: EmailChannel,
    private readonly wsChannel?: WebSocketChannel,
    private readonly webhookChannel?: WebhookChannel,
    private readonly personaliser?: MessagePersonaliser,
    rules?: AlertRule[],
  ) {
    this.rules = rules ?? DEFAULT_RULES;
  }

  /**
   * Process a notification event — match rules and dispatch to all channels.
   */
  async notify(event: NotificationEvent): Promise<NotificationResult> {
    const matchingRules = this.rules.filter((r) => event.topic.startsWith(r.eventPattern));
    if (matchingRules.length === 0) {
      return {
        eventId: event.eventId,
        channelsSent: [],
        channelsFailed: [],
        messageSubject: '',
        messageBody: '',
        sentAt: new Date(),
      };
    }

    // Build message (AI/ML personaliser or template fallback)
    const { subject, body } = await this.buildMessage(event);

    const channelsSent: string[] = [];
    const channelsFailed: string[] = [];

    for (const rule of matchingRules) {
      for (const channel of rule.channels) {
        try {
          await this.dispatch(channel, rule, event, subject, body);
          if (!channelsSent.includes(channel)) channelsSent.push(channel);
        } catch (err) {
          const label = `${channel}:${(err as Error).message}`;
          if (!channelsFailed.includes(label)) channelsFailed.push(label);
        }
      }
    }

    return {
      eventId: event.eventId,
      channelsSent,
      channelsFailed,
      messageSubject: subject,
      messageBody: body,
      sentAt: new Date(),
    };
  }

  // ── Message Building ──────────────────────────────────────────────────────

  private async buildMessage(event: NotificationEvent): Promise<{ subject: string; body: string }> {
    if (this.personaliser) {
      try {
        return await this.personaliser.personalise({
          eventType: event.eventType,
          severity: event.severity,
          entityId: event.entityId,
          entityType: event.entityType,
          payload: event.payload,
        });
      } catch {
        /* fall through to template */
      }
    }
    return this.templateMessage(event);
  }

  private templateMessage(event: NotificationEvent): { subject: string; body: string } {
    const icon = event.severity === 'CRITICAL' ? '🚨' : event.severity === 'WARNING' ? '⚠️' : 'ℹ️';
    const subject = `${icon} [NexusTreasury] ${event.severity} — ${event.eventType}`;
    const body = [
      `NexusTreasury Alert`,
      ``,
      `Severity:   ${event.severity}`,
      `Event:      ${event.eventType}`,
      `Entity:     ${event.entityType} / ${event.entityId}`,
      `Tenant:     ${event.tenantId}`,
      `Occurred:   ${event.occurredAt.toISOString()}`,
      ``,
      `Details:`,
      JSON.stringify(event.payload, null, 2),
    ].join('\n');
    return { subject, body };
  }

  // ── Channel Dispatch ──────────────────────────────────────────────────────

  private async dispatch(
    channel: string,
    rule: AlertRule,
    event: NotificationEvent,
    subject: string,
    body: string,
  ): Promise<void> {
    switch (channel) {
      case 'EMAIL':
        if (!this.emailChannel) throw new Error('EMAIL channel not configured');
        await this.emailChannel.send({
          to: rule.emailRecipients ?? [],
          subject,
          body,
          priority: event.severity === 'CRITICAL' ? 'high' : 'normal',
        });
        break;

      case 'WEBSOCKET':
        if (!this.wsChannel) throw new Error('WEBSOCKET channel not configured');
        await this.wsChannel.push({
          tenantId: event.tenantId,
          rooms: rule.wsRooms ?? ['all'],
          event: event.eventType,
          payload: {
            subject,
            severity: event.severity,
            entityId: event.entityId,
            occurredAt: event.occurredAt,
          },
        });
        break;

      case 'WEBHOOK':
        if (!this.webhookChannel || !rule.webhookUrl)
          throw new Error('WEBHOOK channel/URL not configured');
        await this.webhookChannel.post({
          url: rule.webhookUrl,
          payload: {
            text: `${subject}\n\n${body}`,
            severity: event.severity,
            entityId: event.entityId,
          },
        });
        break;
    }
  }
}
