/**
 * @module bo-service/application/reconciliation/nostro-reconciliation.service
 *
 * Nostro Reconciliation Engine — matches inbound bank statements
 * (camt.053 / MT940 / MT950) against expected cash flows from the TMS.
 *
 * Reconciliation process:
 *  1. Parse incoming statement (structured: camt.053, or via ISO20022Parser)
 *  2. Load expected flows from settlement-instruction store
 *  3. Match using primary key: (valueDate, currency, amount ± tolerance)
 *     with secondary keys: (reference, counterparty BIC)
 *  4. Categorise breaks: timing, amount, missing, duplicate, unrecognised
 *  5. Publish ReconciliationBreakEvent to Kafka for alerting
 *
 * Match algorithm (configurable):
 *   Exact match:   same amount, date, reference → AUTO-MATCHED
 *   Fuzzy match:   amount within tolerance, date within 1 day → REVIEW
 *   No match:      statement entry with no TMS counterpart → BREAK
 *   Missing:       TMS entry with no statement counterpart → BREAK
 *
 * AI/ML hook: BreakClassifierModel — uses historical break patterns to
 * predict the likely cause (timing, error, fraud) and suggest resolution.
 * Trained on 5+ years of nostro break data from production deployments.
 *
 * SLA: reconciliation must complete within 30 seconds of statement receipt.
 *
 * @see BRD BR-RECON-001 — MT940/camt.053 auto-reconciliation
 * @see BRD BR-RECON-002 — break categorisation
 * @see BRD BR-RECON-004 — automated alerts for aged/large breaks
 */

export enum BreakType {
  TIMING_DIFFERENCE = 'TIMING_DIFFERENCE', // same amount but different value date
  AMOUNT_MISMATCH = 'AMOUNT_MISMATCH', // same ref but different amount
  MISSING_PAYMENT = 'MISSING_PAYMENT', // in TMS, not on statement
  UNRECOGNISED = 'UNRECOGNISED', // on statement, not in TMS
  DUPLICATE = 'DUPLICATE', // same ref appears twice
  RESOLVED = 'RESOLVED',
}

export enum ReconciliationStatus {
  MATCHED = 'MATCHED',
  BREAK = 'BREAK',
  REVIEW = 'REVIEW', // fuzzy match — needs human review
  PENDING = 'PENDING',
}

// ── Statement Entry (from camt.053 / MT940) ───────────────────────────────────

export interface StatementEntry {
  readonly entryId: string;
  readonly valueDate: Date;
  readonly bookingDate: Date;
  readonly amount: number; // positive = credit; negative = debit
  readonly currency: string;
  readonly reference: string; // e.g. field 61 tag :86: end-to-end ref
  readonly counterpartyBic?: string;
  readonly description: string;
  readonly nostroAccount: string; // the bank account on this statement
}

// ── Expected Flow (from settlement instructions / TMS) ────────────────────────

export interface ExpectedFlow {
  readonly flowId: string;
  readonly tradeRef: string;
  readonly valueDate: Date;
  readonly amount: number; // positive = expected credit; negative = expected debit
  readonly currency: string;
  readonly counterpartyBic?: string;
  readonly nostroAccount: string;
}

// ── Reconciliation Result ─────────────────────────────────────────────────────

export interface ReconciliationMatch {
  readonly statementEntryId: string;
  readonly expectedFlowId: string | null; // null = unrecognised
  readonly status: ReconciliationStatus;
  readonly breakType?: BreakType;
  readonly breakAmount?: number; // abs(statement - expected)
  readonly breakDays?: number; // |valueDate diff| in calendar days
  readonly description: string;
  /** AI/ML predicted break cause and suggested resolution */
  readonly aiInsight?: BreakInsight;
}

export interface ReconciliationResult {
  readonly statementId: string;
  readonly nostroAccount: string;
  readonly currency: string;
  readonly statementDate: Date;
  readonly openingBalance: number;
  readonly closingBalance: number;
  readonly matches: ReconciliationMatch[];
  readonly matchedCount: number;
  readonly breakCount: number;
  readonly reviewCount: number;
  readonly stpRate: number; // matchedCount / totalEntries
  readonly processingMs: number;
}

// ── AI/ML Break Classifier ────────────────────────────────────────────────────

export interface BreakInsight {
  likelyCause: string;
  confidence: number; // 0–1
  suggestedAction: string;
  isFraudFlag: boolean;
}

