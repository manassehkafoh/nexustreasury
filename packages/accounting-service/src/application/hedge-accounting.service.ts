/**
 * @module accounting-service/application/hedge-accounting.service
 *
 * Hedge Accounting Service — IFRS 9 §6 / IAS 39 implementation.
 *
 * Hedge accounting allows the gains/losses on a hedging instrument to be
 * recognised in the same period as the losses/gains on the hedged item,
 * reducing artificial P&L volatility.
 *
 * Three hedge relationship types:
 *  1. Fair Value Hedge (FVH): hedges the FV of an asset/liability
 *     → Both hedged item AND hedging instrument FV changes go to P&L
 *
 *  2. Cash Flow Hedge (CFH): hedges variability in future cash flows
 *     → Effective portion of instrument FV change → OCI
 *     → Ineffective portion → P&L
 *     → Reclassified from OCI to P&L when hedged cash flow affects P&L
 *
 *  3. Net Investment Hedge (NIH): hedges FX exposure on a foreign subsidiary
 *     → Effective portion → OCI (translation reserve)
 *     → Ineffective portion → P&L
 *
 * Effectiveness testing (prospective + retrospective):
 *  - Dollar-offset: ratio = ΔFV_instrument / ΔFV_hedgedItem ∈ [80%, 125%]
 *  - Regression: R² ≥ 0.80, slope ∈ [0.80, 1.25] per IAS 39 AG105
 *
 * AI/ML hook: HedgeEffectivenessMLModel — uses an ML model trained on
 * historical price data to provide a forward-looking effectiveness estimate.
 * Useful when historical data is sparse (new instruments, EM currencies).
 */

import { EntryDirection, HedgeType, EffectivenessMethod } from '../domain/value-objects.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HedgeRelationship {
  hedgeId: string;
  hedgeType: HedgeType;
  hedgedItemId: string; // trade or position ID
  hedgingInstrumentId: string; // derivative trade ID
  notional: number;
  currency: string;
  effectivenessMethod: EffectivenessMethod;
  /** Hedge designation date */
  designationDate: Date;
  /** Optional: hedge ratio (1.0 = fully hedged) */
  hedgeRatio: number;
}

export interface EffectivenessTestInput {
  hedgeRelationship: HedgeRelationship;
  /** Fair value change of hedging instrument in the period */
  instrumentFVChange: number;
  /** Fair value change of hedged item in the period */
  hedgedItemFVChange: number;
  /**
   * Historical pairs for regression analysis.
   * [instrumentFVChange, hedgedItemFVChange] for each past period.
   */
  historicalPairs?: [number, number][];
}

export interface EffectivenessTestResult {
  isHighlyEffective: boolean;
  effectivenessRatio: number; // for dollar-offset
  rSquared?: number; // for regression
  slope?: number; // for regression
  effectivePortion: number; // goes to OCI (CFH/NIH) or P&L adj (FVH)
  ineffectivePortion: number; // always to P&L
  journalEntries: HedgeJournalEntrySpec[];
}

export interface HedgeJournalEntrySpec {
  debitAccount: string;
  creditAccount: string;
  amount: number;
  currency: string;
  description: string;
}

// ── AI/ML Effectiveness Hook ──────────────────────────────────────────────────

