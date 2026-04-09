/**
 * NostroReconciliationService — TDD test suite
 *
 * Tests all match categories: MATCHED, REVIEW (timing), BREAK (amount, missing, unrecognised)
 * and STP rate calculation.
 */
import { describe, it, expect } from 'vitest';
import {
  NostroReconciliationService,
  BreakType,
  ReconciliationStatus,
  type StatementEntry,
  type ExpectedFlow,
} from './nostro-reconciliation.service.js';

const svc = new NostroReconciliationService();

const TODAY = new Date('2026-04-09');
const TOMORROW = new Date('2026-04-10');

const BASE_PARAMS = {
  statementId: 'STMT-2026-04-09',
  nostroAccount: 'NOSTR-USD-001',
  currency: 'USD',
  statementDate: TODAY,
  openingBalance: 10_000_000,
  closingBalance: 11_500_000,
};

function entry(overrides: Partial<StatementEntry> = {}): StatementEntry {
  return {
    entryId: 'E001',
    valueDate: TODAY,
    bookingDate: TODAY,
    amount: 1_000_000,
    currency: 'USD',
    reference: 'FX-20260409-A1B2',
    description: 'FX settlement',
    nostroAccount: 'NOSTR-USD-001',
    ...overrides,
  };
}

function flow(overrides: Partial<ExpectedFlow> = {}): ExpectedFlow {
  return {
    flowId: 'FLOW-001',
    tradeRef: 'FX-20260409-A1B2',
    valueDate: TODAY,
    amount: 1_000_000,
    currency: 'USD',
    nostroAccount: 'NOSTR-USD-001',
    ...overrides,
  };
}

describe('NostroReconciliationService — exact match', () => {
  it('returns MATCHED status for exact entry + flow', async () => {
    const result = await svc.reconcile({
      ...BASE_PARAMS,
      entries: [entry()],
      expectedFlows: [flow()],
    });
    expect(result.matches[0]!.status).toBe(ReconciliationStatus.MATCHED);
    expect(result.matchedCount).toBe(1);
    expect(result.breakCount).toBe(0);
    expect(result.stpRate).toBe(1);
  });

  it('matches when reference is a substring', async () => {
    const result = await svc.reconcile({
      ...BASE_PARAMS,
      entries: [entry({ reference: 'SOME-PREFIX-FX-20260409-A1B2-SUFFIX' })],
      expectedFlows: [flow()],
    });
    expect(result.matches[0]!.status).toBe(ReconciliationStatus.MATCHED);
  });
});

describe('NostroReconciliationService — timing difference', () => {
  it('returns REVIEW + TIMING_DIFFERENCE for 1-day date difference', async () => {
    const result = await svc.reconcile({
      ...BASE_PARAMS,
      entries: [entry({ valueDate: TOMORROW })], // statement says tomorrow
      expectedFlows: [flow({ valueDate: TODAY })], // TMS says today
    });
    const m = result.matches[0]!;
    expect(m.status).toBe(ReconciliationStatus.REVIEW);
    expect(m.breakType).toBe(BreakType.TIMING_DIFFERENCE);
    expect(m.breakDays).toBe(1);
  });
});

describe('NostroReconciliationService — amount mismatch', () => {
  it('returns BREAK + AMOUNT_MISMATCH when amounts differ', async () => {
    const result = await svc.reconcile({
      ...BASE_PARAMS,
      entries: [entry({ amount: 1_000_500 })],
      expectedFlows: [flow({ amount: 1_000_000 })],
    });
    const m = result.matches[0]!;
    expect(m.status).toBe(ReconciliationStatus.BREAK);
    expect(m.breakType).toBe(BreakType.AMOUNT_MISMATCH);
    expect(m.breakAmount).toBeCloseTo(500, 1);
  });

  it('accepts amount within 0.01 tolerance as matched', async () => {
    const result = await svc.reconcile({
      ...BASE_PARAMS,
      entries: [entry({ amount: 1_000_000.005 })],
      expectedFlows: [flow({ amount: 1_000_000 })],
    });
    expect(result.matches[0]!.status).toBe(ReconciliationStatus.MATCHED);
  });
});

describe('NostroReconciliationService — breaks', () => {
  it('returns UNRECOGNISED break for statement entry with no matching flow', async () => {
    const result = await svc.reconcile({
      ...BASE_PARAMS,
      entries: [entry({ reference: 'COMPLETELY-UNKNOWN', amount: 50_000 })],
      expectedFlows: [],
    });
    expect(result.matches[0]!.breakType).toBe(BreakType.UNRECOGNISED);
    expect(result.matches[0]!.status).toBe(ReconciliationStatus.BREAK);
  });

  it('returns MISSING_PAYMENT break for expected flow not on statement', async () => {
    const result = await svc.reconcile({
      ...BASE_PARAMS,
      entries: [], // nothing received
      expectedFlows: [flow()], // but we expected this
    });
    const m = result.matches[0]!;
    expect(m.breakType).toBe(BreakType.MISSING_PAYMENT);
    expect(m.expectedFlowId).toBe('FLOW-001');
  });
});

describe('NostroReconciliationService — STP rate and statistics', () => {
  it('computes correct STP rate for 3 entries: 2 matched, 1 break', async () => {
    const result = await svc.reconcile({
      ...BASE_PARAMS,
      entries: [
        entry({ entryId: 'E1', reference: 'REF-A', amount: 100_000 }),
        entry({ entryId: 'E2', reference: 'REF-B', amount: 200_000 }),
        entry({ entryId: 'E3', reference: 'UNKNOWN', amount: 999 }),
      ],
      expectedFlows: [
        flow({ flowId: 'F1', tradeRef: 'REF-A', amount: 100_000 }),
        flow({ flowId: 'F2', tradeRef: 'REF-B', amount: 200_000 }),
      ],
    });
    expect(result.matchedCount).toBe(2);
    expect(result.breakCount).toBeGreaterThanOrEqual(1);
    expect(result.stpRate).toBeCloseTo(2 / 3, 2);
  });

  it('STP rate = 1.0 when all entries matched', async () => {
    const result = await svc.reconcile({
      ...BASE_PARAMS,
      entries: [entry()],
      expectedFlows: [flow()],
    });
    expect(result.stpRate).toBe(1);
  });

  it('processingMs is defined and positive', async () => {
    const result = await svc.reconcile({
      ...BASE_PARAMS,
      entries: [entry()],
      expectedFlows: [flow()],
    });
    expect(result.processingMs).toBeGreaterThanOrEqual(0);
  });
});

describe('NostroReconciliationService — alertable breaks', () => {
  it('flags breaks above alert amount threshold', async () => {
    const result = await svc.reconcile({
      ...BASE_PARAMS,
      entries: [entry({ reference: 'UNKNOWN', amount: 500_000 })],
      expectedFlows: [],
    });
    const alerts = svc.alertableBreaks(result);
    expect(alerts).toHaveLength(1);
  });

  it('does not flag breaks below threshold', async () => {
    const result = await svc.reconcile({
      ...BASE_PARAMS,
      entries: [entry({ reference: 'UNKNOWN', amount: 50 })], // below 100k threshold
      expectedFlows: [],
    });
    const alerts = svc.alertableBreaks(result);
    expect(alerts).toHaveLength(0);
  });
});
