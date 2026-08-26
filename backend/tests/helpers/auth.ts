import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { AuthMiddleware, AuthenticatedUser } from '../../src/middleware/AuthMiddleware';
import { JWT_AUDIENCE, JWT_ISSUER, JWT_SECRET } from '../../src/config';

const sessions = new Map<string, { userId: string; expiresAt: number; revoked: boolean }>();

/** Test-only fixture that mirrors production claims and active-session checks. */
export function createAuthenticatedTestSession(user: AuthenticatedUser): { token: string; jti: string } {
  const jti = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
  sessions.set(jti, { userId: user.id, expiresAt, revoked: false });
  return {
    jti,
    token: jwt.sign({ ...user }, JWT_SECRET, { algorithm: 'HS256', issuer: JWT_ISSUER, audience: JWT_AUDIENCE, jwtid: jti, expiresIn: '24h' }),
  };
}

export function installTestSessionValidator(): void {
  AuthMiddleware.configureSessionValidator(async (jti, userId) => {
    const session = sessions.get(jti);
    return Boolean(session && !session.revoked && session.userId === userId && session.expiresAt > Math.floor(Date.now() / 1000));
  });
}

export function resetTestSessions(): void { sessions.clear(); }
export function revokeTestSession(jti: string): void { const session = sessions.get(jti); if (session) session.revoked = true; }
export function expireTestSession(jti: string): void { const session = sessions.get(jti); if (session) session.expiresAt = 0; }
export function remapTestSession(jti: string, userId: string): void { const session = sessions.get(jti); if (session) session.userId = userId; }
