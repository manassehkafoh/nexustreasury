import { randomUUID } from 'crypto';
import { DomainEvent } from '../shared/domain-event.js';
import { TenantId, Money, BusinessDate } from '../shared/value-objects.js';

/**
 * BCBS 238 standard time buckets for liquidity gap analysis.
 */
export enum LiquidityTimeBucket {
  OVERNIGHT  = 'OVERNIGHT',
  ONE_WEEK   = 'ONE_WEEK',
  ONE_MONTH  = 'ONE_MONTH',
  THREE_MONTH = 'THREE_MONTH',
  SIX_MONTH  = 'SIX_MONTH',
  ONE_YEAR   = 'ONE_YEAR',
  TWO_YEAR   = 'TWO_YEAR',
  FIVE_YEAR  = 'FIVE_YEAR',
  TEN_YEAR   = 'TEN_YEAR',
  OVER_TEN_YEAR = 'OVER_TEN_YEAR',
}

export enum ALMScenario {
  CONTRACTUAL   = 'CONTRACTUAL',    // Contractual cash flows only
  BEHAVIOURAL   = 'BEHAVIOURAL',    // Adjusted for NMD runoff, prepayments
  STRESSED      = 'STRESSED',       // Idiosyncratic + market stress (BCBS)
}

export interface CashFlowBucket {
  readonly bucket: LiquidityTimeBucket;
  readonly inflows: Money;
  readonly outflows: Money;
  readonly gap: Money;             // inflows - outflows
  readonly cumulativeGap: Money;
}

export interface LCRComponents {
  readonly hqlaLevel1: Money;
  readonly hqlaLevel2A: Money;
  readonly hqlaLevel2B: Money;
  readonly totalHQLA: Money;
  readonly netCashOutflows30d: Money;
  readonly lcrRatio: number;        // percentage
  readonly minimumRequired: number; // 100% Basel minimum
  readonly isCompliant: boolean;
}

export interface NSFRComponents {
  readonly availableStableFunding: Money;
  readonly requiredStableFunding: Money;
  readonly nsfrRatio: number;
  readonly isCompliant: boolean;
}

export class LiquidityGapReportGeneratedEvent extends DomainEvent {
  constructor(
    public readonly report: LiquidityGapReport,
    tenantId: TenantId,
  ) {
    super('nexus.alm.liquidity-gap.generated', report.id, tenantId);
  }
}

export class LCRBreachEvent extends DomainEvent {
  constructor(
    public readonly lcr: LCRComponents,
    public readonly tenantId: TenantId,
  ) {
    super('nexus.alm.lcr.breach', randomUUID(), tenantId);
  }
}

/**
 * LiquidityGapReport aggregate — core ALM entity.
 * Calculates and stores the liquidity gap across all BCBS time buckets.
 */
export class LiquidityGapReport {
  readonly id: string;
  readonly asOfDate: BusinessDate;
  readonly scenario: ALMScenario;
  readonly currency: string;
  readonly buckets: ReadonlyArray<CashFlowBucket>;
  readonly lcr: LCRComponents;
  readonly nsfr: NSFRComponents;
  readonly generatedAt: Date;
  private readonly _domainEvents: DomainEvent[] = [];

  private constructor(params: {
    id: string;
    asOfDate: BusinessDate;
    scenario: ALMScenario;
    currency: string;
    buckets: CashFlowBucket[];
    lcr: LCRComponents;
    nsfr: NSFRComponents;
    tenantId: TenantId;
  }) {
    this.id = params.id;
    this.asOfDate = params.asOfDate;
    this.scenario = params.scenario;
    this.currency = params.currency;
    this.buckets = params.buckets;
    this.lcr = params.lcr;
    this.nsfr = params.nsfr;
    this.generatedAt = new Date();

    this._domainEvents.push(new LiquidityGapReportGeneratedEvent(this, params.tenantId));

    if (!params.lcr.isCompliant) {
      this._domainEvents.push(new LCRBreachEvent(params.lcr, params.tenantId));
    }
  }

  static generate(params: {
    tenantId: TenantId;
    asOfDate: BusinessDate;
    scenario: ALMScenario;
    currency: string;
    rawBuckets: Array<{ bucket: LiquidityTimeBucket; inflows: number; outflows: number }>;
    lcrComponents: Omit<LCRComponents, 'lcrRatio' | 'isCompliant'>;
    nsfrComponents: Omit<NSFRComponents, 'nsfrRatio' | 'isCompliant'>;
  }): LiquidityGapReport {
    // Calculate cumulative gaps
    let runningCumulative = Money.of(0, params.currency);
    const buckets: CashFlowBucket[] = params.rawBuckets.map((rb) => {
      const inflows  = Money.of(rb.inflows,  params.currency);
      const outflows = Money.of(rb.outflows, params.currency);
      const gap      = inflows.subtract(outflows);
      runningCumulative = runningCumulative.add(gap);
      return { bucket: rb.bucket, inflows, outflows, gap, cumulativeGap: runningCumulative };
    });

    // Calculate LCR ratio
    const totalHQLA = params.lcrComponents.hqlaLevel1
      .add(params.lcrComponents.hqlaLevel2A)
      .add(params.lcrComponents.hqlaLevel2B);
    const lcrRatio = params.lcrComponents.netCashOutflows30d.toNumber() > 0
      ? (totalHQLA.toNumber() / params.lcrComponents.netCashOutflows30d.toNumber()) * 100
      : 999;
    const lcr: LCRComponents = {
      ...params.lcrComponents,
      totalHQLA,
      lcrRatio,
      minimumRequired: 100,
      isCompliant: lcrRatio >= 100,
    };

    // Calculate NSFR ratio
    const nsfrRatio = params.nsfrComponents.requiredStableFunding.toNumber() > 0
      ? (params.nsfrComponents.availableStableFunding.toNumber() /
         params.nsfrComponents.requiredStableFunding.toNumber()) * 100
      : 999;
    const nsfr: NSFRComponents = {
      ...params.nsfrComponents,
      nsfrRatio,
      isCompliant: nsfrRatio >= 100,
    };

    return new LiquidityGapReport({
      id: randomUUID(),
      asOfDate: params.asOfDate,
      scenario: params.scenario,
      currency: params.currency,
      buckets,
      lcr,
      nsfr,
      tenantId: params.tenantId,
    });
  }

  pullDomainEvents(): DomainEvent[] {
    const events = [...this._domainEvents];
    this._domainEvents.length = 0;
    return events;
  }
}
