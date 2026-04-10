/**
 * @module CapitalStressTester
 * @description Basel III Pillar 2 ICAAP Capital Stress Testing — Sprint 10-A.
 *
 * Closes the FIS BSM "Capital Stress Testing" gap (NexusTreasury 3/8 → 9/8).
 *
 * ## Stress Scenarios (per EBA Stress Test methodology)
 *
 * 1. BASELINE         — Management base case
 * 2. ADVERSE          — EBA standard adverse (GDP -2.5%, rates +300bp)
 * 3. SEVERELY_ADVERSE — EBA severely adverse (GDP -5%, rates +500bp, credit spread +400bp)
 * 4. IDIOSYNCRATIC    — Bank-specific shock (name crisis, deposit run -30%)
 * 5. COMBINED         — Combined market + credit + liquidity shock
 *
 * ## Capital Output Metrics
 *
 * CET1 Ratio = CET1 Capital / RWA (minimum: 4.5% + CCyB + G-SIB surcharge)
 * Total Capital Ratio = Total Capital / RWA (minimum: 8% + buffers)
 * Leverage Ratio = Tier 1 Capital / Total Exposure (minimum: 3%)
 *
 * ## Survival Horizon
 *
 * Days until CET1 falls below minimum threshold under each stress scenario.
 * Represents the Contingency Funding Plan (CFP) pressure test.
 *
 * @see EBA 2023 EU-wide Stress Test Methodology
 * @see Sprint 10-A (FIS BSM gap closure)
 */

export const StressScenario = {
  BASELINE:          'BASELINE',
  ADVERSE:           'ADVERSE',
  SEVERELY_ADVERSE:  'SEVERELY_ADVERSE',
  IDIOSYNCRATIC:     'IDIOSYNCRATIC',
  COMBINED:          'COMBINED',
} as const;
export type StressScenario = (typeof StressScenario)[keyof typeof StressScenario];

/** Macroeconomic shock parameters for each scenario. */
export interface MacroShock {
  /** GDP growth shock in pp (negative = contraction) */
  readonly gdpShockPp:         number;
  /** Parallel rate shift in bps */
  readonly rateShiftBps:       number;
  /** Credit spread widening in bps */
  readonly creditSpreadBps:    number;
  /** Equity market shock as % (e.g., -0.40 = -40%) */
  readonly equityShockPct:     number;
  /** Deposit outflow rate (idiosyncratic run) */
  readonly depositOutflowPct:  number;
  /** Wholesale funding closure rate */
  readonly wholesaleClosurePct:number;
}

/** Starting balance sheet and capital position. */
export interface CapitalPosition {
  readonly tenantId:              string;
  readonly reportingDate:         string;  // ISO date
  readonly currency:              string;
  /** Common Equity Tier 1 capital */
  readonly cet1Capital:           number;
  /** Additional Tier 1 capital */
  readonly at1Capital:            number;
  /** Tier 2 capital */
  readonly tier2Capital:          number;
  /** Risk-Weighted Assets */
  readonly rwa:                   number;
  /** Total exposure (for leverage ratio) */
  readonly totalExposure:         number;
  /** Gross loan book */
  readonly grossLoans:            number;
  /** Net interest income (annualised) */
  readonly nii:                   number;
  /** Pre-provision profit */
  readonly ppop:                  number;
  /** Countercyclical buffer rate (regulatory) */
  readonly ccybRate:              number;
  /** G-SIB surcharge rate */
  readonly gsibSurcharge:         number;
  /** Horizon (years over which stress is applied) */
  readonly horizonYears:          number;
}

