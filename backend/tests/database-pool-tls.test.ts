const validCa = '-----BEGIN CERTIFICATE-----\nYWJjZA==\n-----END CERTIFICATE-----';

describe('database pool TLS construction', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalCa = process.env.DATABASE_CA_CERT;

  const restore = (name: 'NODE_ENV' | 'DATABASE_URL' | 'DATABASE_CA_CERT', value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  const createPoolMock = () => jest.fn().mockImplementation(() => ({ on: jest.fn() }));

  afterEach(() => {
    restore('NODE_ENV', originalNodeEnv);
    restore('DATABASE_URL', originalDatabaseUrl);
    restore('DATABASE_CA_CERT', originalCa);
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('passes verified TLS options to every production Pool', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://example.invalid/postgres';
    process.env.DATABASE_CA_CERT = validCa;
    const Pool = createPoolMock();
    jest.doMock('pg', () => ({ Pool }));

    jest.isolateModules(() => require('../src/db'));

    expect(Pool).toHaveBeenCalledTimes(2);
    for (const [options] of Pool.mock.calls) {
      expect(options).toMatchObject({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: true, ca: validCa },
      });
    }
  });

  it('fails closed before constructing a production Pool when the CA is missing', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://example.invalid/postgres';
    delete process.env.DATABASE_CA_CERT;
    const Pool = createPoolMock();
    jest.doMock('pg', () => ({ Pool }));

    expect(() => jest.isolateModules(() => require('../src/db'))).toThrow('startup initialization failed');
    expect(Pool).not.toHaveBeenCalled();
  });

  it('keeps development without a CA unchanged', () => {
    process.env.NODE_ENV = 'development';
    process.env.DATABASE_URL = 'postgresql://example.invalid/postgres';
    delete process.env.DATABASE_CA_CERT;
    const Pool = createPoolMock();
    jest.doMock('pg', () => ({ Pool }));

    jest.isolateModules(() => require('../src/db'));

    for (const [options] of Pool.mock.calls) expect(options.ssl).toBeUndefined();
  });

  it('uses verified TLS when a CA is supplied even if NODE_ENV was omitted by the host', () => {
    delete process.env.NODE_ENV;
    process.env.DATABASE_URL = 'postgresql://example.invalid/postgres';
    process.env.DATABASE_CA_CERT = validCa;
    const Pool = createPoolMock();
    jest.doMock('pg', () => ({ Pool }));

    jest.isolateModules(() => require('../src/db'));

    for (const [options] of Pool.mock.calls) {
      expect(options.ssl).toMatchObject({ rejectUnauthorized: true, ca: validCa });
    }
  });
});
