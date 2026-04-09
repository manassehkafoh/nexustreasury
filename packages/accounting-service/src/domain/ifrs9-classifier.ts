/**
 * @module accounting-service/domain/ifrs9-classifier
 *
 * IFRS 9 Classification Engine — determines the measurement category
 * for every financial instrument booked in NexusTreasury.
 *
 * Classification is a two-step process:
 *  Step 1: SPPI Test — do contractual cash flows represent solely payments
 *          of principal and interest (SPPI) on the principal outstanding?
 *  Step 2: Business Model Test — HTC, HTC+Sell, or Other?
 *
 * Decision matrix:
 * ┌──────────────┬────────────────┬──────────────────────┐
 * │ SPPI Pass?   │ Business Model │ Category             │
 * ├──────────────┼────────────────┼──────────────────────┤
 * │ Yes          │ HTC            │ Amortised Cost (AMC) │
 * │ Yes          │ HTC + Sell     │ FVOCI                │
 * │ Yes / No     │ Other          │ FVPL (mandatory)     │
 * │ No           │ Any            │ FVPL (mandatory)     │
 * │ Equity inst  │ Designated     │ FVOCI (equity)       │
 * └──────────────┴────────────────┴──────────────────────┘
 *
 * Configurable overrides: a tenant may designate specific instruments
 * to FVPL via the Fair Value Option (FVO) under IFRS 9 §4.1.5.
 *
 * AI/ML hook: InstrumentTextClassifier can predict SPPI pass/fail
 * from instrument term sheet text — useful for complex structured products.
 *
 * @see IFRS 9 §§ 4.1.1–4.1.5 — Classification of financial assets
 * @see IFRS 9 §§ B4.1.1–B4.1.26 — Application guidance on SPPI
 */

import { AssetClass } from '@nexustreasury/domain';
import { BusinessModel, IFRS9Category } from './value-objects.js';

// ── Input ─────────────────────────────────────────────────────────────────────

export interface ClassificationInput {
  /** Primary asset class from the trade */
  assetClass: AssetClass;
  /**
   * Sub-type within the asset class:
   *   FX: 'SPOT' | 'FORWARD' | 'OPTION' | 'NDF' | 'SWAP'
   *   FIXED_INCOME: 'BOND' | 'T_BILL' | 'CD' | 'CP' | 'STRUCTURED'
   *   MONEY_MARKET: 'DEPOSIT' | 'LOAN' | 'CD'
   *   IRD: 'IRS' | 'FRA' | 'CCS' | 'CAP' | 'FLOOR' | 'SWAPTION'
   *   EQUITY: 'STOCK' | 'ETF' | 'WARRANT'
   */
  instrumentType: string;
  /** Business model the instrument is managed under */
  businessModel: BusinessModel;
  /** True if this is an equity instrument designated to FVOCI on initial recognition */
  equityFVOCIDesignation?: boolean;
  /** True if Fair Value Option elected under IFRS 9 §4.1.5 */
  fvoElected?: boolean;
  /** Override provided by tenant configuration (highest priority) */
  tenantOverride?: IFRS9Category;
}

// ── Output ────────────────────────────────────────────────────────────────────

export interface ClassificationResult {
  category: IFRS9Category;
  sppiPass: boolean;
  businessModel: BusinessModel;
  rationale: string;
  /** Account codes in the standard CoA to use for asset and liability entries */
  assetAccountCode?: string;
  liabilityAccountCode?: string;
  /** AI/ML classification confidence (0–1) if ML classifier was used */
  mlConfidence?: number;
}

// ── AI/ML Hook ────────────────────────────────────────────────────────────────

/**
 * Optional ML interface for predicting SPPI pass/fail from instrument terms.
 * Useful for structured products and complex instruments where rule-based
 * SPPI analysis is inconclusive.
 *
 * @example
 * const classifier: InstrumentTextClassifier = {
 *   predict: async (text) => mlModel.classify(text),
 * };
 */
export interface InstrumentTextClassifier {
  predict(instrumentDescription: string): Promise<{ sppiPass: boolean; confidence: number }>;
}

// ── Classifier ────────────────────────────────────────────────────────────────

export class IFRS9Classifier {
  private readonly mlClassifier?: InstrumentTextClassifier;

