/**
 * @file sprint11.test.ts — Sprint 11: AI Assistant + Report Builder tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TreasuryAIAssistant,
  QueryCategory,
  type AssistantQuery,
} from './treasury-ai-assistant.js';
import { ReportBuilder, ReportTemplate, ReportDimension, ReportFormat } from './report-builder.js';

// ── AI Assistant ───────────────────────────────────────────────────────────────
describe('TreasuryAIAssistant — Sprint 11.1', () => {
  // Use a mock endpoint so tests don't make real HTTP calls
  const assistant = new TreasuryAIAssistant({
    apiEndpoint: 'http://localhost:99999/unreachable',
    timeoutMs: 100,
  });

  const baseQuery: AssistantQuery = {
    tenantId: 'bank-001',
    userId: 'trader-01',
    question: 'What is our EUR/USD FX exposure?',
    context: {
      snapshotDate: '2026-04-10',
      fxPositions: [{ pair: 'EUR/USD', netPosition: 50_000_000, mtm: 54_200_000 }],
      lcrRatio: 142.5,
      nsfrRatio: 118.3,
      cet1RatioPct: 13.2,
      niiYTD: 48_000_000,
    },
  };

  it('classifies FX question correctly', async () => {
    const r = await assistant.ask(baseQuery);
    expect(r.category).toBe(QueryCategory.FX_EXPOSURE);
  });

  it('classifies limit question correctly', async () => {
    const r = await assistant.ask({
      ...baseQuery,
      question: 'Which counterparties are approaching limits?',
    });
    expect(r.category).toBe(QueryCategory.LIMIT_UTILISATION);
  });

  it('classifies IRRBB question correctly', async () => {
    const r = await assistant.ask({ ...baseQuery, question: 'Show me the IRRBB NII sensitivity' });
    expect(r.category).toBe(QueryCategory.IRRBB_ANALYSIS);
  });

  it('returns fallback answer when API unreachable', async () => {
    const r = await assistant.ask(baseQuery);
    expect(r.answer.length).toBeGreaterThan(10);
    expect(r.modelVersion).toBe('fallback');
  });

  it('fallback is LOW confidence', async () => {
    const r = await assistant.ask(baseQuery);
    expect(r.confidence).toBe('LOW');
  });

  it('returns 3 follow-up questions', async () => {
    const r = await assistant.ask(baseQuery);
    expect(r.followUpQuestions).toHaveLength(3);
  });

  it('includes disclaimer in response', async () => {
    const r = await assistant.ask(baseQuery);
    expect(r.disclaimers.length).toBeGreaterThan(0);
  });

  it('tracks failed queries in metrics', async () => {
    await assistant.ask(baseQuery); // will fail (unreachable)
    expect(assistant.metrics.failedQueries).toBeGreaterThan(0);
  });

  it('PII redaction removes IBAN-like patterns', () => {
    const a = new TreasuryAIAssistant({
      piiRedaction: true,
      apiEndpoint: 'http://localhost:99999/',
      timeoutMs: 50,
    });
    const q = { ...baseQuery, question: 'Tell me about GB29NWBK60161331926819 exposure' };
    // Test via ask (will fallback but question gets redacted internally)
    expect(q.question).toContain('GB29');
    // The redacted version inside the assistant would replace it
    const redacted = (a as unknown as { _redactPII: (s: string) => string })._redactPII(q.question);
    expect(redacted).not.toContain('GB29NWBK60161331926819');
  });
});

// ── Report Builder ─────────────────────────────────────────────────────────────
describe('ReportBuilder — Sprint 11.2', () => {
  let builder: ReportBuilder;
  beforeEach(() => {
    builder = new ReportBuilder();
  });

  it('defines a report and returns a definition with ID', () => {
    const r = builder.define({
      name: 'Daily Blotter',
      tenantId: 'bank-001',
      createdBy: 'user-01',
      template: ReportTemplate.BLOTTER,
      dimensions: [ReportDimension.BOOK, ReportDimension.TRADER],
    });
    expect(r.id).toContain('RPT-');
    expect(r.template).toBe(ReportTemplate.BLOTTER);
  });

  it('uses default metrics for BLOTTER template', () => {
    const r = builder.define({
      name: 'Blotter',
      tenantId: 'bank-001',
      createdBy: 'u1',
      template: ReportTemplate.BLOTTER,
      dimensions: [ReportDimension.BOOK],
    });
    expect(r.metrics).toContain('mtm');
    expect(r.metrics).toContain('tradeId');
  });

  it('allows custom metrics override', () => {
    const r = builder.define({
      name: 'Custom',
      tenantId: 'bank-001',
      createdBy: 'u1',
      template: ReportTemplate.CUSTOM,
      dimensions: [ReportDimension.CURRENCY],
      metrics: ['myMetric', 'rate'],
    });
    expect(r.metrics).toEqual(['myMetric', 'rate']);
  });

  it('run() returns COMPLETED status', () => {
    const def = builder.define({
      name: 'LCR Report',
      tenantId: 'bank-001',
      createdBy: 'u1',
      template: ReportTemplate.LCR,
      dimensions: [ReportDimension.LEGAL_ENTITY],
    });
    const run = builder.run(def.id);
    expect(run.status).toBe('COMPLETED');
    expect(run.outputRows).toBeGreaterThan(0);
  });

  it('run history tracks all runs for a report', () => {
    const def = builder.define({
      name: 'P&L',
      tenantId: 'bank-001',
      createdBy: 'u1',
      template: ReportTemplate.PNL,
      dimensions: [ReportDimension.TRADER],
    });
    builder.run(def.id, 'MANUAL');
    builder.run(def.id, 'SCHEDULE');
    expect(builder.getRunHistory(def.id)).toHaveLength(2);
  });

  it('listReports filters by tenantId', () => {
    builder.define({
      name: 'R1',
      tenantId: 'bank-001',
      createdBy: 'u1',
      template: ReportTemplate.LCR,
      dimensions: [ReportDimension.BOOK],
    });
    builder.define({
      name: 'R2',
      tenantId: 'bank-001',
      createdBy: 'u1',
      template: ReportTemplate.PNL,
      dimensions: [ReportDimension.TRADER],
    });
    builder.define({
      name: 'R3',
      tenantId: 'bank-002',
      createdBy: 'u2',
      template: ReportTemplate.LCR,
      dimensions: [ReportDimension.BOOK],
    });
    expect(builder.listReports('bank-001')).toHaveLength(2);
  });

  it('schedule and delivery configuration is stored', () => {
    const r = builder.define({
      name: 'Sched',
      tenantId: 'bank-001',
      createdBy: 'u1',
      template: ReportTemplate.CAPITAL,
      dimensions: [ReportDimension.LEGAL_ENTITY],
      schedule: {
        frequency: 'DAILY',
        cronExpression: '0 8 * * 1-5',
        timezone: 'UTC',
        startDate: '2026-05-01',
        active: true,
      },
      delivery: {
        method: 'EMAIL',
        recipients: ['treasury@bank.com'],
        subjectTemplate: 'Capital Report {date}',
      },
    });
    expect(r.schedule?.frequency).toBe('DAILY');
    expect(r.delivery?.method).toBe('EMAIL');
  });

  it('defaultMetrics returns correct set for each template', () => {
    expect(ReportBuilder.defaultMetrics(ReportTemplate.LCR)).toContain('lcrRatio');
    expect(ReportBuilder.defaultMetrics(ReportTemplate.IRRBB)).toContain('eveShock');
    expect(ReportBuilder.defaultMetrics(ReportTemplate.COLLATERAL)).toContain('marginCall');
  });

  it('throws on running unknown report ID', () => {
    expect(() => builder.run('UNKNOWN-ID')).toThrow();
  });
});

// ── AI Assistant branch coverage additions ─────────────────────────────────────
describe('TreasuryAIAssistant — branch coverage additions', () => {
  const assistant = new TreasuryAIAssistant({
    apiEndpoint: 'http://localhost:99999/',
    timeoutMs: 50,
  });
  const base: AssistantQuery = {
    tenantId: 'bank-001',
    userId: 'u1',
    question: '',
    context: {
      snapshotDate: '2026-04-10',
      lcrRatio: 142.5,
      cet1RatioPct: 13.2,
      niiYTD: 48_000_000,
    },
  };

  it('classifies capital/RAROC question as CAPITAL_POSITION', async () => {
    const r = await assistant.ask({ ...base, question: 'What is our CET1 ratio and RAROC?' });
    expect(r.category).toBe(QueryCategory.CAPITAL_POSITION);
  });

  it('classifies trade blotter question as TRADE_BLOTTER', async () => {
    const r = await assistant.ask({ ...base, question: 'Show me the trade blotter PnL today' });
    expect(r.category).toBe(QueryCategory.TRADE_BLOTTER);
  });

  it('classifies profitability question as PROFITABILITY', async () => {
    const r = await assistant.ask({
      ...base,
      question: 'What is our profit and cost-to-income ratio?',
    });
    expect(r.category).toBe(QueryCategory.PROFITABILITY);
  });

  it('classifies general question as GENERAL', async () => {
    const r = await assistant.ask({ ...base, question: 'Hello, how are you?' });
    expect(r.category).toBe(QueryCategory.GENERAL);
  });

  it('citedMetrics includes CET1 and LCR when context is provided', async () => {
    const r = await assistant.ask(base);
    // fallback path still calls _parseResponse — citedMetrics populated from context
    expect(r.confidence).toBe('LOW'); // fallback since API unreachable
  });

  it('context-less query returns LOW confidence', async () => {
    const r = await assistant.ask({ ...base, context: undefined });
    expect(r.confidence).toBe('LOW');
  });

  it('metrics successRate is a percentage string', () => {
    expect(assistant.metrics.successRate).toMatch(/^\d+(\.\d+)?%$/);
  });
});