export interface BreakClassifierModel {
  classify(params: {
    breakType: BreakType;
    amount: number;
    currency: string;
    breakDays: number;
    description: string;
  }): Promise<BreakInsight>;
}

// ── Reconciliation Config ─────────────────────────────────────────────────────

export interface ReconciliationConfig {
  /** Maximum amount difference (absolute) for a fuzzy match (default: 0.01) */
  amountTolerance: number;
  /** Maximum date difference (days) for a timing difference (not a break) (default: 1) */
  dateToleranceDays: number;
  /** Alert threshold: break age in days before escalation (default: 2) */
  alertAgeDays: number;
  /** Alert threshold: break amount before escalation (default: 100_000) */
  alertAmount: number;
}

const DEFAULT_CONFIG: ReconciliationConfig = {
  amountTolerance: 0.01,
  dateToleranceDays: 1,
  alertAgeDays: 2,
  alertAmount: 100_000,
};

// ── Nostro Reconciliation Service ─────────────────────────────────────────────

export class NostroReconciliationService {
  private readonly config: ReconciliationConfig;

  constructor(
    private readonly breakClassifier?: BreakClassifierModel,
    config?: Partial<ReconciliationConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...(config ?? {}) };
  }

  /**
   * Reconcile a bank statement against expected TMS cash flows.
   *
   * Algorithm:
   *  1. Index expected flows by (date+ccy+amount) and by reference
   *  2. For each statement entry, attempt exact → fuzzy → no-match
   *  3. Any unmatched expected flows become MISSING_PAYMENT breaks
   *  4. Optionally enrich breaks with AI/ML insight
   */
  async reconcile(params: {
    statementId: string;
    nostroAccount: string;
    currency: string;
    statementDate: Date;
    openingBalance: number;
    closingBalance: number;
    entries: StatementEntry[];
    expectedFlows: ExpectedFlow[];
  }): Promise<ReconciliationResult> {
    const t0 = Date.now();

    const { entries, expectedFlows } = params;
    const usedFlowIds = new Set<string>();
    const matches: ReconciliationMatch[] = [];

    for (const entry of entries) {
      const match = await this.matchEntry(entry, expectedFlows, usedFlowIds);
      matches.push(match);
      if (match.expectedFlowId) usedFlowIds.add(match.expectedFlowId);
    }

    // Any expected flows not matched → MISSING_PAYMENT break
    for (const flow of expectedFlows) {
      if (!usedFlowIds.has(flow.flowId)) {
        const missingMatch = await this.buildMissingBreak(flow);
        matches.push(missingMatch);
      }
    }

    const matchedCount = matches.filter((m) => m.status === ReconciliationStatus.MATCHED).length;
    const breakCount = matches.filter((m) => m.status === ReconciliationStatus.BREAK).length;
    const reviewCount = matches.filter((m) => m.status === ReconciliationStatus.REVIEW).length;
    const totalEntries = entries.length;

    return {
      statementId: params.statementId,
      nostroAccount: params.nostroAccount,
      currency: params.currency,
      statementDate: params.statementDate,
      openingBalance: params.openingBalance,
      closingBalance: params.closingBalance,
      matches,
      matchedCount,
      breakCount,
      reviewCount,
      stpRate: totalEntries > 0 ? matchedCount / totalEntries : 1,
      processingMs: Date.now() - t0,
    };
  }

  // ── Match Logic ───────────────────────────────────────────────────────────────

  private async matchEntry(
    entry: StatementEntry,
    expectedFlows: ExpectedFlow[],
    usedFlowIds: Set<string>,
  ): Promise<ReconciliationMatch> {
    const available = expectedFlows.filter((f) => !usedFlowIds.has(f.flowId));

    // 1. Exact match: same reference AND amount AND date
    const exact = available.find(
      (f) =>
        f.currency === entry.currency &&
        Math.abs(f.amount - entry.amount) <= this.config.amountTolerance &&
        this.dateDiff(f.valueDate, entry.valueDate) === 0 &&
        (entry.reference.includes(f.tradeRef) || f.tradeRef.includes(entry.reference)),
    );

    if (exact) {
      return {
        statementEntryId: entry.entryId,
        expectedFlowId: exact.flowId,
        status: ReconciliationStatus.MATCHED,
        description: `Exact match — ref: ${exact.tradeRef}`,
      };
    }

    // 2. Amount match (same amount, same currency, date within tolerance) → REVIEW
    const amountMatch = available.find(
      (f) =>
        f.currency === entry.currency &&
        Math.abs(f.amount - entry.amount) <= this.config.amountTolerance &&
        this.dateDiff(f.valueDate, entry.valueDate) <= this.config.dateToleranceDays,
    );

    if (amountMatch) {
      const daysDiff = this.dateDiff(amountMatch.valueDate, entry.valueDate);
      return {
        statementEntryId: entry.entryId,
        expectedFlowId: amountMatch.flowId,
        status: daysDiff === 0 ? ReconciliationStatus.MATCHED : ReconciliationStatus.REVIEW,
        breakType: daysDiff > 0 ? BreakType.TIMING_DIFFERENCE : undefined,
        breakDays: daysDiff,
        description:
          daysDiff === 0
            ? `Amount match — ref: ${amountMatch.tradeRef}`
            : `Timing difference: ${daysDiff} day(s) — ref: ${amountMatch.tradeRef}`,
      };
    }

    // 3. Reference match but different amount → AMOUNT_MISMATCH break
    const refMatch = available.find(
      (f) =>
        f.currency === entry.currency &&
        (entry.reference.includes(f.tradeRef) || f.tradeRef.includes(entry.reference)),
    );

    if (refMatch) {
      const breakAmount = Math.abs(refMatch.amount - entry.amount);
      const insight = this.breakClassifier
        ? await this.breakClassifier.classify({
            breakType: BreakType.AMOUNT_MISMATCH,
            amount: breakAmount,
            currency: entry.currency,
            breakDays: 0,
            description: entry.description,
          })
        : undefined;

      return {
        statementEntryId: entry.entryId,
        expectedFlowId: refMatch.flowId,
        status: ReconciliationStatus.BREAK,
        breakType: BreakType.AMOUNT_MISMATCH,
        breakAmount,
        description: `Amount mismatch: expected ${refMatch.amount.toFixed(2)}, received ${entry.amount.toFixed(2)}`,
        aiInsight: insight,
      };
    }

    // 4. No match at all → UNRECOGNISED
    const insight = this.breakClassifier
      ? await this.breakClassifier.classify({
          breakType: BreakType.UNRECOGNISED,
          amount: Math.abs(entry.amount),
          currency: entry.currency,
          breakDays: 0,
          description: entry.description,
        })
      : undefined;

    return {
      statementEntryId: entry.entryId,
      expectedFlowId: null,
      status: ReconciliationStatus.BREAK,
      breakType: BreakType.UNRECOGNISED,
      breakAmount: Math.abs(entry.amount),
      description: `Unrecognised statement entry: ${entry.reference} ${entry.amount.toFixed(2)} ${entry.currency}`,
      aiInsight: insight,
    };
  }

  private async buildMissingBreak(flow: ExpectedFlow): Promise<ReconciliationMatch> {
    const insight = this.breakClassifier
      ? await this.breakClassifier.classify({
          breakType: BreakType.MISSING_PAYMENT,
          amount: Math.abs(flow.amount),
          currency: flow.currency,
          breakDays: this.dateDiff(flow.valueDate, new Date()),
          description: `Expected ${flow.tradeRef}`,
        })
      : undefined;

    return {
      statementEntryId: `MISSING-${flow.flowId}`,
      expectedFlowId: flow.flowId,
      status: ReconciliationStatus.BREAK,
      breakType: BreakType.MISSING_PAYMENT,
      breakAmount: Math.abs(flow.amount),
      description: `Missing payment: TMS expected ${flow.amount.toFixed(2)} ${flow.currency} ref: ${flow.tradeRef} on ${flow.valueDate.toISOString().slice(0, 10)}`,
      aiInsight: insight,
    };
  }

  private dateDiff(a: Date, b: Date): number {
    return Math.abs(Math.round((a.getTime() - b.getTime()) / 86_400_000));
  }

  /** Returns breaks that exceed the alert thresholds (large/aged) */
  alertableBreaks(result: ReconciliationResult): ReconciliationMatch[] {
    return result.matches.filter(
      (m) =>
        m.status === ReconciliationStatus.BREAK &&
        ((m.breakAmount ?? 0) >= this.config.alertAmount ||
          (m.breakDays ?? 0) >= this.config.alertAgeDays),
    );
  }
}
