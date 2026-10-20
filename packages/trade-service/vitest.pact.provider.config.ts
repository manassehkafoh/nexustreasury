import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['../../tests/contract/position-service-trades-booked.consumer.pact.ts'],
    setupFiles: [],
    testTimeout: 30000,
  },
});
