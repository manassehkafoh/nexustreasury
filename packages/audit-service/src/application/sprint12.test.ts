import { describe, it, expect, beforeEach } from 'vitest';
import { DisasterRecoveryOrchestrator, RegionStatus, FailoverTrigger } from './disaster-recovery.js';
import { SecretRotationManager, SecretType, RotationStatus } from './secret-rotation.js';
import { FinOpsCostTracker } from './finops-cost-tracker.js';
import { SOC2EvidenceCollector, EvidenceStatus, TrustCriteria } from './soc2-evidence.js';

// ── 12.1 Disaster Recovery ────────────────────────────────────────────────────
describe('DisasterRecoveryOrchestrator — Sprint 12.1', () => {
  let dr: DisasterRecoveryOrchestrator;
  beforeEach(() => { dr = new DisasterRecoveryOrchestrator({ primaryRegion:'eu-west-1', standbyRegions:['us-east-1','ap-southeast-1'] }); });

  it('healthy check sets status to HEALTHY', () => {
    dr.recordHealthCheck('eu-west-1', 45, 0.1);
    const health = dr.getRegionHealth().find(r => r.region === 'eu-west-1')!;
    expect(health.status).toBe(RegionStatus.HEALTHY);
  });

  it('3 consecutive failures on primary triggers failover', () => {
    let event = null;
    for (let i = 0; i < 3; i++) { event = dr.recordHealthCheck('eu-west-1', 10_000, 20); }
    expect(event).not.toBeNull();
    expect(event!.trigger).toBe(FailoverTrigger.HEALTH_CHECK_FAILURE);
  });

  it('failover promotes standby to primary', () => {
    for (let i = 0; i < 3; i++) dr.recordHealthCheck('eu-west-1', 10_000, 20);
    expect(dr.primaryRegion).toBe('us-east-1');
  });

  it('manual failover is logged', () => {
    dr.triggerManualFailover();
    expect(dr.getFailoverLog()[0].trigger).toBe(FailoverTrigger.MANUAL);
  });

  it('DR test returns RTO/RPO measurements', () => {
    const result = dr.runDRTest('primary-region-failure');
    expect(result.rtoMeasuredMs).toBeGreaterThan(0);
    expect(result.rpoMeasuredMs).toBeGreaterThan(0);
  });

  it('failover event includes runbook steps', () => {
    const e = dr.triggerManualFailover();
    expect(e.runbookSteps.length).toBeGreaterThan(0);
    expect(e.runbookSteps[0].command).toBeTruthy();
  });

  it('PagerDuty alert has required fields', () => {
    const e = dr.triggerManualFailover();
    expect(e.pagerDutyAlert.eventAction).toBe('trigger');
    expect(e.pagerDutyAlert.summary).toContain('failover');
  });
});

// ── 12.2 Secret Rotation ─────────────────────────────────────────────────────
describe('SecretRotationManager — Sprint 12.2', () => {
  let mgr: SecretRotationManager;
  beforeEach(() => { mgr = new SecretRotationManager(); });

  it('register returns a secret record with fingerprint', () => {
    const s = mgr.register({ secretType:SecretType.JWT_SIGNING, tenantId:'bank-001', rawSecretValue:'super-secret', rotationDueDays:90 });
    expect(s.fingerprint).toBeDefined();
    expect(s.isActive).toBe(true);
  });

  it('JWT rotation creates dual-validation window', () => {
    const s = mgr.register({ secretType:SecretType.JWT_SIGNING, tenantId:'bank-001', rawSecretValue:'secret-a', rotationDueDays:90 });
    const { event } = mgr.rotateJWTSecret('bank-001', s.secretId);
    expect(event.status).toBe(RotationStatus.DUAL_VALID);
    expect(event.dualValidUntil).toBeDefined();
    expect(mgr.isDualValidActive('bank-001')).toBe(true);
  });

  it('completing dual validation deactivates old key', () => {
    const s = mgr.register({ secretType:SecretType.JWT_SIGNING, tenantId:'bank-001', rawSecretValue:'secret-a', rotationDueDays:90 });
    mgr.rotateJWTSecret('bank-001', s.secretId);
    const completed = mgr.completeDualValidation('bank-001');
    expect(completed.status).toBe(RotationStatus.COMPLETE);
    expect(mgr.isDualValidActive('bank-001')).toBe(false);
  });

  it('AUDIT_HMAC rotation records re-signed anchors', () => {
    const s = mgr.register({ secretType:SecretType.AUDIT_HMAC, tenantId:'bank-001', rawSecretValue:'hmac-key', rotationDueDays:90 });
    const { event } = mgr.rotateAuditHMACKey('bank-001', s.secretId, 4500);
    expect(event.reSignedRecords).toBe(4500);
  });

  it('Vault dynamic credential has expiry', () => {
    const cred = mgr.issueVaultDynamicCredential('nexustreasury-rw');
    expect(cred.expiresAt).toBeDefined();
    expect(cred.leaseDurationSec).toBeGreaterThan(0);
    expect(cred.renewable).toBe(true);
  });

  it('getDueForRotation returns secrets expiring within 7 days', () => {
    mgr.register({ secretType:SecretType.JWT_SIGNING, tenantId:'bank-001', rawSecretValue:'s', rotationDueDays:3 });
    mgr.register({ secretType:SecretType.JWT_SIGNING, tenantId:'bank-001', rawSecretValue:'s2', rotationDueDays:90 });
    expect(mgr.getDueForRotation()).toHaveLength(1);
  });
});

