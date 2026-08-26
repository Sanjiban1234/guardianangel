import { auditLogger, logger } from '../src/utils/logger';
import { classifyStartupFailure, StartupInitializationError } from '../src/utils/StartupDiagnostics';

describe('startup diagnostics', () => {
  it('classifies TLS failures without emitting connection or certificate data', () => {
    const secret = 'postgres://railway-user:password@db.internal/guardian';
    const error = Object.assign(new Error(`${secret} -----BEGIN CERTIFICATE----- private material`), {
      code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    });

    const diagnostic = classifyStartupFailure(
      new StartupInitializationError('database-connect', error),
    );

    expect(diagnostic).toEqual({
      stage: 'database-connect',
      category: 'tls-verification-failed',
      code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    });
    expect(JSON.stringify(diagnostic)).not.toContain(secret);
    expect(JSON.stringify(diagnostic)).not.toContain('BEGIN CERTIFICATE');
  });

  it('reports PostgreSQL migration codes while excluding raw messages and values', () => {
    const error = Object.assign(new Error("constraint failed for room code ABC123 and user@example.test"), { code: '23514' });
    const diagnostic = classifyStartupFailure(new StartupInitializationError('schema-init', error));

    expect(diagnostic).toEqual({ stage: 'schema-init', category: 'schema-migration-failed', code: '23514' });
    expect(JSON.stringify(diagnostic)).not.toContain('ABC123');
    expect(JSON.stringify(diagnostic)).not.toContain('user@example.test');
  });

  it('logs only the allowlisted startup diagnostic', () => {
    const write = jest.spyOn(auditLogger, 'error').mockImplementation(() => auditLogger);
    const diagnostic = classifyStartupFailure(Object.assign(new Error('password=do-not-log'), { code: '28P01' }), 'database-connect');

    logger.startupError('server initialization failed', diagnostic);

    expect(write).toHaveBeenCalledWith('server initialization failed', {
      stage: 'database-connect',
      category: 'database-authentication-failed',
      code: '28P01',
      errorName: 'Error',
    });
    expect(JSON.stringify(write.mock.calls)).not.toContain('do-not-log');
    write.mockRestore();
  });
});
