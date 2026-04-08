import { test, expect } from '@playwright/test';

/**
 * Basic health check E2E test.
 * Verifies the Next.js application starts and responds.
 */
test.describe('Application health', () => {
  test('home page loads', async ({ page }) => {
    await page.goto('/');
    // Accept either a loaded page or a redirect to login
    await expect(page).not.toHaveURL(/error/);
    expect(page.url()).toBeTruthy();
  });
});
