import {
  LiquidityGapReport,
  ALMScenario,
  LiquidityTimeBucket,
  Money,
  BusinessDate,
  TenantId,
} from '@nexustreasury/domain';

export interface CashFlowInput {
  bucket: LiquidityTimeBucket;
  inflowAmount: number;
  outflowAmount: number;
}

export interface LCRInput {
  hqlaLevel1: number;
  hqlaLevel2A: number;
  hqlaLevel2B: number;
  netCashOutflows30d: number;
}

export interface NSFRInput {
  availableStableFunding: number;
  requiredStableFunding: number;
}

export class LCRCalculator {
  /**
   * Generate a LiquidityGapReport from raw cash flow data.
   * Called by alm-service on:
   *   - Scheduled EOD run
   *   - On-demand request
   *   - Kafka event: nexus.trading.trade.booked (incremental)
   */
  generate(params: {
    tenantId: TenantId;
    asOfDate: BusinessDate;
    scenario: ALMScenario;
    currency: string;
    cashFlows: CashFlowInput[];
    lcr: LCRInput;
    nsfr: NSFRInput;
  }): LiquidityGapReport {
    return LiquidityGapReport.generate({
      tenantId: params.tenantId,
      asOfDate: params.asOfDate,
      scenario: params.scenario,
      currency: params.currency,
      rawBuckets: params.cashFlows.map((cf) => ({
        bucket: cf.bucket,
        inflows: cf.inflowAmount,
        outflows: cf.outflowAmount,
      })),
      lcrComponents: {
        hqlaLevel1: Money.of(params.lcr.hqlaLevel1, params.currency),
        hqlaLevel2A: Money.of(params.lcr.hqlaLevel2A, params.currency),
        hqlaLevel2B: Money.of(params.lcr.hqlaLevel2B, params.currency),
        totalHQLA: Money.of(0, params.currency), // calculated by aggregate
        netCashOutflows30d: Money.of(params.lcr.netCashOutflows30d, params.currency),
        minimumRequired: 100,
      },
      nsfrComponents: {
        availableStableFunding: Money.of(params.nsfr.availableStableFunding, params.currency),
        requiredStableFunding: Money.of(params.nsfr.requiredStableFunding, params.currency),
      },
    });
  }

  /**
   * Apply Basel III HQLA haircuts:
   * Level 2A: 15% haircut  |  Level 2B: 25–50% haircut
   * Cap: Level 2 assets ≤ 40% of total HQLA; Level 2B ≤ 15%
   */
  applyHQLAHaircuts(raw: { level1: number; level2A: number; level2B: number }): {
    level1: number;
    level2A: number;
    level2B: number;
    total: number;
  } {
    const l1 = raw.level1;
    const l2a = raw.level2A * 0.85; // 15% haircut
    const l2b = raw.level2B * 0.75; // 25% haircut (conservative)

    // Basel III LCR correct caps (BCBS 238 §21):
    //   Level 2B ≤ 15% of total HQLA  →  L2B ≤ (15/85) × (L1 + L2A_adj)
    //   Level 2  ≤ 40% of total HQLA  →  L2  ≤ (2/3)  × L1  (per §22)
    // We apply the simpler iterative form: cap each level against (L1 + adj others)
    const maxL2b = (l1 + l2a) * (15 / 85);   // L2B ≤ 15/(1-15) × (L1 + L2A)
    const adjL2b = Math.min(l2b, maxL2b);
    const maxL2a = (l1) * (2 / 3);            // L2  ≤ (2/3) × L1; L2A ≤ this − L2B
    const adjL2a = Math.min(l2a, Math.max(0, maxL2a - adjL2b));

    return {
      level1: l1,
      level2A: adjL2a,
      level2B: adjL2b,
      total: l1 + adjL2a + adjL2b,
    };
  }
}
