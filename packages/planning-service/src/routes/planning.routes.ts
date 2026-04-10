/**
 * @file planning.routes.ts — HTTP routes for planning-service (Sprint 12 fix)
 * Exposes BudgetEngine and RAROCEngine over REST.
 */
import type { FastifyInstance } from 'fastify';
import { BudgetEngine, BudgetScenario } from '../application/budget-engine.js';

const engine = new BudgetEngine();

export async function planningRoutes(app: FastifyInstance): Promise<void> {

  /** POST /api/v1/budgets — Create annual budget plan */
  app.post('/api/v1/budgets', async (req, reply) => {
    try {
      const body = req.body as Parameters<BudgetEngine['createBudget']>[0];
      const plan = engine.createBudget(body);
      return reply.code(201).send(plan);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Budget creation failed';
      return reply.code(400).send({ error: msg });
    }
  });

  /** GET /api/v1/budgets/:budgetId — Get budget plan */
  app.get('/api/v1/budgets/:budgetId', async (req, reply) => {
    const { budgetId } = req.params as { budgetId: string };
    // Find the plan across all tenants (in production scope by tenant from JWT)
    const tenantId = (req.headers['x-tenant-id'] as string) ?? 'default';
    const plans = engine.listPlans(tenantId);
    const plan = plans.find(p => p.budgetId === budgetId);
    if (!plan) return reply.code(404).send({ error: `Budget ${budgetId} not found` });
    return reply.send(plan);
  });

  /** GET /api/v1/budgets — List plans by tenant */
  app.get('/api/v1/budgets', async (req, reply) => {
    const { tenantId, fiscalYear } = req.query as { tenantId?: string; fiscalYear?: string };
    if (!tenantId) return reply.code(400).send({ error: 'tenantId query param required' });
    const fy = fiscalYear ? parseInt(fiscalYear, 10) : undefined;
    return reply.send(engine.listPlans(tenantId, fy));
  });

  /** POST /api/v1/budgets/:budgetId/approve — Approve budget */
  app.post('/api/v1/budgets/:budgetId/approve', async (req, reply) => {
    try {
      const { budgetId } = req.params as { budgetId: string };
      const { approvedBy } = req.body as { approvedBy: string };
      const plan = engine.approveBudget(budgetId, approvedBy);
      return reply.send(plan);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Approval failed';
      return reply.code(400).send({ error: msg });
    }
  });

  /** POST /api/v1/budgets/:budgetId/reforecast — Create RFC version */
  app.post('/api/v1/budgets/:budgetId/reforecast', async (req, reply) => {
    try {
      const { budgetId } = req.params as { budgetId: string };
      const { entries } = req.body as { entries: Parameters<BudgetEngine['createReforecast']>[1] };
      const rfc = engine.createReforecast(budgetId, entries);
      return reply.code(201).send(rfc);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Reforecast failed';
      return reply.code(400).send({ error: msg });
    }
  });

  /** GET /api/v1/budgets/:budgetId/report — Generate analytics report */
  app.get('/api/v1/budgets/:budgetId/report', async (req, reply) => {
    try {
      const { budgetId } = req.params as { budgetId: string };
      const report = engine.generateReport(budgetId);
      return reply.send(report);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Report generation failed';
      return reply.code(400).send({ error: msg });
    }
  });

  /** GET /health */
  app.get('/health', async (_req, reply) =>
    reply.send({ service: 'planning-service', status: 'ok', ts: new Date().toISOString() })
  );
}
