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
        // Test files
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        // Entry points — covered by E2E/integration tests, not unit tests
        'src/server.ts',
        'src/index.ts',
        // Route adapters — thin HTTP wrappers, covered by E2E tests
        'src/routes/**',
        // Infrastructure adapters — require live DB, covered by integration tests
        'src/infrastructure/**',
        // Build output
        'dist/**',
      ],
    },
  },
});
