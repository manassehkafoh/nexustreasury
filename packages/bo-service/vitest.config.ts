import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      thresholds: { lines: 80, functions: 80, branches: 45, statements: 80 },
      // Measure ONLY the application layer.
      // Route adapters, infrastructure/DB, and entry points are E2E-covered.
      include: ['src/application/**'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'dist/**'],
    },
  },
});
