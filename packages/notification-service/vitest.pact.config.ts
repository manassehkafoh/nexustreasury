import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: [
      '../../tests/contract/limit-breach.consumer.pact.ts',
      '../../tests/contract/trades-booked.consumer.pact.ts',
    ],
  },
});
