/**
 * @module risk-service/application/frtb/frtb-sa-engine
 *
 * FRTB Standardised Approach (SA) Capital Engine — Basel IV / BCBS 457.
 *
 * The FRTB SA uses the Sensitivity-Based Method (SBM) to compute capital
 * requirements for three risk measures:
 *
 *  1. Delta Risk     — first-order sensitivity to risk factors
 *  2. Vega Risk      — sensitivity to implied volatility
 *  3. Curvature Risk — second-order (gamma) residual risk
 *
 * Plus:
 *  4. Default Risk Charge (DRC) — jump-to-default risk
 *  5. Residual Risk Add-on (RRAO) — for exotic instruments
 *
 * Aggregation within a risk class uses prescribed correlations:
 *  - Within bucket: Σᵢ Σⱼ ρᵢⱼ × WS_i × WS_j  (weighted sensitivity products)
 *  - Across buckets: γ_bc × S_b × S_c  (inter-bucket correlation)
 *
 * Risk classes covered (BCBS 457 §§ 50–87):
 *  GIRR  — General Interest Rate Risk
 *  CREDIT_SPREAD_NON_SECURITISATION — Corporate / sovereign CDS spreads
 *  FX    — Foreign Exchange
 *  EQUITY — Equity risk
 *  COMMODITY — Commodity risk
 *
 * AI/ML hook: SensitivityPredictor
 *  - Predicts sensitivities for positions where live market data is unavailable
 *  - Uses gradient-boosted model trained on instrument characteristics
 *  - Particularly useful for illiquid EM instruments (GHS bonds, NGN MM)
 *
 * @see BCBS 457 — Minimum capital requirements for market risk (Jan 2019)
 * @see PRD REQ-R-003 — FRTB SA capital requirements
 */

// ── FRTB Risk Classes ─────────────────────────────────────────────────────────

export enum FRTBRiskClass {
  GIRR = 'GIRR',
  CREDIT_SPREAD_NON_SECURITISATION = 'CREDIT_SPREAD_NON_SEC',
  FX = 'FX',
  EQUITY = 'EQUITY',
  COMMODITY = 'COMMODITY',
}

// ── Sensitivity Input ─────────────────────────────────────────────────────────

export interface FRTBSensitivity {
  positionId: string;
  riskClass: FRTBRiskClass;
  /** Bucket — maps to a specific risk sub-bucket per BCBS 457 Appendix */
  bucket: string; // e.g. "1" for GIRR; "7" for FX to reporting ccy
  /** Risk factor label (e.g. tenor "1Y", equity "SPOT") */
  riskFactor: string;
  /** Net sensitivity (s_k): DV01, FX delta, equity delta */
  sensitivity: number;
  currency: string;
}

export interface FRTBVegaSensitivity extends FRTBSensitivity {
  optionMaturity: string; // e.g. "6M", "1Y"
}

// ── Capital Results ───────────────────────────────────────────────────────────

export interface RiskClassCapital {
  riskClass: FRTBRiskClass;
  deltaCapital: number;
  vegaCapital: number;
  curvatureCapital: number;
  totalCapital: number;
  currency: string;
}

export interface FRTBCapitalResult {
  totalCapital: number; // Σ risk class capitals
  byRiskClass: RiskClassCapital[];
  deltaCapitalTotal: number;
  vegaCapitalTotal: number;
  curvatureCapitalTotal: number;
  currency: string;
  computedAt: Date;
}

// ── BCBS 457 Risk Weights ─────────────────────────────────────────────────────

/**
 * GIRR delta risk weights by tenor bucket (BCBS 457 §50, Table 2).
 * Applied to DV01 sensitivities. Units: % of sensitivity.
 */
const GIRR_RISK_WEIGHTS: Record<string, number> = {
  '0.25Y': 0.017,
  '0.5Y': 0.017,
  '1Y': 0.016,
  '2Y': 0.013,
  '3Y': 0.012,
  '5Y': 0.011,
  '10Y': 0.011,
  '15Y': 0.011,
  '20Y': 0.011,
  '30Y': 0.011,
};

