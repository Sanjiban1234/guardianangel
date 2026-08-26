import type { ConnectionOptions } from 'tls';
import { StartupInitializationError } from '../utils/StartupDiagnostics';

function invalidCertificateConfiguration(code: 'DATABASE_CA_CERT_MISSING' | 'DATABASE_CA_CERT_INVALID'): never {
  throw new StartupInitializationError('tls', { code }, 'configuration-invalid');
}

/** Normalizes Railway's literal or escaped multiline PEM environment value. */
function parseDatabaseCa(rawCa: string | undefined): string {
  if (!rawCa?.trim()) invalidCertificateConfiguration('DATABASE_CA_CERT_MISSING');

  let ca = rawCa.trim();
  if ((ca.startsWith('"') && ca.endsWith('"')) || (ca.startsWith("'") && ca.endsWith("'"))) {
    ca = ca.slice(1, -1).trim();
  }
  ca = ca.replace(/\\r?n/g, '\n').trim();

  if (/-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/.test(ca)) {
    invalidCertificateConfiguration('DATABASE_CA_CERT_INVALID');
  }
  const certificateChain = /^(?:-----BEGIN CERTIFICATE-----\s+[A-Za-z0-9+/=\s]+-----END CERTIFICATE-----\s*)+$/;
  if (!certificateChain.test(ca)) invalidCertificateConfiguration('DATABASE_CA_CERT_INVALID');
  return ca;
}

/** Build pg TLS configuration without ever weakening production verification. */
export function getDatabaseSslConfig(): ConnectionOptions | undefined {
  // A managed deployment may omit NODE_ENV while still supplying its database
  // trust anchor. Never silently discard that explicit TLS configuration.
  // Local development remains plaintext unless a CA is deliberately supplied.
  if (process.env.NODE_ENV !== 'production' && !process.env.DATABASE_CA_CERT?.trim()) return undefined;
  return { rejectUnauthorized: true, ca: parseDatabaseCa(process.env.DATABASE_CA_CERT) };
}
