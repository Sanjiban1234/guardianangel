describe('database TLS configuration', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalCa = process.env.DATABASE_CA_CERT;
  afterEach(() => { process.env.NODE_ENV = originalEnv; if (originalCa === undefined) delete process.env.DATABASE_CA_CERT; else process.env.DATABASE_CA_CERT = originalCa; jest.resetModules(); });

  it('fails closed without a production CA', () => {
    process.env.NODE_ENV = 'production'; delete process.env.DATABASE_CA_CERT;
    jest.isolateModules(() => expect(require('../src/db/TlsConfig').getDatabaseSslConfig).toThrow('DATABASE_CA_CERT'));
  });
  it('enables certificate verification with a configured CA', () => {
    process.env.NODE_ENV = 'production'; process.env.DATABASE_CA_CERT = 'test-ca';
    jest.isolateModules(() => expect(require('../src/db/TlsConfig').getDatabaseSslConfig()).toMatchObject({ rejectUnauthorized: true, ca: 'test-ca' }));
  });
});
