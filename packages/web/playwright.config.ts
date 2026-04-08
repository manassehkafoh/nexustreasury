import { defineConfig, devices } from '@playwright/test';

/**
 * NexusTreasury E2E test configuration.
 *
 * IMPORTANT: testMatch is set to '**\/*.spec.ts' (not '*.test.*').
 * This prevents Playwright from picking up Vitest component tests
 * (e.g. TradingBlotter.test.tsx) which use ESM imports incompatible
 * with Playwright's CommonJS test runner.
 *
 * Convention:
 *   *.test.tsx  — Vitest component/unit tests (run with `pnpm test`)
 *   *.spec.ts   — Playwright E2E tests     (run with `pnpm test:e2e`)
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: process.env['BASE_URL'] ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