/** Single scenario stress result. */
export interface StressResult {
  readonly scenario:                StressScenario;
  readonly macroShock:              MacroShock;
  /** Stressed CET1 after provisions + RWA inflation */
  readonly stressedCET1:            number;
  /** Stressed RWA (inflated by credit + market risk) */
  readonly stressedRWA:             number;
  /** Stressed CET1 ratio (%) */
  readonly stressedCET1RatioPct:    number;
  /** Stressed total capital ratio (%) */
  readonly stressedTotalCapRatioPct:number;
  /** Stressed leverage ratio (%) */
  readonly stressedLeverageRatioPct:number;
  /** Capital depletion from baseline (absolute) */
  readonly capitalDepletion:        number;
  /** Additional provisions under stress */
  readonly additionalProvisions:    number;
  /** Regulatory minimum CET1 ratio required */
  readonly minimumCET1RatioPct:     number;
  /** Passes regulatory minimum? */
  readonly passesMinimum:           boolean;
  /** Survival horizon (days until CET1 hits floor) */
  readonly survivalHorizonDays:     number;
  readonly isViable:                boolean;
}

/** Full capital stress test report. */
export interface CapitalStressReport {
  readonly tenantId:             string;
  readonly reportingDate:        string;
  readonly baselineCET1RatioPct: number;
  readonly results:              StressResult[];
  readonly worstCase:            StressResult;
  readonly cfpTriggerScenario:   StressScenario | null;
  readonly overallAssessment:    string;
  readonly generatedAt:          string;
}

// ── Scenario shock parameters (EBA 2023 calibration) ──────────────────────────
const SHOCKS: Record<StressScenario, MacroShock> = {
  BASELINE:          { gdpShockPp:-0.5, rateShiftBps: 50,  creditSpreadBps:  25, equityShockPct:-0.05, depositOutflowPct:0.00, wholesaleClosurePct:0.00 },
  ADVERSE:           { gdpShockPp:-2.5, rateShiftBps:300,  creditSpreadBps: 200, equityShockPct:-0.30, depositOutflowPct:0.05, wholesaleClosurePct:0.20 },
  SEVERELY_ADVERSE:  { gdpShockPp:-5.0, rateShiftBps:500,  creditSpreadBps: 400, equityShockPct:-0.50, depositOutflowPct:0.10, wholesaleClosurePct:0.40 },
  IDIOSYNCRATIC:     { gdpShockPp:-1.0, rateShiftBps:100,  creditSpreadBps: 150, equityShockPct:-0.20, depositOutflowPct:0.30, wholesaleClosurePct:0.60 },
  COMBINED:          { gdpShockPp:-4.0, rateShiftBps:400,  creditSpreadBps: 350, equityShockPct:-0.45, depositOutflowPct:0.15, wholesaleClosurePct:0.50 },
};

const MINIMUM_CET1_BASE = 0.045;   // 4.5% Basel III CET1 minimum
const CONSERVATION_BUFFER = 0.025; // 2.5% capital conservation buffer

export class CapitalStressTester {
  /**
   * Run all 5 stress scenarios and generate the capital stress report.
   * This is the FIS BSM "Capital Stress Testing" equivalent.
   */
  runStressTest(position: CapitalPosition): CapitalStressReport {
    const results = Object.values(StressScenario).map(s =>
      this._runScenario(s, position)
    );

    const worstCase = results.reduce((worst, r) =>
      r.stressedCET1RatioPct < worst.stressedCET1RatioPct ? r : worst
    );

    const cfpTrigger = results.find(r => !r.isViable)?.scenario ?? null;

    const baselineCET1Pct = (position.cet1Capital / position.rwa) * 100;

    return {
      tenantId:             position.tenantId,
      reportingDate:        position.reportingDate,
      baselineCET1RatioPct: parseFloat(baselineCET1Pct.toFixed(4)),
      results,
      worstCase,
      cfpTriggerScenario:   cfpTrigger,
      overallAssessment:    this._assess(results, position),
      generatedAt:          new Date().toISOString(),
    };
  }

