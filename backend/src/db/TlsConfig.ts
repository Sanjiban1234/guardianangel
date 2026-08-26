import type { ConnectionOptions } from 'tls';

/** Build pg TLS configuration without ever weakening production verification. */
export function getDatabaseSslConfig(): ConnectionOptions | undefined {
  if (process.env.NODE_ENV !== 'production') return undefined;
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, '\n');
  if (!ca) {
    throw new Error('FATAL: DATABASE_CA_CERT is required in production to verify PostgreSQL TLS.');
  }
  return { rejectUnauthorized: true, ca };
}
