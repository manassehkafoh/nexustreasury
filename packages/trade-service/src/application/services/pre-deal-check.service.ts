import type { TenantId, CounterpartyId, Money, PreDealCheckResult } from '@nexustreasury/domain';

export interface PreDealCheckInput {
  tenantId: TenantId;
  counterpartyId: CounterpartyId;
  requestedExposure: Money;
}

export interface PreDealCheckService {
  check(input: PreDealCheckInput): Promise<PreDealCheckResult>;
}

/** Pass-through for dev/test. Replace with gRPC client to risk-service in production. */
export class PassThroughPreDealCheck implements PreDealCheckService {
  async check(input: PreDealCheckInput): Promise<PreDealCheckResult> {
    return {
      approved: true,
      limitUtilisationPct: 50,
      headroomAmount: input.requestedExposure,
      failureReasons: [],
      checkedAt: new Date(),
    };
  }
}