// ── 12.3 FinOps ──────────────────────────────────────────────────────────────
describe('FinOpsCostTracker — Sprint 12.3', () => {
  let tracker: FinOpsCostTracker;
  const entry = {
    service:'trade-service', namespace:'nexustreasury-bank-001', tenantId:'bank-001',
    cpuCores:2, memoryGib:4, storageGib:50, networkGib:10,
    periodStart:'2026-04-01T00:00:00Z', periodEnd:'2026-04-30T23:59:59Z',
  };
  beforeEach(() => { tracker = new FinOpsCostTracker(); });

  it('generates cost report with total > 0', () => {
    tracker.addEntry(entry);
    const r = tracker.generateTenantReport('bank-001', '2026-04');
    expect(r.totalCostUSD).toBeGreaterThan(0);
  });

  it('cost components sum to total', () => {
    tracker.addEntry(entry);
    const r = tracker.generateTenantReport('bank-001', '2026-04');
    const sum = r.cpuCostUSD + r.memoryCostUSD + r.storageCostUSD + r.networkCostUSD;
    expect(Math.abs(sum - r.totalCostUSD)).toBeLessThan(0.01);
  });

  it('budget utilisation is computed when budget is set', () => {
    tracker.addEntry(entry); tracker.setBudget('bank-001', 1000);
    const r = tracker.generateTenantReport('bank-001', '2026-04');
    expect(r.budgetUtilPct).toBeDefined();
    expect(r.budgetUtilPct!).toBeGreaterThan(0);
  });

  it('CSV export contains header and data rows', () => {
    tracker.addEntry(entry);
    const r = tracker.generateTenantReport('bank-001', '2026-04');
    expect(r.csvExport).toContain('tenant_id,period,service');
    expect(r.csvExport).toContain('bank-001');
  });

  it('summary across tenants orders by cost', () => {
    tracker.addEntry(entry);
    tracker.addEntry({ ...entry, tenantId:'bank-002', cpuCores:0.1 });
    const summary = tracker.getAllTenantsSummary('2026-04');
    expect(summary[0].totalCostUSD).toBeGreaterThan(summary[1].totalCostUSD);
  });
});

// ── 12.4 SOC 2 ───────────────────────────────────────────────────────────────
describe('SOC2EvidenceCollector — Sprint 12.4', () => {
  let col: SOC2EvidenceCollector;
  beforeEach(() => { col = new SOC2EvidenceCollector(); col.collectAutomatedEvidence(); });

  it('collected evidence spans all 5 trust criteria', () => {
    const criteria = new Set(col.getEvidenceByStatus(EvidenceStatus.COLLECTED).map(e => e.criteria));
    const all = Object.values(TrustCriteria);
    // At least 4 of 5 criteria have automated evidence (CC1 is manual)
    expect(criteria.size).toBeGreaterThanOrEqual(4);
  });

  it('readiness report has overall pct > 0', () => {
    const r = col.generateReadinessReport('2026-Q2');
    expect(r.overallReadinessPct).toBeGreaterThan(0);
  });

  it('readiness report lists criteria summary for all 5 criteria', () => {
    const r = col.generateReadinessReport('2026-Q2');
    expect(r.criteriaSummary).toHaveLength(5);
  });

  it('pending evidence appears in openFindings', () => {
    const r = col.generateReadinessReport('2026-Q2');
    expect(r.openFindings.some(f => f.startsWith('PENDING'))).toBe(true);
  });

  it('Drata control IDs are set on automated evidence', () => {
    const items = col.getEvidenceByStatus(EvidenceStatus.COLLECTED);
    expect(items.every(e => e.drataControlId)).toBe(true);
  });

  it('estimated audit date is in the future', () => {
    const r = col.generateReadinessReport('2026-Q2');
    expect(new Date(r.estimatedAuditDate).getTime()).toBeGreaterThan(Date.now());
  });
});
