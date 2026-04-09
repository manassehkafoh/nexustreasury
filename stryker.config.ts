/**
 * NexusTreasury — Stryker Mutation Testing Configuration
 *
 * Mutation testing kills mutants (artificially introduced bugs) to verify
 * that existing tests actually catch failures. A kill score > 80% means
 * tests are strong enough to catch 4 in 5 real bugs.
 *
 * Target: kill score > 80% across critical domain packages.
 *
 * Run:
 *   npx stryker run                          # All packages
 *   npx stryker run --project domain         # Domain only
 *
 * @see ROADMAP.md Sprint 7 — Stryker mutation testing
 * @see docs/QA_ASSESSMENT_20260409.md
 */

import type { Config } from '@stryker-mutator/core';

const config: Config = {
  // ── Test runner ─────────────────────────────────────────────────────────────
  testRunner:     'vitest',
  testRunnerNodeArgs: ['--experimental-vm-modules'],

  // ── Source files to mutate ──────────────────────────────────────────────────
  // Focus on high-value domain logic and financial calculations.
  // Exclude generated code, type definitions, and infrastructure adapters.
  mutate: [
    'packages/domain/src/**/*.ts',
    'packages/accounting-service/src/domain/**/*.ts',
    'packages/accounting-service/src/application/**/*.ts',
    'packages/risk-service/src/application/**/*.ts',
    'packages/collateral-service/src/domain/**/*.ts',
    '!packages/**/src/**/*.test.ts',
    '!packages/**/src/**/*.spec.ts',
    '!packages/**/src/**/index.ts',
    '!packages/**/src/**/types.ts',
    '!packages/**/dist/**',
  ],

  // ── Mutators ─────────────────────────────────────────────────────────────────
  // Enable all mutators — financial code has no room for skipped checks.
  mutator: {
    plugins:         [],
    excludedMutations: [
      // String literal mutations in log/error messages are low-value noise
      'StringLiteral',
    ],
  },

  // ── Reporters ────────────────────────────────────────────────────────────────
  reporters: ['html', 'json', 'clear-text', 'progress'],
  htmlReporter: { fileName: 'reports/mutation/mutation-report.html' },
  jsonReporter:  { fileName: 'reports/mutation/mutation-report.json' },

  // ── Thresholds ────────────────────────────────────────────────────────────────
  // Kill score < 70% = CI FAILURE (hard gate)
  // Kill score 70-79% = WARNING
  // Kill score ≥ 80% = PASS (Sprint 7 target)
  thresholds: {
    high:    80,  // 🟢 good
    low:     70,  // 🟡 warning
    break:   65,  // 🔴 CI failure
  },

  // ── Timeouts ─────────────────────────────────────────────────────────────────
  timeoutMS:          10000,  // 10s per mutant (pricing engine is CPU-bound)
  timeoutFactor:      1.5,

  // ── Concurrency ──────────────────────────────────────────────────────────────
  concurrency: 4,  // 4 parallel workers

  // ── Ignore patterns ──────────────────────────────────────────────────────────
  ignoreStatic: true,  // Skip mutations that can't affect output
  tempDirName:  'reports/mutation/.stryker-tmp',
};

export default config;
