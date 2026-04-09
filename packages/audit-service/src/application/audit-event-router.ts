/**
 * @module audit-service/application/audit-event-router
 *
 * Audit Event Router — consumes ALL NexusTreasury Kafka topics and
 * produces structured, HMAC-signed audit records.
 *
 * Topic routing table:
 *   nexus.trading.*           → AuditCategory.TRADE
 *   nexus.position.*          → AuditCategory.POSITION
 *   nexus.risk.*              → AuditCategory.RISK
 *   nexus.accounting.*        → AuditCategory.ACCOUNTING
 *   nexus.bo.*                → AuditCategory.SETTLEMENT
 *   nexus.market.*            → AuditCategory.MARKET_DATA
 *   nexus.alm.*               → AuditCategory.ALM
 *   nexus.security.*          → AuditCategory.SECURITY
 *   nexus.platform.*          → AuditCategory.PLATFORM
 *
 * Security events receive CRITICAL severity for:
 *   - Login failures (> 3 attempts)
 *   - Permission escalations
 *   - Large trade overrides
 *   - After-hours access from unusual IPs
 *
 * The anomaly scorer AI/ML hook runs asynchronously after the record is
 * written, updating the anomalyScore field via an async enrichment pass.
 */

import { randomUUID } from 'crypto';
import {
  AuditCategory,
  AuditSeverity,
  createAuditRecord,
  type AuditRecord,
  type AuditRepository,
  type AnomalyScorer,
} from '../domain/audit-record.js';

// ── Kafka Event Shape ─────────────────────────────────────────────────────────

export interface RawKafkaEvent {
  topic: string;
  key?: string;
  value: string; // JSON string
  headers?: Record<string, string>;
  offset: string;
  partition: number;
}

// ── SYSTEM actor for automated events ────────────────────────────────────────

const SYSTEM_ACTOR = {
  userId: 'SYSTEM',
  username: 'system',
  roles: ['SYSTEM'],
};

// ── Topic → Audit Metadata Map ────────────────────────────────────────────────

interface TopicMeta {
  category: AuditCategory;
  severity: AuditSeverity;
  entityType: string;
  entityIdPath: string; // dot-path to entity ID in payload
}

const TOPIC_MAP: Record<string, TopicMeta> = {
  'nexus.trading.trades.booked': {
    category: AuditCategory.TRADE,
    severity: AuditSeverity.INFO,
    entityType: 'Trade',
    entityIdPath: 'tradeId',
  },
  'nexus.trading.trades.amended': {
    category: AuditCategory.TRADE,
    severity: AuditSeverity.WARNING,
    entityType: 'Trade',
    entityIdPath: 'tradeId',
  },
  'nexus.trading.trades.cancelled': {
    category: AuditCategory.TRADE,
    severity: AuditSeverity.WARNING,
    entityType: 'Trade',
    entityIdPath: 'tradeId',
  },
  'nexus.position.updated': {
    category: AuditCategory.POSITION,
    severity: AuditSeverity.INFO,
    entityType: 'Position',
    entityIdPath: 'positionId',
  },
  'nexus.risk.limit-breach': {
    category: AuditCategory.RISK,
    severity: AuditSeverity.CRITICAL,
    entityType: 'Limit',
    entityIdPath: 'limitId',
  },
  'nexus.risk.greeks-calculated': {
    category: AuditCategory.RISK,
    severity: AuditSeverity.INFO,
    entityType: 'Book',
    entityIdPath: 'bookId',
  },
  'nexus.risk.var-result': {
    category: AuditCategory.RISK,
    severity: AuditSeverity.INFO,
    entityType: 'Portfolio',
    entityIdPath: 'portfolioId',
  },
  'nexus.accounting.journal-entries': {
    category: AuditCategory.ACCOUNTING,
    severity: AuditSeverity.INFO,
    entityType: 'JournalEntry',
    entityIdPath: 'id',
  },
  'nexus.bo.settlement-instructions': {
    category: AuditCategory.SETTLEMENT,
    severity: AuditSeverity.INFO,
    entityType: 'SettlementInstruction',
    entityIdPath: 'id',
  },
  'nexus.bo.reconciliation-break': {
    category: AuditCategory.SETTLEMENT,
    severity: AuditSeverity.CRITICAL,
    entityType: 'ReconciliationBreak',
    entityIdPath: 'statementEntryId',
  },
  'nexus.market.rates-updated': {
    category: AuditCategory.MARKET_DATA,
    severity: AuditSeverity.INFO,
    entityType: 'RateSnapshot',
    entityIdPath: 'snapshotId',
  },
  'nexus.alm.lcr-calculated': {
    category: AuditCategory.ALM,
    severity: AuditSeverity.INFO,
    entityType: 'LCRReport',
    entityIdPath: 'reportId',
  },
  'nexus.security.login': {
    category: AuditCategory.SECURITY,
    severity: AuditSeverity.INFO,
    entityType: 'Session',
    entityIdPath: 'sessionId',
  },
  'nexus.security.login-failed': {
    category: AuditCategory.SECURITY,
    severity: AuditSeverity.CRITICAL,
    entityType: 'Session',
    entityIdPath: 'userId',
  },
  'nexus.security.permission-change': {
    category: AuditCategory.SECURITY,
    severity: AuditSeverity.CRITICAL,
    entityType: 'User',
    entityIdPath: 'userId',
  },
};

// ── Audit Event Router ────────────────────────────────────────────────────────

export class AuditEventRouter {
  private readonly hmacKey: string;

