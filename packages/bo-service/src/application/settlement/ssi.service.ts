/**
 * @module bo-service/application/settlement/ssi.service
 *
 * Standing Settlement Instructions (SSI) Service.
 *
 * SSIs are pre-agreed settlement instructions stored per counterparty,
 * currency and instrument type. They auto-populate settlement fields at
 * trade capture, eliminating manual entry and reducing settlement fails.
 *
 * Priority resolution: exact-match (ccy + instrument) > currency wildcard > '*'
 *
 * AI/ML hook: SSIAnomalyDetector — flags BIC/account changes for 4-eye review.
 * Mitigates payment redirection fraud ("CEO fraud" attacks on SSIs).
 *
 * @see BRD BR-SETT-002 — SSI auto-population
 */
import { randomUUID } from 'crypto';

export enum SettlementMethod {
  SWIFT_MT = 'SWIFT_MT',
  CLS = 'CLS',
  DTC = 'DTC',
  EUROCLEAR = 'EUROCLEAR',
  CLEARSTREAM = 'CLEARSTREAM',
  LOCAL_CSD = 'LOCAL_CSD',
  INTERNAL = 'INTERNAL',
}

export interface BankIdentifier {
  bic: string;
  iban?: string;
  accountNumber?: string;
  routingCode?: string;
  bankName?: string;
  country?: string;
}

export interface SSIRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly counterpartyId: string;
  readonly currency: string; // ISO 4217 or '*' wildcard
  readonly instrumentType: string; // 'FX' | 'BOND' | 'MM' | '*'
  readonly method: SettlementMethod;
  readonly correspondentBank?: BankIdentifier;
  readonly beneficiaryBank: BankIdentifier;
  readonly beneficiaryAccount: string;
  readonly beneficiaryName: string;
  readonly reference?: string;
  readonly active: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: number;
}

// ── Repository ────────────────────────────────────────────────────────────────

export interface SSIRepository {
  save(ssi: SSIRecord): Promise<void>;
  findById(id: string, tenantId: string): Promise<SSIRecord | null>;
  findByCounterparty(
    counterpartyId: string,
    currency: string,
    instrumentType: string,
    tenantId: string,
  ): Promise<SSIRecord[]>;
  findAll(tenantId: string): Promise<SSIRecord[]>;
  deactivate(id: string, tenantId: string): Promise<void>;
}

export class InMemorySSIRepository implements SSIRepository {
  private readonly store = new Map<string, SSIRecord>();
  async save(ssi: SSIRecord) {
    this.store.set(ssi.id, ssi);
  }
  async findById(id: string, tenantId: string) {
    const r = this.store.get(id);
    return r?.tenantId === tenantId ? r : null;
  }
  async findByCounterparty(cpId: string, ccy: string, itype: string, tid: string) {
    return [...this.store.values()].filter(
      (r) =>
        r.tenantId === tid &&
        r.counterpartyId === cpId &&
        r.active &&
        (r.currency === ccy || r.currency === '*') &&
        (r.instrumentType === itype || r.instrumentType === '*'),
    );
  }
  async findAll(tenantId: string) {
    return [...this.store.values()].filter((r) => r.tenantId === tenantId);
  }
  async deactivate(id: string, tenantId: string) {
    const r = this.store.get(id);
    if (r?.tenantId === tenantId)
      this.store.set(id, { ...r, active: false, updatedAt: new Date() });
  }
}

// ── AI/ML Anomaly Detection ────────────────────────────────────────────────────

export interface SSIAnomalyDetector {
  score(params: {
    previous: SSIRecord | null;
    proposed: Omit<SSIRecord, 'id' | 'createdAt' | 'updatedAt' | 'version'>;
  }): Promise<{ riskScore: number; flags: string[] }>;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class SSIService {
  constructor(
    private readonly repo: SSIRepository,
    private readonly anomalyDetector?: SSIAnomalyDetector,
  ) {}

  async upsertSSI(
    input: Omit<SSIRecord, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'active'>,
  ): Promise<{ ssi: SSIRecord; quarantined: boolean; flags: string[] }> {
    const existing = await this.findBestMatch(
      input.counterpartyId,
      input.currency,
      input.instrumentType,
      input.tenantId,
    );

    let quarantined = false;
    let flags: string[] = [];

    if (this.anomalyDetector) {
      const result = await this.anomalyDetector.score({
        previous: existing,
        proposed: { ...input, active: true },
      });
      flags = result.flags;
      quarantined = result.riskScore > 0.7;
    }

    const ssi: SSIRecord = {
      id: randomUUID(),
      ...input,
      active: !quarantined,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: (existing?.version ?? 0) + 1,
    };

    if (existing && !quarantined) await this.repo.deactivate(existing.id, input.tenantId);
    await this.repo.save(ssi);
    return { ssi, quarantined, flags };
  }

  async resolve(params: {
    counterpartyId: string;
    currency: string;
    instrumentType: string;
    tenantId: string;
  }): Promise<SSIRecord | null> {
    return this.findBestMatch(
      params.counterpartyId,
      params.currency,
      params.instrumentType,
      params.tenantId,
    );
  }

  private async findBestMatch(
    cpId: string,
    ccy: string,
    itype: string,
    tid: string,
  ): Promise<SSIRecord | null> {
    const candidates = await this.repo.findByCounterparty(cpId, ccy, itype, tid);
    if (!candidates.length) return null;
    return (
      candidates.find((c) => c.currency === ccy && c.instrumentType === itype) ??
      candidates.find((c) => c.currency === ccy && c.instrumentType === '*') ??
      candidates[0] ??
      null
    );
  }
}
