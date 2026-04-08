import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
      exclude: [
        // Test files
        'src/**/*.test.ts',
        // Infrastructure adapters — require real Kafka/Prisma/Redis/OTel
        // Tested via integration/E2E tests, not unit tests
        'src/server.ts',
        'src/container.ts',
        'src/plugins/**',
        'src/infrastructure/kafka/**',
        'src/infrastructure/postgres/**',
        'src/infrastructure/websocket/**',
        'src/infrastructure/telemetry.ts',
        'src/infrastructure/logger.ts',
        // Health routes require real DB/Kafka/Redis — covered by integration tests
        'src/routes/health.routes.ts',
        'dist/**',
      ],
    },
  },
});