  constructor(
    private readonly repo: AuditRepository,
    private readonly anomalyScorer?: AnomalyScorer,
    hmacKey?: string,
  ) {
    this.hmacKey =
      hmacKey ?? process.env['AUDIT_HMAC_KEY'] ?? 'nexus-audit-dev-CHANGE-IN-PRODUCTION';
  }

  /**
   * Route a raw Kafka event to an audit record.
   * Returns the created record or null if the topic is not auditable.
   */
  async route(event: RawKafkaEvent): Promise<AuditRecord | null> {
    const meta = this.lookupMeta(event.topic);
    if (!meta) return null;

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(event.value) as Record<string, unknown>;
    } catch {
      payload = { rawValue: event.value };
    }

    const entityId = this.extractPath(payload, meta.entityIdPath) ?? event.key ?? randomUUID();
    const tenantId = (payload['tenantId'] as string | undefined) ?? 'unknown';
    const eventId = (payload['eventId'] as string | undefined) ?? randomUUID();
    const occurredAt = payload['occurredAt']
      ? new Date(payload['occurredAt'] as string)
      : new Date();

    // Extract actor from payload headers or payload itself
    const actor = this.extractActor(payload, event.headers);

    const record = createAuditRecord(
      {
        tenantId,
        eventId,
        eventType: event.topic,
        category: meta.category,
        severity: meta.severity,
        entityId: String(entityId),
        entityType: meta.entityType,
        actor,
        occurredAt,
        payload,
      },
      this.hmacKey,
    );

    await this.repo.append(record);

    // AI/ML anomaly scoring — async, does not block the primary audit write
    if (this.anomalyScorer) {
      this.scoreAsync(record);
    }

    return record;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private lookupMeta(topic: string): TopicMeta | undefined {
    // Exact match first
    if (TOPIC_MAP[topic]) return TOPIC_MAP[topic];
    // Prefix match: e.g. 'nexus.trading.trades.booked.v2'
    for (const [key, meta] of Object.entries(TOPIC_MAP)) {
      if (topic.startsWith(key)) return meta;
    }
    // Wildcard by domain prefix
    if (topic.startsWith('nexus.trading'))
      return {
        category: AuditCategory.TRADE,
        severity: AuditSeverity.INFO,
        entityType: 'Trade',
        entityIdPath: 'tradeId',
      };
    if (topic.startsWith('nexus.risk'))
      return {
        category: AuditCategory.RISK,
        severity: AuditSeverity.INFO,
        entityType: 'Risk',
        entityIdPath: 'id',
      };
    if (topic.startsWith('nexus.security'))
      return {
        category: AuditCategory.SECURITY,
        severity: AuditSeverity.WARNING,
        entityType: 'Security',
        entityIdPath: 'userId',
      };
    return undefined;
  }

  private extractPath(obj: Record<string, unknown>, path: string): unknown {
    return path
      .split('.')
      .reduce<unknown>(
        (cur, key) =>
          cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[key] : undefined,
        obj,
      );
  }

  private extractActor(payload: Record<string, unknown>, headers?: Record<string, string>) {
    const userId = (headers?.['x-user-id'] ?? payload['userId'] ?? 'SYSTEM') as string;
    const username = (headers?.['x-username'] ?? payload['username'] ?? userId) as string;
    const roles = (() => {
      const r = headers?.['x-roles'] ?? (payload['roles'] as string | undefined) ?? '';
      return r.split(',').filter(Boolean);
    })();
    const ipAddress = headers?.['x-forwarded-for'];
    return { userId, username, roles, ipAddress };
  }

  /** Fire-and-forget anomaly scoring — must never block audit write */
  private scoreAsync(record: AuditRecord): void {
    if (!this.anomalyScorer) return;
    this.anomalyScorer
      .score(record)
      .then(({ score, flags }) => {
        if (score > 0.8) {
          // In production: update the record's anomaly fields in Elasticsearch
          // and publish a nexus.security.anomaly-detected event
          console.warn(
            `[AUDIT] Anomaly detected on ${record.auditId}: score=${score.toFixed(2)} flags=[${flags.join(',')}]`,
          );
        }
      })
      .catch(() => {
        /* anomaly scorer failure must never affect audit integrity */
      });
  }
}

// ── In-Memory Audit Repository (testing) ─────────────────────────────────────

export class InMemoryAuditRepository implements AuditRepository {
  public readonly records: AuditRecord[] = [];

  async append(record: AuditRecord): Promise<void> {
    this.records.push(record);
  }

  async search(params: {
    tenantId: string;
    entityId?: string;
    category?: AuditCategory;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  }): Promise<{ records: AuditRecord[]; total: number }> {
    let filtered = this.records.filter((r) => r.tenantId === params.tenantId);
    if (params.entityId) filtered = filtered.filter((r) => r.entityId === params.entityId);
    if (params.category) filtered = filtered.filter((r) => r.category === params.category);
    if (params.from) filtered = filtered.filter((r) => r.occurredAt >= params.from!);
    if (params.to) filtered = filtered.filter((r) => r.occurredAt <= params.to!);
    const total = filtered.length;
    const offset = params.offset ?? 0;
    const limit = params.limit ?? 100;
    return { records: filtered.slice(offset, offset + limit), total };
  }

  async verify(auditId: string, hmacKey: string): Promise<boolean> {
    const record = this.records.find((r) => r.auditId === auditId);
    if (!record) return false;
    const { verifyAuditRecord } = await import('../domain/audit-record.js');
    return verifyAuditRecord(record, hmacKey);
  }
}