  constructor(mlClassifier?: InstrumentTextClassifier) {
    this.mlClassifier = mlClassifier;
  }

  /**
   * Classify a financial instrument synchronously using rule-based logic.
   * For complex structured products, use classifyAsync() to invoke the ML hook.
   */
  classify(input: ClassificationInput): ClassificationResult {
    // Tenant override takes highest priority (configurable at tenant level)
    if (input.tenantOverride) {
      return this.buildResult(input.tenantOverride, input, 'Tenant configuration override');
    }

    // FVO election: instrument designated to FVPL at initial recognition
    if (input.fvoElected) {
      return this.buildResult(
        IFRS9Category.FVPL,
        input,
        'Fair Value Option elected under IFRS 9 §4.1.5',
      );
    }

    // Equity — FVOCI designation or mandatory FVPL
    if (input.assetClass === AssetClass.EQUITY) {
      if (input.equityFVOCIDesignation) {
        return this.buildResult(
          IFRS9Category.FVOCI_EQUITY,
          input,
          'Equity instrument designated at FVOCI under IFRS 9 §4.1.4',
        );
      }
      return this.buildResult(
        IFRS9Category.FVPL_MANDATORY,
        input,
        'Equity instrument — FVPL mandatory unless FVOCI designation elected',
      );
    }

    // Derivatives — always FVPL mandatory (SPPI fail — leveraged returns)
    if (this.isDerivative(input.assetClass, input.instrumentType)) {
      return this.buildResult(
        IFRS9Category.FVPL_MANDATORY,
        input,
        'Derivative instrument — SPPI test fails (non-linear / leveraged cash flows)',
      );
    }

    // SPPI analysis for non-derivative instruments
    const sppiPass = this.testSPPI(input.assetClass, input.instrumentType);

    if (!sppiPass) {
      return this.buildResult(
        IFRS9Category.FVPL_MANDATORY,
        input,
        'SPPI test failed — cash flows are not solely principal and interest',
      );
    }

    // Business model determines AMC vs FVOCI for SPPI-passing instruments
    switch (input.businessModel) {
      case BusinessModel.HOLD_TO_COLLECT:
        return this.buildResult(
          IFRS9Category.AMORTISED_COST,
          input,
          'SPPI test passed + Hold-to-Collect business model → Amortised Cost',
        );
      case BusinessModel.HOLD_TO_COLLECT_AND_SELL:
        return this.buildResult(
          IFRS9Category.FVOCI,
          input,
          'SPPI test passed + Hold-to-Collect-and-Sell business model → FVOCI',
        );
      case BusinessModel.OTHER:
      default:
        return this.buildResult(
          IFRS9Category.FVPL_MANDATORY,
          input,
          'SPPI test passed but business model is "Other" → FVPL mandatory',
        );
    }
  }

