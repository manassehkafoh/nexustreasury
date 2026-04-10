import { randomUUID } from 'crypto';
/**
 * @module SSEStreamPublisher
 * @description Real-Time Dashboard Streaming via Server-Sent Events — Sprint 11.3.
 *
 * Upgrades from polling to push-based SSE for the React live blotter.
 * Pipeline: Kafka topic → SSEStreamPublisher → SSE endpoint → React client.
 *
 * Events streamed:
 *  - position.mtm.updated   — Position MTM revaluation (every 500ms)
 *  - limit.utilisation.tick — Real-time limit headroom gauge
 *  - rate.feed.tick         — Live FX/rate feed from Bloomberg B-PIPE
 *  - lcr.intraday.updated   — Intraday LCR update
 *
 * @see Sprint 11.3
 */

export const StreamEventType = {
  POSITION_MTM:      'position.mtm.updated',
  LIMIT_UTILISATION: 'limit.utilisation.tick',
  RATE_FEED:         'rate.feed.tick',
  LCR_INTRADAY:      'lcr.intraday.updated',
  HEARTBEAT:         'heartbeat',
} as const;
export type StreamEventType = (typeof StreamEventType)[keyof typeof StreamEventType];

export interface StreamEvent {
  readonly id:        string;
  readonly type:      StreamEventType;
  readonly tenantId:  string;
  readonly data:      Record<string, unknown>;
  readonly timestamp: string;
}

export interface StreamSubscription {
  readonly subscriptionId: string;
  readonly tenantId:       string;
  readonly userId:         string;
  readonly eventTypes:     StreamEventType[];
  readonly connectedAt:    string;
  isActive:                boolean;
}

/** SSE format: https://html.spec.whatwg.org/multipage/server-sent-events.html */
function formatSSEEvent(event: StreamEvent): string {
  return [
    `id: ${event.id}`,
    `event: ${event.type}`,
    `data: ${JSON.stringify(event.data)}`,
    '',  // blank line terminates SSE event
    '',
  ].join('\n');
}




export class SSEStreamPublisher {
  private readonly _subscriptions = new Map<string, StreamSubscription>();
  private readonly _eventLog:       StreamEvent[] = [];
  private readonly _maxLogSize      = 1000;

  /** Register a new SSE client connection. */
  subscribe(params: {
    tenantId:    string;
    userId:      string;
    eventTypes?: StreamEventType[];
  }): StreamSubscription {
    const sub: StreamSubscription = {
      subscriptionId: `SSE-${randomUUID().split('-')[0].toUpperCase()}`,
      tenantId:       params.tenantId,
      userId:         params.userId,
      eventTypes:     params.eventTypes ?? Object.values(StreamEventType),
      connectedAt:    new Date().toISOString(),
      isActive:       true,
    };
    this._subscriptions.set(sub.subscriptionId, sub);
    return sub;
  }

  /** Disconnect an SSE client. */
  unsubscribe(subscriptionId: string): void {
    const sub = this._subscriptions.get(subscriptionId);
    if (sub) sub.isActive = false;
  }

  /** Publish an event to all matching subscriptions. Returns SSE-formatted strings. */
  publish(event: Omit<StreamEvent, 'id'>): { subscriptionId: string; ssePayload: string }[] {
    const id        = `EVT-${randomUUID().split('-')[0].toUpperCase()}`;
    const fullEvent = { ...event, id };

    // Append to log
    this._eventLog.push(fullEvent);
    if (this._eventLog.length > this._maxLogSize) this._eventLog.shift();

    // Fan-out to matching subscriptions
    const deliveries: { subscriptionId: string; ssePayload: string }[] = [];
    this._subscriptions.forEach(sub => {
      if (!sub.isActive) return;
      if (sub.tenantId !== event.tenantId) return;     // tenant isolation
      if (!sub.eventTypes.includes(event.type)) return;
      deliveries.push({ subscriptionId: sub.subscriptionId, ssePayload: formatSSEEvent(fullEvent) });
    });

    return deliveries;
  }

  /** Emit a heartbeat to keep connections alive (every 30s). */
  heartbeat(tenantId: string): StreamEvent {
    const event: Omit<StreamEvent, 'id'> = {
      type: StreamEventType.HEARTBEAT, tenantId,
      data: { ts: Date.now(), activeSubscriptions: this.activeCount(tenantId) },
      timestamp: new Date().toISOString(),
    };
    this.publish(event);
    return { ...event, id: `HB-${Date.now()}` };
  }

  activeCount(tenantId?: string): number {
    return Array.from(this._subscriptions.values())
      .filter(s => s.isActive && (!tenantId || s.tenantId === tenantId)).length;
  }

  getEventLog(tenantId: string, limit = 50): StreamEvent[] {
    return this._eventLog
      .filter(e => e.tenantId === tenantId)
      .slice(-limit);
  }
}