/**
 * FX delta risk weight (BCBS 457 §60).
 * 15% for all FX pairs; 7.5% for specified liquid pairs (USD/EUR, USD/JPY etc.)
 * We use 15% conservatively for all pairs.
 */
const FX_RISK_WEIGHT = 0.15;

/**
 * Equity delta risk weights by bucket (BCBS 457 §65, Table 8).
 * Buckets 1–8: large/mid/small cap by region. Bucket 11: indices.
 */
const EQUITY_RISK_WEIGHTS: Record<string, number> = {
  '1': 0.55,
  '2': 0.6,
  '3': 0.45,
  '4': 0.55,
  '5': 0.3,
  '6': 0.35,
  '7': 0.4,
  '8': 0.5,
  '9': 0.7,
  '10': 0.5,
  '11': 0.2,
  '12': 0.7,
};

/**
 * Credit Spread (non-securitisation) risk weights by bucket (BCBS 457 §73).
 * Bucket 1: Investment grade sovereigns. Bucket 8: sub-investment grade corporate.
 */
const CREDIT_RISK_WEIGHTS: Record<string, number> = {
  '1': 0.005,
  '2': 0.01,
  '3': 0.05,
  '4': 0.03,
  '5': 0.03,
  '6': 0.02,
  '7': 0.15,
  '8': 0.025,
};

// ── Intra-bucket Correlation Parameters ──────────────────────────────────────

/** GIRR intra-bucket correlation: ρ = e^{-α × |T_i − T_j| / min(T_i, T_j)} × 1 */
const GIRR_ALPHA = 0.03;

/** FX intra-bucket: single sensitivity per bucket → correlation = 1 */
/** Equity intra-bucket correlations by bucket type (BCBS 457 §65) */
const EQ_INTRA_SAME_SECTOR = 0.25; // same bucket
const EQ_INTRA_INDEX = 0.8; // bucket 11 (index)

// ── Inter-bucket Correlation Parameters ──────────────────────────────────────

/** GIRR inter-bucket correlation (across currencies): γ = 0.42 (BCBS 457 §52) */
const GIRR_INTER_BUCKET = 0.42;

/** FX: all FX pairs are in the same bucket (no inter-bucket needed) */

/** Equity inter-bucket: 0.15 (between different sector buckets, BCBS 457 §67) */
const EQ_INTER_BUCKET = 0.15;

// ── AI/ML Sensitivity Predictor ───────────────────────────────────────────────

/**
 * Optional ML predictor for positions with missing or stale sensitivities.
 * Predict FRTB sensitivities from position characteristics.
 */
export interface SensitivityPredictor {
  predict(params: {
    riskClass: FRTBRiskClass;
    instrumentType: string;
    notional: number;
    currency: string;
    maturityYears: number;
  }): Promise<FRTBSensitivity[]>;
}

// ── FRTB SA Engine ────────────────────────────────────────────────────────────

export class FRTBSAEngine {
  constructor(private readonly sensitivityPredictor?: SensitivityPredictor) {}

  /**
   * Compute total FRTB SA capital across all risk classes.
   * Delta + Vega + Curvature, aggregated per BCBS 457 §46.
   */
  computeCapital(
    sensitivities: FRTBSensitivity[],
    vegaSensitivities: FRTBVegaSensitivity[] = [],
    currency: string = 'USD',
  ): FRTBCapitalResult {
    const riskClasses = Object.values(FRTBRiskClass);
    const byRiskClass: RiskClassCapital[] = riskClasses.map((rc) => {
      const deltaSens = sensitivities.filter((s) => s.riskClass === rc);
      const vegaSens = vegaSensitivities.filter((s) => s.riskClass === rc);
      const delta = this.computeDeltaCapital(deltaSens, rc, currency);
      const vega = this.computeVegaCapital(vegaSens, rc, currency);
      const curvature = this.computeCurvatureCapital(deltaSens, rc, currency);
      return {
        riskClass: rc,
        deltaCapital: delta,
        vegaCapital: vega,
        curvatureCapital: curvature,
        totalCapital: delta + vega + curvature,
        currency,
      };
    });

    const totalCapital = byRiskClass.reduce((s, r) => s + r.totalCapital, 0);

    return {
      totalCapital,
      byRiskClass,
      deltaCapitalTotal: byRiskClass.reduce((s, r) => s + r.deltaCapital, 0),
      vegaCapitalTotal: byRiskClass.reduce((s, r) => s + r.vegaCapital, 0),
      curvatureCapitalTotal: byRiskClass.reduce((s, r) => s + r.curvatureCapital, 0),
      currency,
      computedAt: new Date(),
    };
  }

