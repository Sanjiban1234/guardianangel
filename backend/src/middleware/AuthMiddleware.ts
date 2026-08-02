import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Socket } from 'socket.io';
import { JWT_AUDIENCE, JWT_ISSUER, JWT_SECRET } from '../config';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    name: string;
  };
}

export interface AuthenticatedSocket extends Socket {
  user?: {
    id: string;
    name: string;
  };
}

export class AuthMiddleware {
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

    const token = authHeader.split(' ')[1];

    AuthMiddleware.verifyToken(token, (err, user) => {
      if (err) {
        res.status(403).json({ error: 'Forbidden: Invalid or expired token' });
        return;
      }
      req.user = user as { id: string; name: string };
      next();
    });
  }

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
      socket.user = decoded as { id: string; name: string };
      next();
    });
  }
}
