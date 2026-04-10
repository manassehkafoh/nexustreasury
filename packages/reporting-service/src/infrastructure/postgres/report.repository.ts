/**
 * @module ReportPostgresRepository
 * @description PostgreSQL persistence for ReportDefinition + SubmissionRecord.
 *
 * DDL:
 * ```sql
 * CREATE TABLE nexus_report_definitions (
 *   report_id    TEXT PRIMARY KEY,
 *   tenant_id    TEXT NOT NULL,
 *   template     TEXT NOT NULL,
 *   payload      JSONB NOT NULL,
 *   created_at   TIMESTAMPTZ DEFAULT NOW()
 * );
 * CREATE TABLE nexus_report_runs (
 *   run_id       TEXT PRIMARY KEY,
 *   report_id    TEXT NOT NULL REFERENCES nexus_report_definitions(report_id),
 *   tenant_id    TEXT NOT NULL,
 *   status       TEXT NOT NULL,
 *   payload      JSONB NOT NULL,
 *   started_at   TIMESTAMPTZ DEFAULT NOW()
 * );
 * CREATE TABLE nexus_regulatory_submissions (
 *   submission_id TEXT PRIMARY KEY,
 *   tenant_id     TEXT NOT NULL,
 *   regulator     TEXT NOT NULL,
 *   period        TEXT NOT NULL,
 *   status        TEXT NOT NULL,
 *   payload       JSONB NOT NULL,
 *   submitted_at  TIMESTAMPTZ DEFAULT NOW()
 * );
 * ```
 * @see Sprint 12 — Critical Fix 2
 */

import type { ReportDefinition, ReportRun } from '../../application/report-builder.js';
import type { SubmissionRecord, RegulatorCode } from '../../application/regulatory-submission.js';

// ── Report Definition Repository ─────────────────────────────────────────────

export interface ReportDefinitionRepository {
  save(report: ReportDefinition): Promise<void>;
  findById(id: string): Promise<ReportDefinition | null>;
  findByTenant(tenantId: string): Promise<ReportDefinition[]>;
  delete(id: string): Promise<void>;
}

export class InMemoryReportDefinitionRepository implements ReportDefinitionRepository {
  private readonly _store = new Map<string, ReportDefinition>();
  async save(r: ReportDefinition)             { this._store.set(r.id, r); }
  async findById(id: string)                  { return this._store.get(id) ?? null; }
  async findByTenant(tenantId: string)        { return [...this._store.values()].filter(r => r.tenantId === tenantId); }
  async delete(id: string)                    { this._store.delete(id); }
}

export class PostgresReportDefinitionRepository implements ReportDefinitionRepository {
  constructor(private readonly _pool: {
    query(sql: string, p?: unknown[]): Promise<{ rows: Record<string,unknown>[] }>;
  }) {}

  async save(r: ReportDefinition): Promise<void> {
    await this._pool.query(
      `INSERT INTO nexus_report_definitions (report_id, tenant_id, template, payload)
       VALUES ($1,$2,$3,$4::jsonb)
       ON CONFLICT (report_id) DO UPDATE SET payload=EXCLUDED.payload`,
      [r.id, r.tenantId, r.template, JSON.stringify(r)]
    );
  }
  async findById(id: string): Promise<ReportDefinition | null> {
    const { rows } = await this._pool.query(
      'SELECT payload FROM nexus_report_definitions WHERE report_id=$1', [id]
    );
    return rows.length ? rows[0]['payload'] as ReportDefinition : null;
  }
  async findByTenant(tenantId: string): Promise<ReportDefinition[]> {
    const { rows } = await this._pool.query(
      'SELECT payload FROM nexus_report_definitions WHERE tenant_id=$1 ORDER BY created_at DESC', [tenantId]
    );
    return rows.map(r => r['payload'] as ReportDefinition);
  }
  async delete(id: string): Promise<void> {
    await this._pool.query('DELETE FROM nexus_report_definitions WHERE report_id=$1', [id]);
  }
}

