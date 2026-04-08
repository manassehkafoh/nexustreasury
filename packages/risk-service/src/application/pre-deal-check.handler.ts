import {
  Limit,
  LimitRepository,
  TenantId,
  CounterpartyId,
  Money,
  type PreDealCheckResponse,
} from '@nexustreasury/domain';

export interface PreDealCheckInput {
  tenantId: TenantId;
  counterpartyId: CounterpartyId;
  requestedExposure: Money;
}

/**
 * Pre-deal check handler — aggregates all applicable limits
 * and returns combined pass/fail with headroom across all limit types.
 * Target P99 < 5ms via in-memory limit cache + Redis fallback.
 */
export class PreDealCheckHandler {
  constructor(private readonly limitRepo: LimitRepository) {}

  async execute(input: PreDealCheckInput): Promise<PreDealCheckResponse> {
    const start = performance.now();

    // Load all applicable limits for the counterparty
    const limits = await this.limitRepo.findByCounterparty(input.counterpartyId, input.tenantId);

    const allFailures: string[] = [];
    let minHeadroom = input.requestedExposure; // default to requested if no limits

    for (const limit of limits) {
      const result = limit.checkPreDeal({
        counterpartyId: input.counterpartyId,
        requestedExposure: input.requestedExposure,
        tenantId: input.tenantId,
      });

      if (!result.approved) {
        allFailures.push(...result.failureReasons);
      }

      // Headroom = minimum across all applicable limits
      if (result.headroom.toNumber() < minHeadroom.toNumber()) {
        minHeadroom = result.headroom;
      }
    }

    const utilisationPct =
      limits.length > 0
        ? limits.reduce(
            (max: number, l: Limit) =>
              Math.max(max, (l.utilisedAmount.toNumber() / l.limitAmount.toNumber()) * 100),
            0,
          )
        : 0;

    return {
      approved: allFailures.length === 0,
      currentUtilisation:
        limits[0]?.utilisedAmount ?? Money.of(0, input.requestedExposure.currency),
      utilisationPct,
      headroom: minHeadroom,
      failureReasons: allFailures,
      checkedAt: new Date(),
      responseTimeMs: performance.now() - start,
    };
  }
}
