/**
 * Minimal structured logger for use in domain tests and non-Fastify contexts.
 * Production services use Pino directly via @nexustreasury/trade-service/infrastructure/logger.
 */
export const domainLogger = {
  info:  (msg: string, data?: object): void => { console.warn(`[INFO]  ${msg}`, data ?? ''); },
  warn:  (msg: string, data?: object): void => { console.warn(`[WARN]  ${msg}`, data ?? ''); },
  error: (msg: string, data?: object): void => { console.error(`[ERROR] ${msg}`, data ?? ''); },
};
