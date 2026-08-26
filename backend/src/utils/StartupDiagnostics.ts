export type StartupStage = 'config' | 'tls' | 'database-connect' | 'schema-init' | 'server-listen';

export type StartupCategory =
  | 'configuration-invalid'
  | 'tls-verification-failed'
  | 'database-authentication-failed'
  | 'database-connection-failed'
  | 'schema-migration-failed'
  | 'server-listen-failed'
  | 'initialization-failed';

export interface StartupDiagnostic {
  stage: StartupStage;
  category: StartupCategory;
  code?: string;
  errorName?: string;
}

/**
 * Carries only an initialization stage across internal error boundaries. The
 * original error is intentionally not retained or logged here because pg and
 * TLS error messages can contain connection and certificate details.
 */
export class StartupInitializationError extends Error {
  readonly code?: string;

  constructor(
    readonly stage: StartupStage,
    error?: unknown,
    readonly category?: StartupCategory,
  ) {
    super('startup initialization failed');
    this.name = 'StartupInitializationError';
    this.code = getAllowedErrorCode(error);
  }
}

const TLS_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_SIGNATURE_FAILURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);
const CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
]);

function getRawCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/** Only emit standardized operating-system codes and PostgreSQL SQLSTATEs. */
export function getAllowedErrorCode(error: unknown): string | undefined {
  const code = getRawCode(error);
  if (!code) return undefined;
  if (TLS_CODES.has(code) || CONNECTION_CODES.has(code)) return code;
  if (/^[0-9A-Z]{5}$/.test(code)) return code;
  if (code === 'DATABASE_CA_CERT_INVALID' || code === 'DATABASE_CA_CERT_MISSING') return code;
  return undefined;
}

function genericErrorName(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  return error.name === 'Error' || error.name === 'TypeError' ? error.name : undefined;
}

export function classifyStartupFailure(error: unknown, fallbackStage: StartupStage = 'config'): StartupDiagnostic {
  const staged = error instanceof StartupInitializationError;
  const stage = staged ? error.stage : fallbackStage;
  const code = staged ? error.code : getAllowedErrorCode(error);
  let category: StartupCategory = staged && error.category ? error.category : 'initialization-failed';

  if (!staged || !error.category) {
    if (stage === 'config' || stage === 'tls') category = 'configuration-invalid';
    else if (stage === 'schema-init') category = 'schema-migration-failed';
    else if (stage === 'server-listen') category = 'server-listen-failed';
    else if (code && TLS_CODES.has(code)) category = 'tls-verification-failed';
    else if (code === '28P01') category = 'database-authentication-failed';
    else if (stage === 'database-connect') category = 'database-connection-failed';
  }

  return {
    stage,
    category,
    ...(code ? { code } : {}),
    ...(!staged && genericErrorName(error) ? { errorName: genericErrorName(error) } : {}),
  };
}
