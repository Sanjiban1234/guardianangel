import { Router, Response } from 'express';
import { AuthMiddleware, AuthenticatedRequest } from '../middleware/AuthMiddleware';
import { UserService } from '../services/UserService';

/**
 * AuthRouter — thin Express router that delegates all logic to UserService.
 * Responsible only for: HTTP plumbing, input validation, status-code mapping.
 */
export class AuthRouter {
  readonly router: Router;

  constructor(private readonly userService: UserService) {
    this.router = Router();
    this.registerRoutes();
  }

  private registerRoutes(): void {
    // POST /api/auth/register
    this.router.post('/register', (req, res) => this.handleRegister(req as AuthenticatedRequest, res));
    // POST /api/auth/login
    this.router.post('/login', (req, res) => this.handleLogin(req as AuthenticatedRequest, res));
  }

  // ─── POST /api/auth/register ─────────────────────────────────────────────

  private async handleRegister(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    const { username, password, phone } = req.body;

    // Input validation — kept in the router layer (no domain logic here)
    if (!username || !password || !phone) {
      res.status(400).json({ error: 'Username, password, and phone number are required' });
      return;
    }
    if (
      typeof username !== 'string' ||
      typeof password !== 'string' ||
      typeof phone !== 'string'
    ) {
      res.status(400).json({ error: 'Invalid input format' });
      return;
    }
    if (username.length > 50 || password.length > 128 || phone.length > 20) {
      res.status(400).json({ error: 'Input exceeds maximum length' });
      return;
    }
    if (
      password.length < 8 ||
      !/[a-zA-Z]/.test(password) ||
      !/[0-9]/.test(password)
    ) {
      res.status(400).json({
        error: 'Password must be at least 8 characters with letters and numbers',
      });
      return;
    }
    if (!/^\+?[1-9]\d{7,14}$/.test(phone)) {
      res.status(400).json({ error: 'Invalid phone number format' });
      return;
    }

    try {
      const user = await this.userService.register(username, password, phone);
      res.status(201).json({
        message: 'User registered successfully',
        user: { id: user.id, username: user.username },
      });
    } catch (err: any) {
      if (err?.code === 'USERNAME_TAKEN') {
        res.status(409).json({ error: 'Username is already taken' });
      } else {
        console.error('AuthRouter.register error:', err);
        res.status(500).json({ error: 'Internal server error during registration' });
      }
    }
  }

  // ─── POST /api/auth/login ─────────────────────────────────────────────────

  private async handleLogin(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    try {
      const result = await this.userService.login(username, password);
      res.status(200).json(result);
    } catch (err: any) {
      if (err?.code === 'AUTH_FAILED') {
        res.status(401).json({ error: 'Invalid username or password' });
      } else {
        console.error('AuthRouter.login error:', err);
        res.status(500).json({ error: 'Internal server error during login' });
      }
    }
  }
}

// ─── Factory helper ──────────────────────────────────────────────────────────

/**
 * Convenience factory used in index.ts to mount the auth router.
 * Keeps the class constructor signature clean and avoids manual wiring errors.
 */
export function createAuthRouter(userService: UserService): Router {
  return new AuthRouter(userService).router;
}