  // ── Delta Capital ─────────────────────────────────────────────────────────

  /**
   * Delta capital for a risk class using Sensitivity-Based Method.
   *
   * Formula (BCBS 457 §48):
   *  Kb = √[ Σᵢ (RW_i × s_i)² + Σᵢ Σⱼ≠ᵢ ρᵢⱼ × RW_i × s_i × RW_j × s_j ]
   *  S_b = clamp(Σᵢ RW_i × s_i, −Kb, Kb)
   *  Capital = √[ Σ_b Kb² + Σ_b Σ_c≠b γ_bc × S_b × S_c ]
   */
  computeDeltaCapital(
    sensitivities: FRTBSensitivity[],
    riskClass: FRTBRiskClass,
    _currency: string,
  ): number {
    if (sensitivities.length === 0) return 0;

    // Group by bucket
    const buckets = this.groupByBucket(sensitivities);
    const Kb: Record<string, number> = {};
    const Sb: Record<string, number> = {};

    for (const [bucket, sens] of Object.entries(buckets)) {
      const ws = sens.map((s) => this.riskWeight(s, riskClass) * s.sensitivity);
      const sumWS = ws.reduce((a, b) => a + b, 0);

      // Intra-bucket aggregation
      let intraSum = ws.reduce((a, w) => a + w * w, 0);
      for (let i = 0; i < ws.length; i++) {
        for (let j = i + 1; j < ws.length; j++) {
          const rho = this.intraCorrelation(sens[i]!, sens[j]!, riskClass);
          intraSum += 2 * rho * (ws[i] ?? 0) * (ws[j] ?? 0);
        }
      }
      const kb = Math.sqrt(Math.max(intraSum, 0));
      Kb[bucket] = kb;
      Sb[bucket] = Math.max(-kb, Math.min(kb, sumWS));
    }

    // Inter-bucket aggregation
    const bucketKeys = Object.keys(Kb);
    let interSum = bucketKeys.reduce((s, b) => s + (Kb[b] ?? 0) ** 2, 0);
    for (let b = 0; b < bucketKeys.length; b++) {
      for (let c = b + 1; c < bucketKeys.length; c++) {
        const gamma = this.interCorrelation(riskClass);
        interSum += 2 * gamma * (Sb[bucketKeys[b]!] ?? 0) * (Sb[bucketKeys[c]!] ?? 0);
      }
    }

    return Math.sqrt(Math.max(interSum, 0));
  }

  // ── Vega Capital ──────────────────────────────────────────────────────────

  /**
   * Vega capital — same SBM formula as delta but using vega sensitivities
   * and prescribed vega risk weights (BCBS 457 §55).
   * Simplified: uses the same formula structure as delta.
   */
  computeVegaCapital(
    vegaSensitivities: FRTBVegaSensitivity[],
    riskClass: FRTBRiskClass,
    currency: string,
  ): number {
    // Treat vega sensitivities the same as delta for structure
    // In production: vega risk weights differ (BCBS 457 Table 4)
    return this.computeDeltaCapital(vegaSensitivities, riskClass, currency) * 0.5;
  }

  // ── Curvature Capital ─────────────────────────────────────────────────────

  /**
   * Curvature capital — captures second-order (gamma/convexity) risk.
   *
   * Full FRTB curvature: re-price each position after ±RW shock;
   * curvature CVR = -[V(x + RW_shock) + V(x - RW_shock) - 2V(x)]
   *
   * Simplified approximation (without repricing infrastructure):
   *   CVR_k ≈ −0.5 × Γ_k × (RW_k)²
   * where Γ_k = second derivative (gamma) of the position.
   *
   * For DV01-based sensitivities: Γ ≈ DV01 × convexity / price.
   * We use 5% of delta capital as a conservative proxy.
   */
  computeCurvatureCapital(
    sensitivities: FRTBSensitivity[],
    riskClass: FRTBRiskClass,
    currency: string,
  ): number {
    // Conservative proxy: 5% of delta capital for options-bearing books
    // Full implementation requires position repricing at ±shock
    const delta = this.computeDeltaCapital(sensitivities, riskClass, currency);
    return delta * 0.05;
  }

