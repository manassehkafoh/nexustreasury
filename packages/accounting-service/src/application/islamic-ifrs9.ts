/**
 * @module IslamicIFRS9Extension
 * @description IFRS9 extensions for Islamic Finance instruments — Sprint 9.3.
 *
 * Maps AAOIFI-classified instruments to IFRS9 ECL stages and accounting
 * treatment. Under AAOIFI FAS 30 and IFRS9 converged standards:
 *
 *  Murabaha / Ijara     → Amortised Cost (IFRS9 4.1.2)
 *  Diminishing Musharaka→ Equity-like ECL (IFRS9 5.5)
 *  Sukuk (investment)   → FVOCI or AC depending on business model
 *
 * @see Sprint 9.3
 */

export const IslamicInstrumentType = {
  MURABAHA: 'MURABAHA',
  IJARA: 'IJARA',
  DIMINISHING_MUSHARAKA: 'DIMINISHING_MUSHARAKA',
  SUKUK_IJARA: 'SUKUK_IJARA',
  MUDARABA: 'MUDARABA',
  WAKALA: 'WAKALA',
} as const;
export type IslamicInstrumentType =
  (typeof IslamicInstrumentType)[keyof typeof IslamicInstrumentType];

export const IFRS9Classification = {
  AMORTISED_COST: 'AMORTISED_COST',
  FVOCI: 'FVOCI',
  FVPL: 'FVPL',
} as const;
export type IFRS9Classification = (typeof IFRS9Classification)[keyof typeof IFRS9Classification];

export interface IslamicECLInput {
  readonly instrumentType: IslamicInstrumentType;
  readonly outstandingAmount: number;
  readonly currency: string;
  readonly profitRate: number; // annualised Islamic profit rate
  readonly tenorYears: number;
  readonly daysPastProfit: number; // equivalent of DPD for Islamic finance
  readonly isNonPerforming: boolean;
  readonly recoveryRate: number;
  readonly pd12Month: number;
  readonly pdLifetime: number;
}

export interface IslamicECLResult {
  readonly ifrs9Classification: IFRS9Classification;
  readonly stage: 1 | 2 | 3;
  readonly ecl: number;
  readonly aaoifiStandard: string;
  readonly stagingRationale: string;
  readonly processingMs: number;
}

/** IFRS9 classifications by Islamic instrument type (AAOIFI convergence). */
const INSTRUMENT_CLASSIFICATION: Record<IslamicInstrumentType, IFRS9Classification> = {
  MURABAHA: IFRS9Classification.AMORTISED_COST,
  IJARA: IFRS9Classification.AMORTISED_COST,
  DIMINISHING_MUSHARAKA: IFRS9Classification.AMORTISED_COST,
  SUKUK_IJARA: IFRS9Classification.FVOCI,
  MUDARABA: IFRS9Classification.FVPL,
  WAKALA: IFRS9Classification.AMORTISED_COST,
};

export class IslamicIFRS9Extension {
  calculateECL(input: IslamicECLInput): IslamicECLResult {
    const t0 = performance.now();
    const classification = INSTRUMENT_CLASSIFICATION[input.instrumentType];
    const { stage, rationale } = this._assignStage(input);

    const pd = stage === 1 ? input.pd12Month : input.pdLifetime;
    const lgd = 1 - input.recoveryRate;
    const ead = input.outstandingAmount;
    const ecl = pd * lgd * ead;

    return {
      ifrs9Classification: classification,
      stage,
      ecl: parseFloat(ecl.toFixed(2)),
      aaoifiStandard: this._getStandard(input.instrumentType),
      stagingRationale: rationale,
      processingMs: parseFloat((performance.now() - t0).toFixed(2)),
    };
  }

  private _assignStage(input: IslamicECLInput): { stage: 1 | 2 | 3; rationale: string } {
    if (input.isNonPerforming || input.daysPastProfit >= 90) {
      return {
        stage: 3,
        rationale: `Non-performing Islamic asset: DPP=${input.daysPastProfit}d. Stage 3 — lifetime ECL.`,
      };
    }
    if (input.daysPastProfit >= 30 || input.pd12Month > 0.05) {
      return {
        stage: 2,
        rationale: `Significant increase in credit risk: DPP=${input.daysPastProfit}d or PD>5%. Stage 2 — lifetime ECL.`,
      };
    }
    return { stage: 1, rationale: 'Performing asset. Stage 1 — 12-month ECL.' };
  }

  private _getStandard(type: IslamicInstrumentType): string {
    const map: Record<IslamicInstrumentType, string> = {
      MURABAHA: 'AAOIFI FAS 28, IFRS9 4.1.2 (Amortised Cost)',
      IJARA: 'AAOIFI SS-9, IFRS9 4.1.2 (Amortised Cost)',
      DIMINISHING_MUSHARAKA: 'AAOIFI SS-12, IFRS9 5.5 (Equity-like ECL)',
      SUKUK_IJARA: 'AAOIFI FAS 30, IFRS9 4.1.2A (FVOCI)',
      MUDARABA: 'AAOIFI SS-13, IFRS9 4.1.4 (FVPL)',
      WAKALA: 'AAOIFI SS-23, IFRS9 4.1.2 (Amortised Cost)',
    };
    return map[type] ?? 'AAOIFI / IFRS9 convergence';
  }
}
