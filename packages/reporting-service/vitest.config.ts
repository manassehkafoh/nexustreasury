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
      // Measure ONLY the application layer — the source of truth for unit tests.
      // Route adapters, infrastructure/DB repositories, and entry points are
      // integration/E2E-tested and excluded from unit coverage measurement.
      include: ['src/application/**'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'dist/**'],
    },
  },
});
