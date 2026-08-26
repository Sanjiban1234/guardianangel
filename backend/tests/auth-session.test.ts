import jwt from 'jsonwebtoken';
import { AuthMiddleware } from '../src/middleware/AuthMiddleware';
import { JWT_AUDIENCE, JWT_ISSUER, JWT_SECRET } from '../src/config';
import { createAuthenticatedTestSession, installTestSessionValidator, resetTestSessions, revokeTestSession, expireTestSession, remapTestSession } from './helpers/auth';

const run = (token: string) => new Promise<number>((resolve) => AuthMiddleware.authenticateJWT(
  { headers: { authorization: `Bearer ${token}` } } as any,
  { status: (code: number) => ({ json: () => resolve(code) }) } as any,
  () => resolve(200),
));

describe('auth session enforcement', () => {
  beforeEach(() => { resetTestSessions(); installTestSessionValidator(); });
  it('accepts an active matching session', async () => {
    const { token } = createAuthenticatedTestSession({ id: 'u1', name: 'rider', role: 'rider' });
    await expect(run(token)).resolves.toBe(200);
  });
  it('rejects a signed token with no session', async () => {
    const token = jwt.sign({ id: 'u1', name: 'rider', role: 'rider' }, JWT_SECRET, { algorithm: 'HS256', issuer: JWT_ISSUER, audience: JWT_AUDIENCE, jwtid: 'missing', expiresIn: '1h' });
    await expect(run(token)).resolves.toBe(403);
  });
  it('rejects a revoked session', async () => {
    const { token, jti } = createAuthenticatedTestSession({ id: 'u1', name: 'rider', role: 'rider' });
    revokeTestSession(jti);
    await expect(run(token)).resolves.toBe(403);
  });
  it('rejects an expired server session despite a valid JWT', async () => {
    const { token, jti } = createAuthenticatedTestSession({ id: 'u1', name: 'rider', role: 'rider' });
    expireTestSession(jti);
    await expect(run(token)).resolves.toBe(403);
  });
  it('rejects a session mapped to another user', async () => {
    const { token, jti } = createAuthenticatedTestSession({ id: 'u1', name: 'rider', role: 'rider' });
    remapTestSession(jti, 'u2');
    await expect(run(token)).resolves.toBe(403);
  });
  it('rejects socket authentication without an active session', async () => {
    const token = jwt.sign({ id: 'u1', name: 'rider', role: 'rider' }, JWT_SECRET, { algorithm: 'HS256', issuer: JWT_ISSUER, audience: JWT_AUDIENCE, jwtid: 'missing', expiresIn: '1h' });
    await expect(new Promise<string>((resolve) => AuthMiddleware.authenticateSocket({ handshake: { auth: { token } } } as any, (error) => resolve(error?.message || 'accepted')))).resolves.toContain('Invalid or expired');
  });
});
