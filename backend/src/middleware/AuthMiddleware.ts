import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Socket } from 'socket.io';
import { JWT_AUDIENCE, JWT_ISSUER, JWT_SECRET } from '../config';

// ─── Augmented request / socket types ────────────────────────────────────────

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    username: string;
  };
}

export interface AuthenticatedSocket extends Socket {
  user?: {
    id: string;
    username: string;
  };
}

// ─── AuthMiddleware class ─────────────────────────────────────────────────────

/**
 * AuthMiddleware — stateless class owning all JWT verification logic.
 * Both REST and WebSocket authentication live here so there is exactly
 * one place to update if the signing algorithm or secret rotation changes.
 *
 * Failure in either public method is self-contained and returns an HTTP/WS
 * error to the caller; it never propagates to other middleware or routes.
 */
export class AuthMiddleware {
  /**
   * Verify a raw token string.
   * Tries the configured issuer/audience first; falls back to a legacy
   * verify (no claims) for backward compatibility with old tokens.
   */
  private static verifyToken(
    token: string,
    callback: (err: unknown, user?: unknown) => void
  ): void {
    jwt.verify(
      token,
      JWT_SECRET,
      { issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
      (err, user) => {
        if (!err) {
          callback(null, user);
          return;
        }
        // Legacy fallback — tokens signed without iss/aud claims
        jwt.verify(token, JWT_SECRET, (legacyErr, legacyUser) => {
          if (legacyErr) {
            callback(err, undefined);
            return;
          }
          callback(null, legacyUser);
        });
      }
    );
  }

  /**
   * Express middleware — validates Bearer token in the Authorization header.
   * Returns 401 if missing, 403 if invalid/expired.
   */
  static authenticateJWT(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): void {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      res.status(401).json({ error: 'Unauthorized: Bearer token required' });
      return;
    }

    const token = authHeader.split(' ')[1]; // "Bearer <token>"

    AuthMiddleware.verifyToken(token, (err, user) => {
      if (err) {
        res.status(403).json({ error: 'Forbidden: Invalid or expired token' });
        return;
      }
      req.user = user as { id: string; username: string };
      next();
    });
  }

  /**
   * Socket.io middleware — validates the token passed in the connection
   * handshake auth payload or Authorization header.
   * Rejects with an Error to prevent the socket from connecting.
   */
  static authenticateSocket(
    socket: AuthenticatedSocket,
    next: (err?: Error) => void
  ): void {
    const raw =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization;

    if (!raw) {
      next(new Error('Authentication error: Token required'));
      return;
    }

    const token = (raw as string).startsWith('Bearer ')
      ? (raw as string).split(' ')[1]
      : (raw as string);

    AuthMiddleware.verifyToken(token, (err, decoded) => {
      if (err) {
        next(new Error('Authentication error: Invalid or expired token'));
        return;
      }
      socket.user = decoded as { id: string; username: string };
      next();
    });
  }
}