  // ── Risk Weight Lookup ────────────────────────────────────────────────────

  private riskWeight(s: FRTBSensitivity, rc: FRTBRiskClass): number {
    switch (rc) {
      case FRTBRiskClass.GIRR:
        return GIRR_RISK_WEIGHTS[s.riskFactor] ?? GIRR_RISK_WEIGHTS['10Y']!;
      case FRTBRiskClass.FX:
        return FX_RISK_WEIGHT;
      case FRTBRiskClass.EQUITY:
        return EQUITY_RISK_WEIGHTS[s.bucket] ?? EQUITY_RISK_WEIGHTS['1']!;
      case FRTBRiskClass.CREDIT_SPREAD_NON_SECURITISATION:
        return CREDIT_RISK_WEIGHTS[s.bucket] ?? CREDIT_RISK_WEIGHTS['3']!;
      case FRTBRiskClass.COMMODITY:
        return 0.3; // simplified: 30% commodity risk weight
    }
  }

  // ── Correlation Lookups ───────────────────────────────────────────────────

  /**
   * Intra-bucket correlation between two sensitivities.
   * GIRR: ρ = exp(-α × |T_i - T_j| / min(T_i, T_j))
   * FX:   single RF per bucket → ρ = 1
   * EQ:   0.25 within sector bucket; 0.80 for index bucket
   */
  private intraCorrelation(a: FRTBSensitivity, b: FRTBSensitivity, rc: FRTBRiskClass): number {
    if (a.riskFactor === b.riskFactor) return 1.0;
    switch (rc) {
      case FRTBRiskClass.GIRR: {
        const ta = this.tenorToYears(a.riskFactor);
        const tb = this.tenorToYears(b.riskFactor);
        if (ta <= 0 || tb <= 0) return 0.5;
        return Math.exp((-GIRR_ALPHA * Math.abs(ta - tb)) / Math.min(ta, tb));
      }
      case FRTBRiskClass.EQUITY:
        return a.bucket === '11' || b.bucket === '11' ? EQ_INTRA_INDEX : EQ_INTRA_SAME_SECTOR;
      case FRTBRiskClass.CREDIT_SPREAD_NON_SECURITISATION:
        return 0.65; // same issuer, different tenor: ρ = 0.65 (BCBS 457 §73)
      default:
        return 0.5;
    }
  }

  /**
   * Inter-bucket correlation γ_bc.
   * GIRR: 0.42; FX: N/A (single bucket); EQ: 0.15.
   */
  private interCorrelation(rc: FRTBRiskClass): number {
    switch (rc) {
      case FRTBRiskClass.GIRR:
        return GIRR_INTER_BUCKET;
      case FRTBRiskClass.EQUITY:
        return EQ_INTER_BUCKET;
      case FRTBRiskClass.CREDIT_SPREAD_NON_SECURITISATION:
        return 0.0; // no inter-bucket
      default:
        return 0.0;
    }
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  private groupByBucket(sensitivities: FRTBSensitivity[]): Record<string, FRTBSensitivity[]> {
    return sensitivities.reduce<Record<string, FRTBSensitivity[]>>((acc, s) => {
      acc[s.bucket] = acc[s.bucket] ?? [];
      acc[s.bucket]!.push(s);
      return acc;
    }, {});
  }

  private tenorToYears(tenor: string): number {
    const map: Record<string, number> = {
      '0.25Y': 0.25,
      '0.5Y': 0.5,
      '1Y': 1,
      '2Y': 2,
      '3Y': 3,
      '5Y': 5,
      '10Y': 10,
      '15Y': 15,
      '20Y': 20,
      '30Y': 30,
    };
    return map[tenor] ?? 5;
  }
}
