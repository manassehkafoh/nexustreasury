import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        // Entry points — E2E-covered
        'src/server.ts',
        'src/index.ts',
        // Route adapters — thin HTTP wrappers, E2E-covered
        'src/routes/**',
        // Infrastructure adapters — require live PostgreSQL
        'src/infrastructure/**',
        'dist/**',
      ],
    },
  },
});
