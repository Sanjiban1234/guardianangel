describe('database TLS configuration', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalCa = process.env.DATABASE_CA_CERT;
  afterEach(() => { process.env.NODE_ENV = originalEnv; if (originalCa === undefined) delete process.env.DATABASE_CA_CERT; else process.env.DATABASE_CA_CERT = originalCa; jest.resetModules(); });

  it('fails closed without a production CA', () => {
    process.env.NODE_ENV = 'production'; delete process.env.DATABASE_CA_CERT;
    jest.isolateModules(() => expect(require('../src/db/TlsConfig').getDatabaseSslConfig).toThrow('startup initialization failed'));
  });
  it('enables certificate verification with a configured CA', () => {
    process.env.NODE_ENV = 'production'; process.env.DATABASE_CA_CERT = '"  -----BEGIN CERTIFICATE-----\\nYWJjZA==\\n-----END CERTIFICATE-----  "';
    jest.isolateModules(() => expect(require('../src/db/TlsConfig').getDatabaseSslConfig()).toMatchObject({ rejectUnauthorized: true, ca: '-----BEGIN CERTIFICATE-----\nYWJjZA==\n-----END CERTIFICATE-----' }));
  });
  it('rejects non-certificate and private-key environment values', () => {
    process.env.NODE_ENV = 'production'; process.env.DATABASE_CA_CERT = '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----';
    jest.isolateModules(() => expect(require('../src/db/TlsConfig').getDatabaseSslConfig).toThrow('startup initialization failed'));
    process.env.DATABASE_CA_CERT = 'not a PEM';
    jest.isolateModules(() => expect(require('../src/db/TlsConfig').getDatabaseSslConfig).toThrow('startup initialization failed'));
  });
});