// ── Report Run Repository ─────────────────────────────────────────────────────

export interface ReportRunRepository {
  save(run: ReportRun): Promise<void>;
  findByReportId(reportId: string): Promise<ReportRun[]>;
}

export class InMemoryReportRunRepository implements ReportRunRepository {
  private readonly _store = new Map<string, ReportRun[]>();
  async save(run: ReportRun) {
    const existing = this._store.get(run.reportId) ?? [];
    this._store.set(run.reportId, [...existing, run]);
  }
  async findByReportId(reportId: string) { return this._store.get(reportId) ?? []; }
}

export class PostgresReportRunRepository implements ReportRunRepository {
  constructor(private readonly _pool: {
    query(sql: string, p?: unknown[]): Promise<{ rows: Record<string,unknown>[] }>;
  }) {}
  async save(run: ReportRun): Promise<void> {
    await this._pool.query(
      `INSERT INTO nexus_report_runs (run_id, report_id, tenant_id, status, payload)
       VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT DO NOTHING`,
      [run.runId, run.reportId, run.tenantId, run.status, JSON.stringify(run)]
    );
  }
  async findByReportId(reportId: string): Promise<ReportRun[]> {
    const { rows } = await this._pool.query(
      'SELECT payload FROM nexus_report_runs WHERE report_id=$1 ORDER BY started_at DESC', [reportId]
    );
    return rows.map(r => r['payload'] as ReportRun);
  }
}

// ── Regulatory Submission Repository ─────────────────────────────────────────

export interface SubmissionRepository {
  save(s: SubmissionRecord): Promise<void>;
  findById(id: string): Promise<SubmissionRecord | null>;
  update(s: SubmissionRecord): Promise<void>;
  findByRegulator(regulator: RegulatorCode): Promise<SubmissionRecord[]>;
}

export class InMemorySubmissionRepository implements SubmissionRepository {
  private readonly _store = new Map<string, SubmissionRecord>();
  async save(s: SubmissionRecord)               { this._store.set(s.id, s); }
  async findById(id: string)                    { return this._store.get(id) ?? null; }
  async update(s: SubmissionRecord)             {
    if (!this._store.has(s.id)) throw new Error(`Submission ${s.id} not found`);
    this._store.set(s.id, s);
  }
  async findByRegulator(regulator: RegulatorCode) {
    return [...this._store.values()].filter(s => s.regulator === regulator);
  }
}

export class PostgresSubmissionRepository implements SubmissionRepository {
  constructor(private readonly _pool: {
    query(sql: string, p?: unknown[]): Promise<{ rows: Record<string,unknown>[] }>;
  }) {}
  async save(s: SubmissionRecord): Promise<void> {
    await this._pool.query(
      `INSERT INTO nexus_regulatory_submissions
         (submission_id, tenant_id, regulator, period, status, payload)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [s.id, s.tenantId, s.regulator, s.reportingPeriod, s.status, JSON.stringify(s)]
    );
  }
  async findById(id: string): Promise<SubmissionRecord | null> {
    const { rows } = await this._pool.query(
      'SELECT payload FROM nexus_regulatory_submissions WHERE submission_id=$1', [id]
    );
    return rows.length ? rows[0]['payload'] as SubmissionRecord : null;
  }
  async update(s: SubmissionRecord): Promise<void> {
    const { rows } = await this._pool.query(
      'UPDATE nexus_regulatory_submissions SET payload=$1::jsonb, status=$2 WHERE submission_id=$3 RETURNING submission_id',
      [JSON.stringify(s), s.status, s.id]
    );
    if (!rows.length) throw new Error(`Submission ${s.id} not found`);
  }
  async findByRegulator(regulator: RegulatorCode): Promise<SubmissionRecord[]> {
    const { rows } = await this._pool.query(
      'SELECT payload FROM nexus_regulatory_submissions WHERE regulator=$1 ORDER BY submitted_at DESC',
      [regulator]
    );
    return rows.map(r => r['payload'] as SubmissionRecord);
  }
}
