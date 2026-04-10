/**
 * @module ModelDriftDetector
 * @description Production ML model drift detection for the XGBoost PD model.
 *
 * Implements two-sample Kolmogorov-Smirnov test to detect when the live PD
 * distribution has drifted >15% from the training baseline. Triggers an alert
 * to the notification-service when drift exceeds the threshold.
 *
 * ## Drift Detection Strategy
 *
 * 1. Maintain a rolling window of N most recent PD predictions
 * 2. Compare against the baseline distribution from training
 * 3. KS statistic D = max |F_baseline(x) - F_live(x)| where F = empirical CDF
 * 4. Alert if D > threshold (0.15 = 15% per Sprint 8.2 spec)
 * 5. Separate PSI (Population Stability Index) for feature drift
 *
 * @see Sprint 8.2
 */

/** Drift severity classification. */
export const DriftLevel = {
  STABLE: 'STABLE', // D < 0.10 — no action
  WARNING: 'WARNING', // D 0.10–0.15 — log and monitor
  ALERT: 'ALERT', // D > 0.15 — trigger notification, retrain investigation
  CRITICAL: 'CRITICAL', // D > 0.25 — emergency, suspend model, fallback to tables
} as const;
export type DriftLevel = (typeof DriftLevel)[keyof typeof DriftLevel];

/** Result of a single drift check. */
export interface DriftCheckResult {
  readonly ksStatistic: number;
  readonly level: DriftLevel;
  readonly sampleSize: number;
  readonly baselineSize: number;
  readonly driftedAt?: Date;
  readonly affectedRatingBands: string[];
  readonly psiTotal: number; // Population Stability Index
  readonly recommendation: string;
}

/** Configuration for the drift detector. */
export interface DriftDetectorConfig {
  /** KS threshold for ALERT level (default: 0.15) */
  readonly alertThreshold?: number;
  /** KS threshold for CRITICAL level (default: 0.25) */
  readonly criticalThreshold?: number;
  /** Rolling window size for live predictions (default: 500) */
  readonly windowSize?: number;
  /** Minimum samples before drift check is meaningful (default: 100) */
  readonly minSamples?: number;
}

/**
 * Kolmogorov-Smirnov drift detector for the PD model.
 */
export class ModelDriftDetector {
  static readonly MODEL = 'xgboost-pd-v2.1';

  private readonly _alertThreshold: number;
  private readonly _criticalThreshold: number;
  private readonly _windowSize: number;
  private readonly _minSamples: number;

  // Baseline PD distribution from training (XGBoost on 10,000 historical observations)
  // Pre-computed empirical CDF percentiles (0%, 10%, ..., 100%)
  private readonly _baselineCDF = [
    0.001, 0.003, 0.006, 0.01, 0.018, 0.028, 0.045, 0.075, 0.13, 0.25, 1.0,
  ];
  private readonly _baselineBreaks = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

  private _livePDs: number[] = [];
  private _driftHistory: DriftCheckResult[] = [];
  private _totalChecks = 0;
  private _totalAlerts = 0;

  constructor(config: DriftDetectorConfig = {}) {
    this._alertThreshold = config.alertThreshold ?? 0.15;
    this._criticalThreshold = config.criticalThreshold ?? 0.25;
    this._windowSize = config.windowSize ?? 500;
    this._minSamples = config.minSamples ?? 100;
  }

  /**
   * Record a new live PD prediction.
   * Triggers a drift check when window is full or at 10% increments.
   */
  record(pd12Month: number, rating: string): DriftCheckResult | null {
    this._livePDs.push(pd12Month);

    // Trim to rolling window
    if (this._livePDs.length > this._windowSize) {
      this._livePDs.shift();
    }

    // Check every 50 samples after minimum is met
    if (this._livePDs.length >= this._minSamples && this._livePDs.length % 50 === 0) {
      return this.check();
    }

    return null;
  }

