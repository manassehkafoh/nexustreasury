/**
 * @module BudgetPostgresRepository
 * @description PostgreSQL persistence for BudgetPlan — replaces in-memory Map.
 *
 * DDL (run once via migration):
 * ```sql
 * CREATE TABLE nexus_budget_plans (
 *   budget_id    TEXT PRIMARY KEY,
 *   tenant_id    TEXT NOT NULL,
 *   fiscal_year  INTEGER NOT NULL,
 *   scenario     TEXT NOT NULL,
 *   status       TEXT NOT NULL DEFAULT 'DRAFT',
 *   payload      JSONB NOT NULL,
 *   created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *   updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
 * );
 * CREATE INDEX idx_budget_plans_tenant ON nexus_budget_plans(tenant_id, fiscal_year);
 * ```
 *
 * @see Sprint 12 — Critical Fix 2: in-memory → PostgreSQL
 */

import type { BudgetPlan } from '../../application/budget-engine.js';

export interface BudgetRepository {
  save(plan: BudgetPlan): Promise<void>;
  findById(budgetId: string): Promise<BudgetPlan | null>;
  findByTenant(tenantId: string, fiscalYear?: number): Promise<BudgetPlan[]>;
  update(plan: BudgetPlan): Promise<void>;
  delete(budgetId: string): Promise<void>;
}

/** In-process implementation used in tests and local dev without a DB. */
export class InMemoryBudgetRepository implements BudgetRepository {
  private readonly _store = new Map<string, BudgetPlan>();

  async save(plan: BudgetPlan): Promise<void> {
    this._store.set(plan.budgetId, plan);
  }
  async findById(budgetId: string): Promise<BudgetPlan | null> {
    return this._store.get(budgetId) ?? null;
  }
  async findByTenant(tenantId: string, fiscalYear?: number): Promise<BudgetPlan[]> {
    return Array.from(this._store.values()).filter(
      (p) => p.tenantId === tenantId && (!fiscalYear || p.fiscalYear === fiscalYear),
    );
  }
  async update(plan: BudgetPlan): Promise<void> {
    if (!this._store.has(plan.budgetId)) throw new Error(`Budget ${plan.budgetId} not found`);
    this._store.set(plan.budgetId, plan);
  }
  async delete(budgetId: string): Promise<void> {
    this._store.delete(budgetId);
  }
}

/**
 * PostgreSQL implementation using node-postgres (pg).
 * Instantiate with a Pool from the service container.
 *
 * @example
 * ```typescript
 * import { Pool } from 'pg';
 * const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 * const repo = new PostgresBudgetRepository(pool);
 * container.register('BudgetRepository', repo);
 * ```
 */
export class PostgresBudgetRepository implements BudgetRepository {
  constructor(
    private readonly _pool: {
      query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
    },
  ) {}

  async save(plan: BudgetPlan): Promise<void> {
    await this._pool.query(
      `INSERT INTO nexus_budget_plans
         (budget_id, tenant_id, fiscal_year, scenario, status, payload)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (budget_id) DO UPDATE
         SET payload = EXCLUDED.payload, status = EXCLUDED.status,
             updated_at = NOW()`,
      [
        plan.budgetId,
        plan.tenantId,
        plan.fiscalYear,
        plan.scenario,
        plan.status,
        JSON.stringify(plan),
      ],
    );
  }

  async findById(budgetId: string): Promise<BudgetPlan | null> {
    const { rows } = await this._pool.query(
      'SELECT payload FROM nexus_budget_plans WHERE budget_id = $1',
      [budgetId],
    );
    return rows.length ? (rows[0]['payload'] as BudgetPlan) : null;
  }

  async findByTenant(tenantId: string, fiscalYear?: number): Promise<BudgetPlan[]> {
    const sql = fiscalYear
      ? 'SELECT payload FROM nexus_budget_plans WHERE tenant_id=$1 AND fiscal_year=$2 ORDER BY created_at DESC'
      : 'SELECT payload FROM nexus_budget_plans WHERE tenant_id=$1 ORDER BY created_at DESC';
    const params = fiscalYear ? [tenantId, fiscalYear] : [tenantId];
    const { rows } = await this._pool.query(sql, params);
    return rows.map((r) => r['payload'] as BudgetPlan);
  }

  async update(plan: BudgetPlan): Promise<void> {
    const { rows } = await this._pool.query(
      'UPDATE nexus_budget_plans SET payload=$1::jsonb, status=$2, updated_at=NOW() WHERE budget_id=$3 RETURNING budget_id',
      [JSON.stringify(plan), plan.status, plan.budgetId],
    );
    if (!rows.length) throw new Error(`Budget ${plan.budgetId} not found`);
  }

  async delete(budgetId: string): Promise<void> {
    await this._pool.query('DELETE FROM nexus_budget_plans WHERE budget_id=$1', [budgetId]);
  }
}
