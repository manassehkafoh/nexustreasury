import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['../../tests/contract/trades-booked.consumer.pact.ts'],
    setupFiles: [],
    testTimeout: 30000,
  },
});
