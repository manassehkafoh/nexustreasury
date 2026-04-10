import { describe, it, expect, beforeEach } from 'vitest';
import { RegulatorySubmissionEngine, RegulatorCode, SubmissionStatus } from './regulatory-submission.js';

describe('RegulatorySubmissionEngine — Sprint 10.4', () => {
  let engine: RegulatorySubmissionEngine;
  beforeEach(() => { engine = new RegulatorySubmissionEngine(); });

  it('submit returns SUBMITTED status', () => {
    const r = engine.submit({ tenantId:'bank-001', regulator:RegulatorCode.EBA_COREP, reportingPeriod:'Q1-2026', fileSize:250_000 });
    expect(r.status).toBe(SubmissionStatus.SUBMITTED);
    expect(r.id).toContain('SUB-');
  });

  it('acknowledge transitions status to ACKNOWLEDGED', () => {
    const s = engine.submit({ tenantId:'bank-001', regulator:RegulatorCode.CBUTT_ALMA, reportingPeriod:'2026-03', fileSize:100_000 });
    const a = engine.acknowledge(s.id);
    expect(a.status).toBe(SubmissionStatus.ACKNOWLEDGED);
    expect(a.acknowledgedAt).toBeDefined();
  });

  it('reject transitions status to REJECTED with reason', () => {
    const s = engine.submit({ tenantId:'bank-001', regulator:RegulatorCode.EBA_FINREP, reportingPeriod:'2026-Q1', fileSize:180_000 });
    const r = engine.reject(s.id, 'XBRL schema validation failed on node F01.01');
    expect(r.status).toBe(SubmissionStatus.REJECTED);
    expect(r.rejectionReason).toContain('XBRL');
  });

  it('getStatus returns submission by ID', () => {
    const s = engine.submit({ tenantId:'bank-001', regulator:RegulatorCode.BOG_ANNUAL, reportingPeriod:'2025', fileSize:500_000 });
    expect(engine.getStatus(s.id)?.id).toBe(s.id);
  });

  it('listByRegulator returns only matching submissions', () => {
    engine.submit({ tenantId:'bank-001', regulator:RegulatorCode.EBA_COREP,  reportingPeriod:'Q1', fileSize:1000 });
    engine.submit({ tenantId:'bank-001', regulator:RegulatorCode.EBA_COREP,  reportingPeriod:'Q2', fileSize:1000 });
    engine.submit({ tenantId:'bank-001', regulator:RegulatorCode.CBUTT_ALMA, reportingPeriod:'M1', fileSize:1000 });
    expect(engine.listByRegulator(RegulatorCode.EBA_COREP)).toHaveLength(2);
  });

  it('unique IDs across multiple submissions', () => {
    const a = engine.submit({ tenantId:'bank-001', regulator:RegulatorCode.CBN_MONTHLY, reportingPeriod:'2026-01', fileSize:80_000 });
    const b = engine.submit({ tenantId:'bank-001', regulator:RegulatorCode.CBN_MONTHLY, reportingPeriod:'2026-02', fileSize:80_000 });
    expect(a.id).not.toBe(b.id);
  });

  it('throws when acknowledging unknown ID', () => {
    expect(() => engine.acknowledge('no-such-id')).toThrow();
  });
});
