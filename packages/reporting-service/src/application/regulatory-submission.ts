/**
 * @module RegulatorySubmissionEngine
 * @description Automated Regulatory Submission — Sprint 10.4.
 * Tracks submission status and acknowledgements for CBUTT, EBA COREP/FINREP.
 * @see Sprint 10.4
 */

import { randomUUID } from 'crypto';
export const RegulatorCode = {
  EBA_COREP: 'EBA_COREP',
  EBA_FINREP: 'EBA_FINREP',
  CBUTT_ALMA: 'CBUTT_ALMA', // Central Bank of Trinidad & Tobago
  BOG_ANNUAL: 'BOG_ANNUAL', // Bank of Ghana
  CBN_MONTHLY: 'CBN_MONTHLY', // Central Bank of Nigeria
} as const;
export type RegulatorCode = (typeof RegulatorCode)[keyof typeof RegulatorCode];

export const SubmissionStatus = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  REJECTED: 'REJECTED',
} as const;
export type SubmissionStatus = (typeof SubmissionStatus)[keyof typeof SubmissionStatus];

export interface SubmissionRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly regulator: RegulatorCode;
  readonly reportingPeriod: string;
  readonly status: SubmissionStatus;
  readonly submittedAt?: string;
  readonly acknowledgedAt?: string;
  readonly rejectionReason?: string;
  readonly fileSize: number;
  readonly xbrlPackage?: string;
}

export class RegulatorySubmissionEngine {
  private readonly _submissions = new Map<string, SubmissionRecord>();

  submit(params: {
    tenantId: string;
    regulator: RegulatorCode;
    reportingPeriod: string;
    fileSize: number;
    xbrlPackage?: string;
  }): SubmissionRecord {
    const id = `SUB-${params.regulator}-${randomUUID().split('-')[0].toUpperCase()}`;
    const rec: SubmissionRecord = {
      id,
      tenantId: params.tenantId,
      regulator: params.regulator,
      reportingPeriod: params.reportingPeriod,
      status: SubmissionStatus.SUBMITTED,
      submittedAt: new Date().toISOString(),
      fileSize: params.fileSize,
      xbrlPackage: params.xbrlPackage,
    };
    this._submissions.set(id, rec);
    return rec;
  }

  acknowledge(submissionId: string): SubmissionRecord {
    const r = this._submissions.get(submissionId);
    if (!r) throw new Error(`Submission ${submissionId} not found`);
    const updated = {
      ...r,
      status: SubmissionStatus.ACKNOWLEDGED,
      acknowledgedAt: new Date().toISOString(),
    };
    this._submissions.set(submissionId, updated);
    return updated;
  }

  reject(submissionId: string, reason: string): SubmissionRecord {
    const r = this._submissions.get(submissionId);
    if (!r) throw new Error(`Submission ${submissionId} not found`);
    const updated = { ...r, status: SubmissionStatus.REJECTED, rejectionReason: reason };
    this._submissions.set(submissionId, updated);
    return updated;
  }

  getStatus(submissionId: string): SubmissionRecord | undefined {
    return this._submissions.get(submissionId);
  }

  listByRegulator(regulator: RegulatorCode): SubmissionRecord[] {
    return Array.from(this._submissions.values()).filter((r) => r.regulator === regulator);
  }
}