  /**
   * Async variant — invokes the ML classifier for complex structured products
   * where the synchronous rule-based logic is inconclusive.
   */
  async classifyAsync(
    input: ClassificationInput,
    instrumentDescription?: string,
  ): Promise<ClassificationResult> {
    // Use ML for structured products if classifier is configured
    if (
      this.mlClassifier &&
      instrumentDescription &&
      this.isComplexInstrument(input.instrumentType)
    ) {
      const mlResult = await this.mlClassifier.predict(instrumentDescription);
      if (mlResult.confidence > 0.85) {
        const category = mlResult.sppiPass
          ? this.categoryFromBusinessModel(input.businessModel)
          : IFRS9Category.FVPL_MANDATORY;
        return {
          ...this.buildResult(category, input, 'ML classifier prediction'),
          sppiPass: mlResult.sppiPass,
          mlConfidence: mlResult.confidence,
        };
      }
    }
    // Fall back to synchronous rule-based classification
    return this.classify(input);
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  /**
   * SPPI test for standard instruments.
   * Returns true if contractual cash flows are solely P+I on the principal outstanding.
   *
   * Pass:  Fixed-rate bonds, floating-rate bonds with simple LIBOR/RFR coupon,
   *        money market deposits and loans, repos (fixed rate)
   * Fail:  Options, equity instruments, convertible bonds, structured notes,
   *        inverse floaters, PIK instruments, non-recourse loans
   */
  private testSPPI(assetClass: AssetClass, instrumentType: string): boolean {
    const type = instrumentType.toUpperCase();

    switch (assetClass) {
      case AssetClass.FIXED_INCOME:
        // Standard bonds, T-bills, CDs, CPs pass SPPI
        // Structured notes, convertibles, PIKs fail
        return !['STRUCTURED', 'CONVERTIBLE', 'PIK', 'CLN'].includes(type);

      case AssetClass.MONEY_MARKET:
        // Simple deposits and loans with fixed/floating rate pass
        return ['DEPOSIT', 'LOAN', 'CD', 'T_BILL', 'CP'].includes(type);

      case AssetClass.REPO:
        // Repos are collateralised lending — SPPI pass
        return true;

      case AssetClass.FX:
        // FX instruments are not SPPI (rate-contingent, not P+I)
        return false;

      case AssetClass.INTEREST_RATE_DERIVATIVE:
        // IRS / FRA / CCS are derivatives — SPPI fail (leveraged)
        return false;

      case AssetClass.EQUITY:
      case AssetClass.COMMODITY:
        return false;

      case AssetClass.ISLAMIC_FINANCE:
        // Murabaha (cost-plus) and Wakala (agency) are SPPI-like
        return ['MURABAHA', 'WAKALA', 'IJARA'].includes(type);

      default:
        return false;
    }
  }

  /** True if the instrument is a derivative (FVPL mandatory) */
  private isDerivative(assetClass: AssetClass, instrumentType: string): boolean {
    if (assetClass === AssetClass.INTEREST_RATE_DERIVATIVE) return true;
    if (assetClass === AssetClass.EQUITY && instrumentType.toUpperCase() === 'WARRANT') return true;
    if (assetClass === AssetClass.FX) {
      const type = instrumentType.toUpperCase();
      return ['OPTION', 'SWAP', 'NDF'].includes(type);
    }
    return false;
  }

  /** Complex instruments that benefit from ML classification */
  private isComplexInstrument(instrumentType: string): boolean {
    const type = instrumentType.toUpperCase();
    return ['STRUCTURED', 'CONVERTIBLE', 'CLN', 'TRS', 'HYBRID'].includes(type);
  }

  private categoryFromBusinessModel(bm: BusinessModel): IFRS9Category {
    if (bm === BusinessModel.HOLD_TO_COLLECT) return IFRS9Category.AMORTISED_COST;
    if (bm === BusinessModel.HOLD_TO_COLLECT_AND_SELL) return IFRS9Category.FVOCI;
    return IFRS9Category.FVPL_MANDATORY;
  }

  private buildResult(
    category: IFRS9Category,
    input: ClassificationInput,
    rationale: string,
  ): ClassificationResult {
    const sppiPass = this.testSPPI(input.assetClass, input.instrumentType);
    return {
      category,
      sppiPass,
      businessModel: input.businessModel,
      rationale,
      assetAccountCode: this.assetAccountCode(category, input.assetClass),
      liabilityAccountCode: this.liabilityAccountCode(category, input.assetClass),
    };
  }

  /** Map IFRS9 category to the standard CoA asset account code */
  private assetAccountCode(cat: IFRS9Category, assetClass: AssetClass): string | undefined {
    if (assetClass === AssetClass.FIXED_INCOME) {
      if (cat === IFRS9Category.AMORTISED_COST) return '1300';
      if (cat === IFRS9Category.FVOCI) return '1310';
      if (cat === IFRS9Category.FVPL_MANDATORY) return '1320';
    }
    if (assetClass === AssetClass.MONEY_MARKET) return '1500';
    if (assetClass === AssetClass.REPO) return '1600';
    if (assetClass === AssetClass.FX) {
      if (cat === IFRS9Category.AMORTISED_COST) return '1200';
      return '1210';
    }
    if (assetClass === AssetClass.INTEREST_RATE_DERIVATIVE) return '1400';
    return undefined;
  }

  /** Map to liability account code (for negative MTM positions) */
  private liabilityAccountCode(cat: IFRS9Category, assetClass: AssetClass): string | undefined {
    if (assetClass === AssetClass.FX) return '2100';
    if (assetClass === AssetClass.INTEREST_RATE_DERIVATIVE) return '2200';
    if (assetClass === AssetClass.MONEY_MARKET) return '2300';
    return undefined;
  }
}
