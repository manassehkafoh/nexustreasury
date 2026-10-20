import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['../../tests/contract/limit-breach.consumer.pact.ts'],
    setupFiles: [],
    testTimeout: 30000,
  },
});