export interface HedgeEffectivenessMLModel {
  predict(params: {
    hedgeType: HedgeType;
    instrumentType: string;
    hedgedItemType: string;
    historicalPairs: [number, number][];
  }): Promise<{ expectedR2: number; confidence: number }>;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class HedgeAccountingService {
  private readonly mlModel?: HedgeEffectivenessMLModel;

  constructor(mlModel?: HedgeEffectivenessMLModel) {
    this.mlModel = mlModel;
  }

  /**
   * Test hedge effectiveness and generate the appropriate journal entries.
   *
   * Highly effective = ratio ∈ [80%, 125%] (IAS 39.88 / IFRS 9 §B6.4.2)
   * If not highly effective → discontinue hedge accounting.
   */
  testEffectiveness(input: EffectivenessTestInput): EffectivenessTestResult {
    const { hedgeRelationship, instrumentFVChange, hedgedItemFVChange } = input;

    switch (hedgeRelationship.effectivenessMethod) {
      case EffectivenessMethod.DOLLAR_OFFSET:
        return this.dollarOffsetTest(hedgeRelationship, instrumentFVChange, hedgedItemFVChange);

      case EffectivenessMethod.REGRESSION:
        if (!input.historicalPairs || input.historicalPairs.length < 8) {
          // Fall back to dollar-offset if insufficient data points
          return this.dollarOffsetTest(hedgeRelationship, instrumentFVChange, hedgedItemFVChange);
        }
        return this.regressionTest(hedgeRelationship, input.historicalPairs, instrumentFVChange);

      default:
        return this.dollarOffsetTest(hedgeRelationship, instrumentFVChange, hedgedItemFVChange);
    }
  }

  // ── Dollar-Offset Method ──────────────────────────────────────────────────

  private dollarOffsetTest(
    rel: HedgeRelationship,
    instrumentChange: number,
    hedgedItemChange: number,
  ): EffectivenessTestResult {
    // Ratio = -ΔFV_instrument / ΔFV_hedgedItem (negative because hedge offsets)
    const ratio = hedgedItemChange !== 0 ? -instrumentChange / hedgedItemChange : 0;

    const isHighlyEffective = ratio >= 0.8 && ratio <= 1.25;

    // Split instrument FV change into effective and ineffective portions
    const { effective, ineffective } = this.splitPortions(
      instrumentChange,
      hedgedItemChange,
      ratio,
      isHighlyEffective,
    );

    return {
      isHighlyEffective,
      effectivenessRatio: ratio,
      effectivePortion: effective,
      ineffectivePortion: ineffective,
      journalEntries: this.buildJournalEntries(rel, effective, ineffective),
    };
  }

  // ── Linear Regression Method ──────────────────────────────────────────────

  /**
   * OLS regression: y = α + β × x
   * x = hedged item FV change, y = instrument FV change
   * Highly effective if: R² ≥ 0.80 AND slope ∈ [−1.25, −0.80]
   */
  private regressionTest(
    rel: HedgeRelationship,
    pairs: [number, number][],
    currentChange: number,
  ): EffectivenessTestResult {
    const n = pairs.length;
    const xs = pairs.map((p) => p[1]); // hedged item changes
    const ys = pairs.map((p) => p[0]); // instrument changes

    const xMean = xs.reduce((s, x) => s + x, 0) / n;
    const yMean = ys.reduce((s, y) => s + y, 0) / n;

    const ssXX = xs.reduce((s, x) => s + (x - xMean) ** 2, 0);
    const ssXY = xs.reduce((s, x, i) => s + (x - xMean) * (ys[i] - yMean), 0);
    const ssYY = ys.reduce((s, y) => s + (y - yMean) ** 2, 0);

    const slope = ssXX !== 0 ? ssXY / ssXX : 0;
    const rSquared = ssXX !== 0 && ssYY !== 0 ? ssXY ** 2 / (ssXX * ssYY) : 0;

    const isHighlyEffective = rSquared >= 0.8 && slope >= -1.25 && slope <= -0.8;

    const ratio = slope !== 0 ? -slope : 0;
    const { effective, ineffective } = this.splitPortions(
      currentChange,
      currentChange / (-slope || 1),
      ratio,
      isHighlyEffective,
    );

    return {
      isHighlyEffective,
      effectivenessRatio: ratio,
      rSquared,
      slope,
      effectivePortion: effective,
      ineffectivePortion: ineffective,
      journalEntries: this.buildJournalEntries(rel, effective, ineffective),
    };
  }

  // ── Portion Split ─────────────────────────────────────────────────────────

  private splitPortions(
    instrumentChange: number,
    hedgedItemChange: number,
    ratio: number,
    isEffective: boolean,
  ): { effective: number; ineffective: number } {
    if (!isEffective) {
      return { effective: 0, ineffective: Math.abs(instrumentChange) };
    }
    // Effective = min(|ΔFV_instrument|, |ΔFV_hedgedItem|) per IAS 39.AG106
    const maxEffective = Math.min(Math.abs(instrumentChange), Math.abs(hedgedItemChange));
    const effective = maxEffective;
    const ineffective = Math.abs(instrumentChange) - effective;
    return { effective, ineffective };
  }

  // ── Journal Entry Generation ──────────────────────────────────────────────

  private buildJournalEntries(
    rel: HedgeRelationship,
    effective: number,
    ineffective: number,
  ): HedgeJournalEntrySpec[] {
    const entries: HedgeJournalEntrySpec[] = [];
    const ccy = rel.currency;

    switch (rel.hedgeType) {
      case HedgeType.FAIR_VALUE:
        // FVH: both hedged item FV adj and instrument FV change go to P&L
        if (effective > 0) {
          entries.push({
            debitAccount: '1400',
            creditAccount: '4400',
            amount: effective,
            currency: ccy,
            description: 'FVH — effective portion: hedging instrument FV gain',
          });
        }
        break;

      case HedgeType.CASH_FLOW:
        // CFH: effective portion → OCI; ineffective → P&L
        if (effective > 0) {
          entries.push({
            debitAccount: '1400',
            creditAccount: '6200',
            amount: effective,
            currency: ccy,
            description: 'CFH — effective portion: instrument FV change → OCI',
          });
        }
        if (ineffective > 0) {
          entries.push({
            debitAccount: '1400',
            creditAccount: '4400',
            amount: ineffective,
            currency: ccy,
            description: 'CFH — ineffective portion → P&L',
          });
        }
        break;

      case HedgeType.NET_INVESTMENT:
        // NIH: effective portion → OCI (translation reserve); ineffective → P&L
        if (effective > 0) {
          entries.push({
            debitAccount: '1400',
            creditAccount: '3200',
            amount: effective,
            currency: ccy,
            description: 'NIH — effective portion → OCI translation reserve',
          });
        }
        if (ineffective > 0) {
          entries.push({
            debitAccount: '1400',
            creditAccount: '4400',
            amount: ineffective,
            currency: ccy,
            description: 'NIH — ineffective portion → P&L',
          });
        }
        break;
    }

    return entries;
  }
}