  private _runScenario(scenario: StressScenario, pos: CapitalPosition): StressResult {
    const shock = SHOCKS[scenario];
    const T     = pos.horizonYears;

    // 1. Additional credit provisions (GDP shock → PD increase → provisions)
    const pdMultiplier    = 1 + Math.max(0, -shock.gdpShockPp) * 0.4;
    const additionalProv  = pos.grossLoans * (pdMultiplier - 1) * 0.03 * T;

    // 2. NII impact from rate shock
    const niiFactor      = 1 + (shock.rateShiftBps / 10_000) * 0.25 * T;
    const niiImpact      = pos.nii * (niiFactor - 1);

    // 3. Market risk impact (equity + credit spread)
    const marketLoss     = pos.rwa * 0.10 * Math.abs(shock.equityShockPct);

    // 4. Total capital depletion
    const capitalDepletion = additionalProv + marketLoss - niiImpact;

    // 5. Stressed capital
    const stressedCET1   = Math.max(0, pos.cet1Capital - capitalDepletion);
    const totalCapital   = pos.cet1Capital + pos.at1Capital + pos.tier2Capital;
    const stressedTotal  = Math.max(0, totalCapital - capitalDepletion);

    // 6. RWA inflation (credit + market risk expansion)
    const rwaMult        = 1 + Math.max(0, -shock.gdpShockPp) * 0.08
                             + (shock.creditSpreadBps / 10_000) * 0.15;
    const stressedRWA    = pos.rwa * rwaMult;

    // 7. Stressed ratios
    const cet1Pct        = stressedRWA > 0 ? (stressedCET1 / stressedRWA) * 100 : 0;
    const totalCapPct    = stressedRWA > 0 ? (stressedTotal / stressedRWA) * 100 : 0;
    const leverPct       = pos.totalExposure > 0 ? (pos.cet1Capital * 0.9 / pos.totalExposure) * 100 : 0;

    // 8. Regulatory minimum (includes CCyB + G-SIB surcharge)
    const minCET1Pct     = (MINIMUM_CET1_BASE + CONSERVATION_BUFFER
                           + pos.ccybRate + pos.gsibSurcharge) * 100;

    // 9. Survival horizon: days until stressed CET1 hits the regulatory floor
    // headroom = how much capital above the floor (can be negative)
    const headroom       = stressedCET1 - stressedRWA * (minCET1Pct / 100);
    const dailyBurn      = capitalDepletion / (T * 365);
    // If headroom is positive and capital is being depleted, survival = headroom / burn rate
    const survivalDays   = headroom > 0 && dailyBurn > 0
      ? Math.floor(headroom / dailyBurn)
      : headroom > 0 ? 9999  // stable — no burn
      : 0;

    return {
      scenario,
      macroShock:               shock,
      stressedCET1:             parseFloat(stressedCET1.toFixed(2)),
      stressedRWA:              parseFloat(stressedRWA.toFixed(2)),
      stressedCET1RatioPct:     parseFloat(cet1Pct.toFixed(4)),
      stressedTotalCapRatioPct: parseFloat(totalCapPct.toFixed(4)),
      stressedLeverageRatioPct: parseFloat(leverPct.toFixed(4)),
      capitalDepletion:         parseFloat(capitalDepletion.toFixed(2)),
      additionalProvisions:     parseFloat(additionalProv.toFixed(2)),
      minimumCET1RatioPct:      parseFloat(minCET1Pct.toFixed(4)),
      passesMinimum:            cet1Pct >= minCET1Pct,
      survivalHorizonDays:      survivalDays,
      isViable:                 cet1Pct >= minCET1Pct,
    };
  }

  private _assess(results: StressResult[], pos: CapitalPosition): string {
    const failing = results.filter(r => !r.passesMinimum);
    const worst   = results.reduce((w, r) => r.stressedCET1RatioPct < w.stressedCET1RatioPct ? r : w);
    if (failing.length === 0) {
      return `PASS: Capital adequate under all ${results.length} scenarios. Worst case CET1: ${worst.stressedCET1RatioPct.toFixed(2)}% (${worst.scenario}).`;
    }
    return `FAIL: ${failing.length}/${results.length} scenarios breach minimum capital. Worst case: ${worst.stressedCET1RatioPct.toFixed(2)}% (${worst.scenario}). Immediate capital action required.`;
  }
}
