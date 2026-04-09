/**
 * SSIService — TDD test suite
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  SSIService,
  InMemorySSIRepository,
  SettlementMethod,
  type SSIRecord,
} from './ssi.service.js';

const TENANT = 'tenant-001';
const CP_ID = 'cp-citibank';
const BENEF: SSIRecord['beneficiaryBank'] = { bic: 'CITIUS33XXX', bankName: 'Citibank NA' };

function makeSSIInput(
  overrides: Partial<Omit<SSIRecord, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'active'>> = {},
) {
  return {
    tenantId: TENANT,
    counterpartyId: CP_ID,
    currency: 'USD',
    instrumentType: 'FX',
    method: SettlementMethod.SWIFT_MT,
    beneficiaryBank: BENEF,
    beneficiaryAccount: '36838271',
    beneficiaryName: 'Citibank Treasury',
    ...overrides,
  };
}

let repo: InMemorySSIRepository;
let svc: SSIService;

beforeEach(() => {
  repo = new InMemorySSIRepository();
  svc = new SSIService(repo);
});

describe('SSIService — upsert', () => {
  it('creates a new active SSI', async () => {
    const { ssi, quarantined } = await svc.upsertSSI(makeSSIInput());
    expect(ssi.active).toBe(true);
    expect(quarantined).toBe(false);
    expect(ssi.version).toBe(1);
  });

  it('second upsert deactivates the first and creates version 2', async () => {
    await svc.upsertSSI(makeSSIInput());
    const { ssi } = await svc.upsertSSI(makeSSIInput({ beneficiaryAccount: '99999999' }));
    expect(ssi.version).toBe(2);
    expect(ssi.beneficiaryAccount).toBe('99999999');

    // first SSI should be deactivated
    const all = await repo.findAll(TENANT);
    const inactive = all.filter((s) => !s.active);
    expect(inactive).toHaveLength(1);
    expect(inactive[0]!.beneficiaryAccount).toBe('36838271');
  });

  it('quarantines SSI when anomaly detector flags high risk', async () => {
    const svcWithDetector = new SSIService(repo, {
      score: async () => ({ riskScore: 0.9, flags: ['BIC changed to different country'] }),
    });
    const { ssi, quarantined, flags } = await svcWithDetector.upsertSSI(makeSSIInput());
    expect(quarantined).toBe(true);
    expect(ssi.active).toBe(false);
    expect(flags).toContain('BIC changed to different country');
  });

  it('does not quarantine SSI when risk score is low', async () => {
    const svcWithDetector = new SSIService(repo, {
      score: async () => ({ riskScore: 0.3, flags: [] }),
    });
    const { quarantined } = await svcWithDetector.upsertSSI(makeSSIInput());
    expect(quarantined).toBe(false);
  });
});

describe('SSIService — resolve', () => {
  it('resolves exact-match SSI', async () => {
    await svc.upsertSSI(makeSSIInput());
    const result = await svc.resolve({
      counterpartyId: CP_ID,
      currency: 'USD',
      instrumentType: 'FX',
      tenantId: TENANT,
    });
    expect(result).not.toBeNull();
    expect(result!.beneficiaryAccount).toBe('36838271');
  });

  it('resolves wildcard currency SSI when no exact match', async () => {
    await svc.upsertSSI(makeSSIInput({ currency: '*', instrumentType: '*' }));
    const result = await svc.resolve({
      counterpartyId: CP_ID,
      currency: 'EUR',
      instrumentType: 'BOND',
      tenantId: TENANT,
    });
    expect(result).not.toBeNull();
  });

  it('returns null when no SSI found', async () => {
    const result = await svc.resolve({
      counterpartyId: 'unknown-cp',
      currency: 'USD',
      instrumentType: 'FX',
      tenantId: TENANT,
    });
    expect(result).toBeNull();
  });

  it('prefers exact match over wildcard', async () => {
    await svc.upsertSSI(
      makeSSIInput({ currency: '*', instrumentType: '*', beneficiaryAccount: 'WILDCARD' }),
    );
    await svc.upsertSSI(
      makeSSIInput({ currency: 'USD', instrumentType: 'FX', beneficiaryAccount: 'EXACT' }),
    );
    const result = await svc.resolve({
      counterpartyId: CP_ID,
      currency: 'USD',
      instrumentType: 'FX',
      tenantId: TENANT,
    });
    expect(result!.beneficiaryAccount).toBe('EXACT');
  });
});
