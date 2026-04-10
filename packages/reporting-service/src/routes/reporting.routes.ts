/**
 * @file reporting.routes.ts — HTTP routes for reporting-service (Sprint 12 fix)
 * Exposes COREP, FINREP, RAROC, AI assistant, Report Builder, and submission endpoints.
 */
import type { FastifyInstance } from 'fastify';
import { COREPEngine } from '../application/corep-engine.js';
import { FINREPEngine } from '../application/finrep-engine.js';
import { RAROCEngine } from '../application/raroc-engine.js';
import { ReportBuilder } from '../application/report-builder.js';
import { RegulatorySubmissionEngine } from '../application/regulatory-submission.js';
import { TreasuryAIAssistant } from '../application/treasury-ai-assistant.js';

const corep  = new COREPEngine();
const finrep = new FINREPEngine();
const raroc  = new RAROCEngine();
const reports = new ReportBuilder();
const submissions = new RegulatorySubmissionEngine();
const ai = new TreasuryAIAssistant();

export async function reportingRoutes(app: FastifyInstance): Promise<void> {

  /** POST /api/v1/reporting/corep */
  app.post('/api/v1/reporting/corep', async (req, reply) => {
    try {
      const body = req.body as Parameters<COREPEngine['generate']>[0];
      return reply.send(corep.generate(body));
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'COREP generation failed' });
    }
  });

  /** POST /api/v1/reporting/finrep */
  app.post('/api/v1/reporting/finrep', async (req, reply) => {
    try {
      const { balanceSheet, pl } = req.body as {
        balanceSheet: Parameters<FINREPEngine['generateReport']>[0];
        pl: Parameters<FINREPEngine['generateReport']>[1];
      };
      return reply.send(finrep.generateReport(balanceSheet, pl));
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'FINREP generation failed' });
    }
  });

  /** POST /api/v1/raroc/report */
  app.post('/api/v1/raroc/report', async (req, reply) => {
    try {
      const { inputs } = req.body as { inputs: Parameters<RAROCEngine['generateReport']>[0] };
      return reply.send(raroc.generateReport(inputs));
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'RAROC failed' });
    }
  });

  /** POST /api/v1/reports — Define a report */
  app.post('/api/v1/reports', async (req, reply) => {
    try {
      const body = req.body as Parameters<ReportBuilder['define']>[0];
      return reply.code(201).send(reports.define(body));
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'Report definition failed' });
    }
  });

  /** GET /api/v1/reports — List reports by tenant */
  app.get('/api/v1/reports', async (req, reply) => {
    const { tenantId } = req.query as { tenantId?: string };
    if (!tenantId) return reply.code(400).send({ error: 'tenantId required' });
    return reply.send(reports.listReports(tenantId));
  });

  /** POST /api/v1/reports/:reportId/run — Manual run */
  app.post('/api/v1/reports/:reportId/run', async (req, reply) => {
    try {
      const { reportId } = req.params as { reportId: string };
      return reply.send(reports.run(reportId, 'MANUAL'));
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : 'Run failed' });
    }
  });

  /** POST /api/v1/ai/ask — AI treasury assistant */
  app.post('/api/v1/ai/ask', async (req, reply) => {
    try {
      const body = req.body as Parameters<TreasuryAIAssistant['ask']>[0];
      const result = await ai.ask(body);
      return reply.send(result);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'AI assistant error' });
    }
  });

  /** POST /api/v1/submissions — Submit regulatory report */
  app.post('/api/v1/submissions', async (req, reply) => {
    try {
      const body = req.body as Parameters<RegulatorySubmissionEngine['submit']>[0];
      return reply.code(201).send(submissions.submit(body));
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'Submission failed' });
    }
  });

  /** POST /api/v1/submissions/:id/acknowledge */
  app.post('/api/v1/submissions/:id/acknowledge', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      return reply.send(submissions.acknowledge(id));
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : 'Not found' });
    }
  });

  /** GET /health */
  app.get('/health', async (_req, reply) =>
    reply.send({ service: 'reporting-service', status: 'ok', ts: new Date().toISOString() })
  );
}
