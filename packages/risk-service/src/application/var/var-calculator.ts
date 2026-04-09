/**
 * @module risk-service/application/var/var-calculator
 *
 * Value at Risk (VaR) Calculator — three methods:
 *
 * 1. Historical Simulation (HS-VaR): non-parametric, 250-day window, 99% CI.
 *    Sorts daily P&L ascending; VaR = loss at the 1% left-tail quantile.
 *    10-day VaR = 1-day × √10 (Basel III square-root-of-time scaling).
 *
 * 2. Stressed VaR (sVaR): identical to HS-VaR but uses P&L re-generated
 *    from the 2007-07-01 → 2008-12-31 stress period (Basel III reference).
 *    Capital = max(VaRₜ₋₁, mₒVaR̄) + max(sVaRₜ₋₁, mₛsVaR̄), mₒ,mₛ ≥ 3.
 *
 * 3. Monte Carlo (MC-VaR): Cholesky-decomposed correlated shocks applied
 *    to position sensitivities. Captures option non-linearity.
 *
 * Expected Shortfall (ES): average tail loss beyond VaR.
 *    Required for FRTB IMA (Basel IV replaces VaR with ES at 97.5%).
 *
 * AI/ML hook: ScenarioAugmenter — generative model adds synthetic tail
 * scenarios not present in the 250-day history (COVID, Flash Crash, etc.).
 *
 * @see BCBS 352 — Minimum capital requirements for market risk (Basel III)
 * @see BCBS 457 — FRTB (Basel IV) — Expected Shortfall
 * @see PRD REQ-R-001, REQ-R-002
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** Position sensitivity to a single risk factor (used in MC-VaR) */
export interface PositionRiskFactor {
  positionId: string;
  riskFactorId: string; // e.g. "USD_IR_1Y", "EURUSD_FX", "AAPL_EQ"
  sensitivity: number; // DV01 for rates; delta for FX/equity
  currency: string;
}

/** A single daily P&L observation for the portfolio */
export interface HistoricalPnLObservation {
  date: Date;
  pnl: number; // +ve = gain; -ve = loss (portfolio convention)
  currency: string;
}

/** Daily return for a single risk factor (for MC covariance estimation) */
export interface RiskFactorReturn {
  date: Date;
  riskFactorId: string;
  return: number; // e.g. 0.0023 = +0.23%
}

/** VaR result — one confidence level, one horizon */
export interface VaRResult {
  method: 'HISTORICAL' | 'MONTE_CARLO' | 'STRESSED';
  confidenceLevel: number; // 0.99
  horizon: number; // days
  var1Day: number; // positive loss amount
  var10Day: number; // var1Day × √10
  expectedShortfall: number; // mean tail loss beyond VaR
  scenariosUsed: number;
  stressedPeriod?: { from: Date; to: Date };
  currency: string;
  computedAt: Date;
}

// ── AI/ML Hook ────────────────────────────────────────────────────────────────

/**
 * Optional generative model for adversarial scenario augmentation.
 * Adds synthetic tail P&L observations to the historical window,
 * preventing VaR from being blind to risks not yet observed.
 *
 * Example implementations: GARCH simulation, GAN-based tail generator,
 * or historical analogue matching from a broader cross-market dataset.
 */
export interface ScenarioAugmenter {
  augment(history: HistoricalPnLObservation[]): Promise<HistoricalPnLObservation[]>;
}

// ── Config ────────────────────────────────────────────────────────────────────

export interface VaRConfig {
  historicalWindow: number; // trading days (default: 250)
  mcPaths: number; // Monte Carlo paths (default: 10_000)
  stressedPeriodFrom: Date; // Basel III: 2007-07-01
  stressedPeriodTo: Date; // Basel III: 2008-12-31
}

const DEFAULT_CONFIG: VaRConfig = {
  historicalWindow: 250,
  mcPaths: 10_000,
  stressedPeriodFrom: new Date('2007-07-01'),
  stressedPeriodTo: new Date('2008-12-31'),
};

// ── Calculator ────────────────────────────────────────────────────────────────

export class VaRCalculator {
  private readonly cfg: VaRConfig;

  constructor(
    private readonly augmenter?: ScenarioAugmenter,
    config?: Partial<VaRConfig>,
  ) {
    this.cfg = { ...DEFAULT_CONFIG, ...(config ?? {}) };
  }

  // ── Historical Simulation ────────────────────────────────────────────────

  /**
   * HS-VaR from daily P&L series.
   *
   * Steps:
   *  1. Use last N trading days (default 250)
   *  2. Augment with AI/ML synthetic tail scenarios (if configured)
   *  3. Sort ascending; VaR at (1−conf) quantile; ES = tail average
   *  4. Scale to 10-day: VaR₁₀ = VaR₁ × √10
   */
  async historicalVaR(
    history: HistoricalPnLObservation[],
    confidence: number = 0.99,
    currency: string = 'USD',
  ): Promise<VaRResult> {
    const window = history.slice(-this.cfg.historicalWindow);
    let pnls = window.map((o) => o.pnl);

    if (this.augmenter) {
      const extra = await this.augmenter.augment(window);
      pnls = [...pnls, ...extra.map((o) => o.pnl)];
    }

    const { var1Day, es } = this.percentileVaR(pnls, confidence);

    return this.buildResult('HISTORICAL', confidence, var1Day, es, pnls.length, currency);
  }

  // ── Stressed VaR ─────────────────────────────────────────────────────────

