import winston from 'winston';

const SENSITIVE = /password|token|authorization|jwt|latitude|longitude|location|group_?code|room_?id|socket_?id|device_?id|user_?id|email|name|allerg|medical|emergency_contact|phone|notes?|blood|database_?url|connectionstring|credential/i;
export function redactLogValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactLogValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, SENSITIVE.test(key) ? '[REDACTED]' : redactLogValue(item)]));
  return value;
}
export function safeError(error: unknown): string {
  // Error messages can include request values, credentials, or database
  // connection details. Retain only a generic operational status.
  return error instanceof Error ? 'operation failed' : 'unknown failure';
}

export const auditLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'guardian-angel-backend' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
});

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => auditLogger.debug(message, redactLogValue(meta)),
  info: (message: string, meta?: Record<string, unknown>) => auditLogger.info(message, redactLogValue(meta)),
  warn: (message: string, meta?: Record<string, unknown>) => auditLogger.warn(message, redactLogValue(meta)),
  error: (message: string, error?: unknown) => auditLogger.error(message, { error: safeError(error) }),
};
