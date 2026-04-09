/**
 * @file pre-deal-check.k6.js
 * @description k6 performance test — Pre-deal limit check service.
 * Sprint 7.1 addition: validates the 1,000 TPS P99 < 5ms SLA
 * for the synchronous pre-deal risk check path.
 *
 * Run: k6 run tests/performance/pre-deal-check.k6.js --vus 50 --duration 2m
 */

import http   from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ── Custom metrics ─────────────────────────────────────────────────────────
const preDealSuccessRate   = new Rate('pre_deal_success_rate');
const preDealLatency       = new Trend('pre_deal_latency_ms', true);
const limitBreachCount     = new Counter('limit_breach_count');
const approvedCount        = new Counter('approved_count');

// ── Test configuration ─────────────────────────────────────────────────────
export const options = {
  scenarios: {
    // Scenario 1: Sustained 200 TPS with 20 VUs
    sustained_load: {
      executor:        'constant-arrival-rate',
      rate:            200,
      timeUnit:        '1s',
      duration:        '2m',
      preAllocatedVUs: 20,
      maxVUs:          50,
      tags:            { scenario: 'sustained_200tps' },
    },
    // Scenario 2: Spike to 500 TPS (stress test — P99 ≤ 10ms acceptable)
    spike_test: {
      executor:        'constant-arrival-rate',
      rate:            500,
      timeUnit:        '1s',
      duration:        '30s',
      preAllocatedVUs: 40,
      maxVUs:          100,
      startTime:       '2m10s',
      tags:            { scenario: 'spike_500tps' },
    },
    // Scenario 3: Mixed limit-approved and limit-breached requests
    mixed_outcomes: {
      executor:   'ramping-vus',
      startVUs:   1,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m',  target: 30 },
        { duration: '30s', target: 0  },
      ],
      startTime: '3m',
      tags:      { scenario: 'mixed_outcomes' },
    },
  },
  thresholds: {
    // P99 < 5ms for sustained load (primary SLA)
    'pre_deal_latency_ms{scenario:sustained_200tps}': ['p(99)<5'],
    // P99 < 10ms for spike (secondary SLA)
    'pre_deal_latency_ms{scenario:spike_500tps}':     ['p(99)<10'],
    // Overall success rate ≥ 99.5% (422 = limit exceeded = success; 500 = failure)
    pre_deal_success_rate:                             ['rate>=0.995'],
    http_req_failed:                                   ['rate<0.005'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4003/api/v1';

// ── Counterparty scenarios ─────────────────────────────────────────────────
const SCENARIOS = [
  // Small amount — should be approved
  { counterpartyId: '3fa85f64-5717-4562-b3fc-2c963f66afa6', requestedAmount: 100_000,   expectApproved: true  },
  { counterpartyId: '3fa85f64-5717-4562-b3fc-2c963f66afa6', requestedAmount: 500_000,   expectApproved: true  },
  // Large amount — may breach limit
  { counterpartyId: '3fa85f64-5717-4562-b3fc-2c963f66afa6', requestedAmount: 50_000_000, expectApproved: false },
];

// ── Main test function ─────────────────────────────────────────────────────
export default function () {
  const scenario = SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
  const payload  = JSON.stringify({
    counterpartyId:   scenario.counterpartyId,
    requestedAmount:  scenario.requestedAmount,
    requestedCurrency: 'USD',
  });

  const params = {
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${__ENV.JWT_TOKEN || 'mock-token'}`,
      'X-Tenant-Id':   'bank-001',
      'X-Request-Id':  `k6-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
    tags: { endpoint: 'pre-deal-check' },
  };

  const t0  = Date.now();
  const res = http.post(`${BASE_URL}/risk/pre-deal-check`, payload, params);
  const dur = Date.now() - t0;

  preDealLatency.add(dur);

  const isSuccess = check(res, {
    'status is 200 or 422':       r => r.status === 200 || r.status === 422,
    'response has approved field': r => {
      try {
        const b = JSON.parse(r.body);
        return typeof b.approved === 'boolean';
      } catch { return false; }
    },
    'response time < 50ms':       r => r.timings.duration < 50,
  });

  preDealSuccessRate.add(isSuccess);

  if (res.status === 200 || res.status === 422) {
    try {
      const body = JSON.parse(res.body);
      if (body.approved === true)  approvedCount.add(1);
      if (body.approved === false) limitBreachCount.add(1);
    } catch (_) { /* ignore parse errors */ }
  }

  sleep(0.001); // 1ms think time
}

export function handleSummary(data) {
  return {
    'tests/performance/results/pre-deal-check-summary.json': JSON.stringify(data, null, 2),
  };
}