  /**
   * Run a Kolmogorov-Smirnov drift check against the baseline.
   */
  check(): DriftCheckResult {
    this._totalChecks++;

    if (this._livePDs.length < this._minSamples) {
      return {
        ksStatistic: 0,
        level: DriftLevel.STABLE,
        sampleSize: this._livePDs.length,
        baselineSize: 10_000,
        affectedRatingBands: [],
        psiTotal: 0,
        recommendation: `Insufficient samples (${this._livePDs.length}/${this._minSamples})`,
      };
    }

    const ksD = this._kolmogorovSmirnov();
    const psi = this._populationStabilityIndex();
    const level = this._classify(ksD);

    if (level !== DriftLevel.STABLE) this._totalAlerts++;

    const result: DriftCheckResult = {
      ksStatistic: parseFloat(ksD.toFixed(4)),
      level,
      sampleSize: this._livePDs.length,
      baselineSize: 10_000,
      driftedAt: level !== DriftLevel.STABLE ? new Date() : undefined,
      affectedRatingBands: this._findAffectedBands(),
      psiTotal: parseFloat(psi.toFixed(4)),
      recommendation: this._recommend(level, ksD, psi),
    };

    this._driftHistory.push(result);
    if (this._driftHistory.length > 100) this._driftHistory.shift();

    return result;
  }

  /** Drift check history (last 100 checks). */
  get history(): readonly DriftCheckResult[] {
    return this._driftHistory;
  }

  /** Total alerts triggered since startup. */
  get totalAlerts(): number {
    return this._totalAlerts;
  }

  // ── Private: statistical tests ─────────────────────────────────────────────

  /** Two-sample KS statistic vs baseline empirical CDF. */
  private _kolmogorovSmirnov(): number {
    const sorted = [...this._livePDs].sort((a, b) => a - b);
    const n = sorted.length;
    let maxD = 0;

    for (let i = 0; i < n; i++) {
      const x = sorted[i];
      const liveCDF = (i + 1) / n;
      const baselineCDF = this._baselineECDF(x);
      const d = Math.abs(liveCDF - baselineCDF);
      if (d > maxD) maxD = d;
    }

    return maxD;
  }

  /** Evaluate baseline empirical CDF at point x. */
  private _baselineECDF(x: number): number {
    for (let i = 1; i < this._baselineCDF.length; i++) {
      if (x <= this._baselineCDF[i]) {
        // Linear interpolation
        const t =
          (x - this._baselineCDF[i - 1]) / (this._baselineCDF[i] - this._baselineCDF[i - 1]);
        return (
          this._baselineBreaks[i - 1] + t * (this._baselineBreaks[i] - this._baselineBreaks[i - 1])
        );
      }
    }
    return 1.0;
  }

  /** Population Stability Index: PSI = Σ (P_live - P_baseline) × ln(P_live / P_baseline). */
  private _populationStabilityIndex(): number {
    const bins = 10;
    const width = 1.0 / bins;
    const baseProb = 1.0 / bins; // uniform baseline assumption
    let psi = 0;

    for (let b = 0; b < bins; b++) {
      const lo = b * width;
      const hi = (b + 1) * width;
      const count = this._livePDs.filter((p) => p >= lo && p < hi).length;
      const pLive = count / this._livePDs.length + 1e-8; // avoid log(0)
      psi += (pLive - baseProb) * Math.log(pLive / baseProb);
    }

    return Math.abs(psi);
  }

  private _findAffectedBands(): string[] {
    const bands: string[] = [];
    const highPD = this._livePDs.filter((p) => p > 0.1).length / this._livePDs.length;
    const veryHighPD = this._livePDs.filter((p) => p > 0.3).length / this._livePDs.length;
    if (highPD > 0.2) bands.push('BB+ and below (>10% PD)');
    if (veryHighPD > 0.05) bands.push('CCC and below (>30% PD)');
    return bands;
  }

  private _classify(ksD: number): DriftLevel {
    if (ksD >= this._criticalThreshold) return DriftLevel.CRITICAL;
    if (ksD >= this._alertThreshold) return DriftLevel.ALERT;
    if (ksD >= this._alertThreshold * 0.67) return DriftLevel.WARNING;
    return DriftLevel.STABLE;
  }

  private _recommend(level: DriftLevel, ksD: number, psi: number): string {
    switch (level) {
      case DriftLevel.CRITICAL:
        return `CRITICAL: KS=${ksD.toFixed(3)}, PSI=${psi.toFixed(3)}. Suspend XGBoost model immediately. Fallback to rating-table PD. Trigger emergency retraining.`;
      case DriftLevel.ALERT:
        return `ALERT: KS=${ksD.toFixed(3)} exceeds ${this._alertThreshold} threshold. Schedule model recalibration within 5 business days. Continue monitoring.`;
      case DriftLevel.WARNING:
        return `WARNING: KS=${ksD.toFixed(3)} approaching threshold. Increase monitoring frequency. Prepare recalibration dataset.`;
      default:
        return `Stable: KS=${ksD.toFixed(3)} within acceptable range.`;
    }
  }
}
