/**
 * NexusTreasury — k6 Performance Test: Trade Booking
 *
 * Target SLAs (from PRD NFR section):
 *   - Trade booking:     P99 < 200ms under 500 TPS
 *   - Pre-deal check:    P99 < 10ms  under 1,000 TPS
 *   - VaR calculation:   P99 < 8,000ms under 100 concurrent requests
 *   - Error rate:        < 0.1%
 *
 * Run:
 *   k6 run tests/performance/trade-booking.k6.js
 *   k6 run tests/performance/trade-booking.k6.js --vus 50 --duration 5m
 *   k6 run tests/performance/trade-booking.k6.js -e BASE_URL=https://trade.staging.nexustreasury.io
 *
 * @see docs/QA_ASSESSMENT_20260409.md
 * @see ROADMAP.md Sprint 7.1
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ── Custom metrics ────────────────────────────────────────────────────────────

const errorRate        = new Rate('nt_error_rate');
const bookingDuration  = new Trend('nt_trade_booking_duration', true);
const preDealDuration  = new Trend('nt_pre_deal_check_duration', true);
const sanctionsDuration = new Trend('nt_sanctions_duration', true);
const tradeBookedCount = new Counter('nt_trades_booked');
const limitBreachCount = new Counter('nt_limit_breaches');

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL   = __ENV.BASE_URL   || 'http://localhost:4001/api/v1';
const RISK_URL   = __ENV.RISK_URL   || 'http://localhost:4003/api/v1';
const TOKEN      = __ENV.JWT_TOKEN  || 'dev-test-token';  // Override with real token

const HEADERS = {
  'Content-Type':  'application/json',
  'Authorization': `Bearer ${TOKEN}`,
};

// ── Test Scenarios ─────────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    // Scenario 1: Trade booking — sustained 50 VUs
    trade_booking: {
      executor:     'constant-vus',
      vus:          50,
      duration:     '5m',
      exec:         'bookTrade',
      startTime:    '0s',
    },
    // Scenario 2: Pre-deal check — ramp up to 100 VUs
    pre_deal_ramp: {
      executor:     'ramping-vus',
      exec:         'preDealCheck',
      startTime:    '30s',
      stages: [
        { duration: '30s', target: 20 },
        { duration: '3m',  target: 100 },
        { duration: '30s', target: 0 },
      ],
    },
    // Scenario 3: Spike test — sudden burst
    spike:  {
      executor:     'ramping-arrival-rate',
      exec:         'bookTrade',
      startTime:    '4m',
      timeUnit:     '1s',
      preAllocatedVUs: 100,
      maxVUs:       200,
      stages: [
        { duration: '10s', target: 10  },
        { duration: '20s', target: 200 },  // spike to 200 RPS
        { duration: '30s', target: 10  },
      ],
    },
  },
  thresholds: {
    // SLA thresholds — test fails if breached
    'nt_trade_booking_duration': [
      'p(50) < 50',   // median < 50ms
      'p(95) < 150',  // P95 < 150ms
      'p(99) < 200',  // P99 < 200ms (SLA)
    ],
    'nt_pre_deal_check_duration': [
      'p(99) < 10',   // P99 < 10ms (SLA: 5ms + 5ms network)
    ],
    'nt_error_rate': ['rate < 0.001'],  // < 0.1% errors
    'http_req_failed': ['rate < 0.001'],
    'http_req_duration{scenario:trade_booking}': ['p(99) < 200'],
  },
};

// ── Scenario: Book Trade ──────────────────────────────────────────────────────

export function bookTrade() {
  const idempotencyKey = `k6-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const payload = JSON.stringify({
    assetClass:          'FX',
    instrumentType:      'FORWARD',
    direction:           'BUY',
    notional:            Math.floor(Math.random() * 4_000_000) + 100_000,  // 100K–4M
    currency:            ['EUR', 'GBP', 'JPY', 'CHF'][Math.floor(Math.random() * 4)],
    counterpartyCurrency: 'USD',
    price:               1.0842 + (Math.random() * 0.02 - 0.01),
    counterpartyId:      '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    bookId:              'fx-prop-desk',
    traderId:            'trader-alex-01',
    valueDate:           '2026-04-11',
  });

  const res = http.post(`${BASE_URL}/trades`, payload, {
    headers: { ...HEADERS, 'X-Idempotency-Key': idempotencyKey },
    tags:    { endpoint: 'book_trade' },
  });

  const ok = check(res, {
    'status 201':       (r) => r.status === 201,
    'has tradeId':      (r) => JSON.parse(r.body).tradeId !== undefined,
    'has reference':    (r) => /^FX-/.test(JSON.parse(r.body).reference),
    'duration < 200ms': (r) => r.timings.duration < 200,
  });

  errorRate.add(!ok);
  bookingDuration.add(res.timings.duration);
  if (ok) tradeBookedCount.add(1);

  // Extract sanctions timing from custom response header if present
  const sanctionsMs = Number(res.headers['X-Sanctions-Ms'] || 0);
  if (sanctionsMs > 0) sanctionsDuration.add(sanctionsMs);

  sleep(0.1);  // 100ms think time → ~10 RPS per VU
}

// ── Scenario: Pre-Deal Check ──────────────────────────────────────────────────

export function preDealCheck() {
  const payload = JSON.stringify({
    counterpartyId:   '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    requestedAmount:  Math.floor(Math.random() * 9_000_000) + 1_000_000,
    requestedCurrency: 'USD',
  });

  const res = http.post(`${RISK_URL}/risk/pre-deal-check`, payload, {
    headers: HEADERS,
    tags:    { endpoint: 'pre_deal_check' },
  });

  const approved = res.status === 200 && JSON.parse(res.body).approved;

  check(res, {
    'status 200 or 422':      (r) => [200, 422].includes(r.status),
    'has approved field':     (r) => 'approved' in JSON.parse(r.body),
    'duration < 10ms (SLA)':  (r) => r.timings.duration < 10,
  });

  errorRate.add(res.status >= 500);
  preDealDuration.add(res.timings.duration);
  if (!approved) limitBreachCount.add(1);

  sleep(0.05);  // 50ms think time → ~20 RPS per VU
}

// ── Lifecycle: Setup & Teardown ───────────────────────────────────────────────

export function setup() {
  // Verify services are healthy before test
  const health = http.get(`${BASE_URL}/ready`);
  if (health.status !== 200) {
    console.error(`Trade Service not ready: ${health.status}`);
  }
  console.log(`k6 performance test started.`);
  console.log(`Trade service: ${BASE_URL}`);
  console.log(`Risk service:  ${RISK_URL}`);
  return { startTime: Date.now() };
}

export function teardown(data) {
  const durationSec = (Date.now() - data.startTime) / 1000;
  console.log(`Test completed in ${durationSec.toFixed(1)}s`);
}