  /**
   * Stressed VaR — applies current positions to a 1-year stress period.
   *
   * In practice: re-price the current book using the daily risk factor
   * moves recorded during the stress period. The `stressedHistory` param
   * should contain those hypothetical P&Ls already computed by the caller
   * (or the position service revaluation engine).
   */
  async stressedVaR(
    stressedHistory: HistoricalPnLObservation[],
    confidence: number = 0.99,
    currency: string = 'USD',
  ): Promise<VaRResult> {
    const inPeriod = stressedHistory.filter(
      (o) => o.date >= this.cfg.stressedPeriodFrom && o.date <= this.cfg.stressedPeriodTo,
    );
    const pnls = (inPeriod.length > 0 ? inPeriod : stressedHistory).map((o) => o.pnl);
    const { var1Day, es } = this.percentileVaR(pnls, confidence);

    return {
      ...this.buildResult('STRESSED', confidence, var1Day, es, pnls.length, currency),
      stressedPeriod: { from: this.cfg.stressedPeriodFrom, to: this.cfg.stressedPeriodTo },
    };
  }

  // ── Monte Carlo ───────────────────────────────────────────────────────────

  /**
   * MC-VaR using correlated Gaussian shocks (Cholesky decomposition).
   *
   * Steps:
   *  1. Build NxN covariance matrix from historical RF returns
   *  2. Cholesky-decompose: Σ = L × Lᵀ
   *  3. For each path: z = L × ε, ε ~ N(0,I)
   *  4. Portfolio P&L = Σ (sensitivity_i × z_i)
   *  5. VaR at (1−conf) percentile across all paths
   */
  monteCarloVaR(
    positions: PositionRiskFactor[],
    rfReturns: RiskFactorReturn[],
    confidence: number = 0.99,
    currency: string = 'USD',
  ): VaRResult {
    const rfIds = [...new Set(positions.map((p) => p.riskFactorId))];
    const n = rfIds.length;
    const cov = this.covMatrix(rfIds, rfReturns);
    const L = this.cholesky(cov, n);
    const paths = this.cfg.mcPaths;
    const pnls: number[] = [];

    for (let p = 0; p < paths; p++) {
      const eps = Array.from({ length: n }, () => this.boxMuller());
      const z = Array.from({ length: n }, (_, i) =>
        L[i]!.reduce((s, lij, j) => s + lij * (eps[j] ?? 0), 0),
      );
      pnls.push(
        positions.reduce((sum, pos) => {
          const idx = rfIds.indexOf(pos.riskFactorId);
          return sum + (idx >= 0 ? pos.sensitivity * (z[idx] ?? 0) : 0);
        }, 0),
      );
    }

    const { var1Day, es } = this.percentileVaR(pnls, confidence);
    return this.buildResult('MONTE_CARLO', confidence, var1Day, es, paths, currency);
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  /** Sort P&L ascending; pick (1−conf) quantile; compute ES tail average */
  private percentileVaR(pnls: number[], conf: number): { var1Day: number; es: number } {
    if (pnls.length === 0) return { var1Day: 0, es: 0 };
    const sorted = [...pnls].sort((a, b) => a - b);
    const idx = Math.floor((1 - conf) * sorted.length);
    const var1Day = Math.max(0, -(sorted[idx] ?? 0));
    const tail = sorted
      .slice(0, idx + 1)
      .filter((v) => v < 0)
      .map((v) => -v);
    const es = tail.length ? tail.reduce((s, v) => s + v, 0) / tail.length : var1Day;
    return { var1Day, es };
  }

  private buildResult(
    method: VaRResult['method'],
    confidence: number,
    var1Day: number,
    es: number,
    scenarios: number,
    currency: string,
  ): VaRResult {
    return {
      method,
      confidenceLevel: confidence,
      horizon: 1,
      var1Day,
      var10Day: var1Day * Math.sqrt(10),
      expectedShortfall: es,
      scenariosUsed: scenarios,
      currency,
      computedAt: new Date(),
    };
  }

  /** Build covariance matrix from risk factor return history */
  private covMatrix(rfIds: string[], returns: RiskFactorReturn[]): number[][] {
    const n = rfIds.length;
    const cov = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const means = rfIds.map((id) => {
      const rs = returns.filter((r) => r.riskFactorId === id).map((r) => r.return);
      return rs.length ? rs.reduce((s, v) => s + v, 0) / rs.length : 0;
    });
    for (let i = 0; i < n; i++) {
      for (let j = i; j < n; j++) {
        const ri = returns.filter((r) => r.riskFactorId === rfIds[i]).map((r) => r.return);
        const rj = returns.filter((r) => r.riskFactorId === rfIds[j]).map((r) => r.return);
        const m = Math.min(ri.length, rj.length);
        if (m === 0) {
          cov[i]![j] = cov[j]![i] = 0;
          continue;
        }
        const c =
          ri.slice(0, m).reduce((s, v, k) => s + (v - means[i]!) * ((rj[k] ?? 0) - means[j]!), 0) /
          m;
        cov[i]![j] = cov[j]![i] = c;
      }
    }
    return cov;
  }

  /** Cholesky–Banachiewicz: L s.t. L × Lᵀ = A. Clamps diagonal for stability. */
  private cholesky(A: number[][], n: number): number[][] {
    const L = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let s = A[i]![j] ?? 0;
        for (let k = 0; k < j; k++) s -= (L[i]![k] ?? 0) * (L[j]![k] ?? 0);
        L[i]![j] =
          i === j ? Math.sqrt(Math.max(s, 1e-12)) : (L[j]![j] ?? 1) > 1e-12 ? s / L[j]![j]! : 0;
      }
    }
    return L;
  }

  /** Box-Muller: standard normal N(0,1) variate from two U(0,1) uniforms */
  private boxMuller(): number {
    let u = 0,
      v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}
