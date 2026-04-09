/**
 * @module audit-service/domain/audit-record
 *
 * Immutable Audit Record — the core value object of the Audit bounded context.
 *
 * Every state-changing event across NexusTreasury produces an audit record.
 * Records are:
 *  - Tamper-evident: HMAC-SHA256 checksum over (eventId + tenantId + payload)
 *  - Immutable once written: no UPDATE or DELETE permitted on the audit store
 *  - Searchable: indexed by entityId, tenantId, userId, eventType, timestamp
 *  - Retained for 10 years (regulatory requirement — NFR-022)
 *
 * SOC 2 Type II mapping:
 *  - CC6.1: Logical access changes logged
 *  - CC7.2: System monitoring — all events captured
 *  - CC7.4: Incident response — full event trail for forensics
 *  - CC9.2: Change management — trade amendments logged with before/after
 *
 * AI/ML hook: AnomalyScorer — real-time anomaly detection on audit stream.
 * Detects unusual access patterns (off-hours large trades, unusual IP),
 * privilege escalations, or data exfiltration attempts.
 *
 * @see PRD REQ-P-003 — Tamper-evident audit logs
 * @see NFR-010 — SOC 2 Type II certification
 */
import { createHmac } from 'crypto';

// ── Enums ─────────────────────────────────────────────────────────────────────

/** Top-level audit category for fast filtering */
export enum AuditCategory {
  TRADE = 'TRADE',
  POSITION = 'POSITION',
  RISK = 'RISK',
  ACCOUNTING = 'ACCOUNTING',
  SETTLEMENT = 'SETTLEMENT',
  SECURITY = 'SECURITY', // login, logout, permission changes
  PLATFORM = 'PLATFORM', // config changes, deployments
  MARKET_DATA = 'MARKET_DATA',
  ALM = 'ALM',
  COMPLIANCE = 'COMPLIANCE',
}

/** Severity level for the audit event */
export enum AuditSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL',
}

// ── Domain Types ──────────────────────────────────────────────────────────────

export interface AuditActorContext {
  /** Authenticated user ID (or 'SYSTEM' for automated events) */
  userId: string;
  username: string;
  roles: string[];
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
}

export interface AuditRecord {
  readonly auditId: string; // UUID
  readonly tenantId: string;
  readonly eventId: string; // source Kafka event ID
  readonly eventType: string; // e.g. 'nexus.trading.trade.booked'
  readonly category: AuditCategory;
  readonly severity: AuditSeverity;
  readonly entityId: string; // e.g. trade ID, position ID
  readonly entityType: string; // e.g. 'Trade', 'Position', 'Limit'
  readonly actor: AuditActorContext;
  readonly occurredAt: Date;
  readonly recordedAt: Date; // when written to audit store
  /** Structured payload snapshot (before/after for mutations) */
  readonly payload: Record<string, unknown>;
  /** HMAC-SHA256 over canonical string — tamper evidence */
  readonly checksum: string;
  /** AI/ML anomaly score (0–1). Populated asynchronously if scorer configured */
  readonly anomalyScore?: number;
  readonly anomalyFlags?: string[];
}

// ── AI/ML Hook ────────────────────────────────────────────────────────────────

/**
 * Real-time anomaly scorer — detects unusual activity patterns.
 * Returns a score 0–1 where > 0.8 triggers a CRITICAL security alert.
 *
 * Example signals: off-hours access, unusually large trades, IP geo anomaly,
 * rapid role escalation, bulk data export outside business hours.
 */
export interface AnomalyScorer {
  score(record: Omit<AuditRecord, 'anomalyScore' | 'anomalyFlags' | 'checksum'>): Promise<{
    score: number;
    flags: string[];
  }>;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export interface CreateAuditRecordInput {
  tenantId: string;
  eventId: string;
  eventType: string;
  category: AuditCategory;
  severity: AuditSeverity;
  entityId: string;
  entityType: string;
  actor: AuditActorContext;
  occurredAt: Date;
  payload: Record<string, unknown>;
}

/**
 * Factory function — creates an immutable, HMAC-signed audit record.
 *
 * The HMAC key should be loaded from HashiCorp Vault in production.
 * In development, a fallback key is used (never use in production).
 */
export function createAuditRecord(
  input: CreateAuditRecordInput,
  hmacKey: string = process.env['AUDIT_HMAC_KEY'] ?? 'nexus-audit-dev-CHANGE-IN-PRODUCTION',
): AuditRecord {
  const { randomUUID } = require('crypto') as typeof import('crypto');
  const auditId = randomUUID();
  const recordedAt = new Date();

  // Canonical string for HMAC: deterministic ordering prevents canonicalization attacks
  const canonical = [
    auditId,
    input.tenantId,
    input.eventId,
    input.eventType,
    input.entityId,
    input.actor.userId,
    input.occurredAt.toISOString(),
    JSON.stringify(input.payload, Object.keys(input.payload).sort()),
  ].join('|');

  const checksum = createHmac('sha256', hmacKey).update(canonical).digest('hex');

  return {
    auditId,
    tenantId: input.tenantId,
    eventId: input.eventId,
    eventType: input.eventType,
    category: input.category,
    severity: input.severity,
    entityId: input.entityId,
    entityType: input.entityType,
    actor: input.actor,
    occurredAt: input.occurredAt,
    recordedAt,
    payload: input.payload,
    checksum,
  };
}

/**
 * Verify the HMAC checksum of an audit record.
 * Returns false if the record has been tampered with.
 */
export function verifyAuditRecord(record: AuditRecord, hmacKey: string): boolean {
  const canonical = [
    record.auditId,
    record.tenantId,
    record.eventId,
    record.eventType,
    record.entityId,
    record.actor.userId,
    record.occurredAt.toISOString(),
    JSON.stringify(record.payload, Object.keys(record.payload).sort()),
  ].join('|');

  const expected = createHmac('sha256', hmacKey).update(canonical).digest('hex');
  return expected === record.checksum;
}

// ── Repository Interface ──────────────────────────────────────────────────────

export interface AuditRepository {
  append(record: AuditRecord): Promise<void>;
  search(params: {
    tenantId: string;
    entityId?: string;
    entityType?: string;
    category?: AuditCategory;
    severity?: AuditSeverity;
    userId?: string;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  }): Promise<{ records: AuditRecord[]; total: number }>;
  verify(auditId: string, hmacKey: string): Promise<boolean>;
}
