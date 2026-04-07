import pino from 'pino';

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  base: {
    service: 'trade-service',
    version: process.env['npm_package_version'] ?? '1.0.0',
    env: process.env['NODE_ENV'] ?? 'development',
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
