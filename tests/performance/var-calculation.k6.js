/**
 * @file var-calculation.k6.js
 * @description k6 performance test — Historical VaR calculation service.
 * Sprint 7.1 addition: validates the 100 concurrent EOD VaR requests SLA.
 *
 * VaR is a compute-intensive EOD batch process. This test validates that
 * the risk-service can handle 100 concurrent VaR requests (simulating
 * EOD batch) within the P99 < 2,000ms SLA.
 *
 * Run: k6 run tests/performance/var-calculation.k6.js --vus 100 --duration 2m
 */

import http   from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ── Custom metrics ─────────────────────────────────────────────────────────
const varSuccessRate  = new Rate('var_success_rate');
const varLatency      = new Trend('var_latency_ms', true);
const varESInvariant  = new Rate('var_es_invariant');   // ES >= VaR invariant

// ── Test configuration ─────────────────────────────────────────────────────
export const options = {
  scenarios: {
    // Scenario 1: EOD batch — 100 concurrent VaR calculations
    eod_batch: {
      executor:  'constant-vus',
      vus:       100,
      duration:  '2m',
      tags:      { scenario: 'eod_100_concurrent' },
    },
    // Scenario 2: Stress VaR — compute-intensive 250-day lookback
    stress_var: {
      executor:        'constant-arrival-rate',
      rate:            20,
      timeUnit:        '1s',
      duration:        '1m',
      preAllocatedVUs: 20,
      maxVUs:          50,
      startTime:       '2m10s',
      tags:            { scenario: 'stress_var_250d' },
    },
    // Scenario 3: Ramp-up from 0 to 150 concurrent — saturation point
    ramp_up: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 50  },
        { duration: '60s', target: 100 },
        { duration: '30s', target: 150 },
        { duration: '30s', target: 0   },
      ],
      startTime: '3m30s',
      tags:      { scenario: 'ramp_to_saturation' },
    },
  },
  thresholds: {
    // P99 < 2000ms for EOD batch
    'var_latency_ms{scenario:eod_100_concurrent}': ['p(99)<2000', 'p(95)<1500'],
    // P99 < 3000ms for stress scenarios
    'var_latency_ms{scenario:stress_var_250d}':    ['p(99)<3000'],
    // Success rate ≥ 99%
    var_success_rate:                               ['rate>=0.99'],
    // ES ≥ VaR invariant must hold in ≥ 99% of cases
    var_es_invariant:                               ['rate>=0.99'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4003/api/v1';

// ── PnL history generator (realistic daily P&L distribution) ──────────────
function generatePnlHistory(days = 250) {
  const history = [];
  const today = new Date('2026-04-09');
  // Simple random walk with fat tails (t-distribution approximation)
  for (let i = days; i > 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    // Mixture: 80% normal + 20% fat tail
    const z = Math.random() < 0.80
      ? (Math.random() * 2 - 1) * 50_000                    // normal: ±50K
      : (Math.random() * 2 - 1) * 200_000 * Math.random();  // fat tail: ±200K
    history.push({ date: dateStr, pnl: Math.round(z), currency: 'USD' });
  }
  return history;
}

// ── Main test function ─────────────────────────────────────────────────────
export default function () {
  const confidence = Math.random() < 0.7 ? 0.99 : 0.975; // mix of 99% and 97.5%
  const days       = Math.random() < 0.5 ? 250 : 500;     // mix of lookback windows
  const payload    = JSON.stringify({
    pnlHistory:  generatePnlHistory(days),
    confidence,
    currency:    'USD',
    portfolioId: `book-${Math.floor(Math.random() * 5) + 1}`,
  });

  const params = {
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${__ENV.JWT_TOKEN || 'mock-token'}`,
      'X-Tenant-Id':   'bank-001',
    },
    tags:    { endpoint: 'var-historical' },
    timeout: '10s',
  };

  const res = http.post(`${BASE_URL}/risk/var/historical`, payload, params);
  varLatency.add(res.timings.duration);

  const isSuccess = check(res, {
    'status is 200':              r => r.status === 200,
    'var1Day is positive':        r => {
      try { return JSON.parse(r.body).var1Day > 0; } catch { return false; }
    },
    'response within 3s':         r => r.timings.duration < 3_000,
  });

  varSuccessRate.add(isSuccess);

  // Check ES ≥ VaR invariant
  if (res.status === 200) {
    try {
      const body = JSON.parse(res.body);
      varESInvariant.add(
        typeof body.expectedShortfall === 'number' &&
        typeof body.var1Day           === 'number' &&
        body.expectedShortfall >= body.var1Day,
      );
    } catch (_) {
      varESInvariant.add(false);
    }
  }

  sleep(0.1); // 100ms think time between VaR requests
}

export function handleSummary(data) {
  return {
    'tests/performance/results/var-calculation-summary.json': JSON.stringify(data, null, 2),
  };
}
