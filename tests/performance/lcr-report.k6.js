/**
 * NexusTreasury — k6 Performance Test: LCR Report Generation
 *
 * Target SLAs:
 *   - LCR report generation: P99 < 30,000ms (complex batch calc)
 *   - Concurrent reports:    10 simultaneous without degradation
 *
 * Run: k6 run tests/performance/lcr-report.k6.js --vus 10 --duration 2m
 */

import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';

const lcrDuration = new Trend('nt_lcr_report_duration', true);

const REPORTING_URL = __ENV.REPORTING_URL || 'http://localhost:4011/api/v1';
const TOKEN         = __ENV.JWT_TOKEN     || 'dev-test-token';

export const options = {
  vus:        10,
  duration:   '2m',
  thresholds: {
    'nt_lcr_report_duration': ['p(99) < 30000'],  // P99 < 30s (SLA)
    'http_req_failed':        ['rate < 0.001'],
  },
};

export default function () {
  const payload = JSON.stringify({
    tenantId:   'bank-001',
    reportDate: '2026-04-09',
    currency:   'USD',
    hqlaItems: [
      { category: 'LEVEL_1', description: 'T-Bills', marketValue: 500_000_000, haircut: 0, adjustedValue: 500_000_000, currency: 'USD' },
    ],
    outflowItems: [
      { category: 'Retail stable', balance: 1_000_000_000, runoffRate: 0.03, outflow: 30_000_000, currency: 'USD' },
    ],
    inflowItems: [],
  });

  const res = http.post(`${REPORTING_URL}/reporting/lcr`, payload, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    timeout: '35s',
  });

  check(res, {
    'status 200':          (r) => r.status === 200,
    'isCompliant field':   (r) => 'isCompliant' in JSON.parse(r.body),
    'lcrRatio present':    (r) => typeof JSON.parse(r.body).lcrRatio === 'number',
  });

  lcrDuration.add(res.timings.duration);
}
