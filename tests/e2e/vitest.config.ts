import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['**/*.test.ts'],
    alias: {
      '@nexustreasury/domain': resolve(__dirname, '../../packages/domain/src/index.ts'),
    },
    coverage: { reporter: ['text', 'lcov'] },
  },
  resolve: {
    alias: {
      '@nexustreasury/domain': resolve(__dirname, '../../packages/domain/src/index.ts'),
    },
  },
});
