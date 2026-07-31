import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthenticatedRequest } from '../middleware/AuthMiddleware';
import { UserService } from '../services/UserService';

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again after 15 minutes.' },
  skip: () => process.env.NODE_ENV === 'test' && process.env.ENABLE_AUTH_RATE_LIMIT_TEST !== 'true',
});

export class AuthRouter {
  readonly router: Router;

  constructor(private readonly userService: UserService) {
    this.router = Router();
    this.registerRoutes();
  }

  private registerRoutes(): void {
    this.router.post('/register', authLimiter, (req, res) => this.handleRegister(req as AuthenticatedRequest, res));
    this.router.post('/login', authLimiter, (req, res) => this.handleLogin(req as AuthenticatedRequest, res));
  }

  private async handleRegister(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    const { name, password, phone } = req.body;

    if (!name || !password || !phone) {
      res.status(400).json({ error: 'Name, password, and phone number are required' });
      return;
    }
    if (
      typeof name !== 'string' ||
      typeof password !== 'string' ||
      typeof phone !== 'string'
    ) {
      res.status(400).json({ error: 'Invalid input format' });
      return;
    }
    if (name.length > 50) {
      res.status(400).json({ error: 'Username must not exceed 50 characters' });
      return;
    }
    if (password.length > 128) {
      res.status(400).json({ error: 'Password must not exceed 128 characters' });
      return;
    }
    if (phone.length > 20) {
      res.status(400).json({ error: 'Phone number must not exceed 20 characters' });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters long' });
      return;
    }
    if (!/[A-Z]/.test(password)) {
      res.status(400).json({ error: 'Password must contain at least one uppercase letter' });
      return;
    }
    if (!/[a-z]/.test(password)) {
      res.status(400).json({ error: 'Password must contain at least one lowercase letter' });
      return;
    }
    if (!/[0-9]/.test(password)) {
      res.status(400).json({ error: 'Password must contain at least one number' });
      return;
    }

    if (!/^\+[1-9]\d{1,14}$/.test(phone)) {
      res.status(400).json({ error: 'Invalid phone number format. Must be E.164 format (e.g. +1234567890)' });
      return;
    }

    try {
      const user = await this.userService.register(name, password, phone);
      res.status(201).json({
        message: 'User registered successfully',
        user: { id: user.id, name: user.name },
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

  private async handleLogin(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    const { name, password } = req.body;

    if (!name || !password) {
      res.status(400).json({ error: 'Name and password are required' });
      return;
    }
    if (typeof name !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'Invalid input format' });
      return;
    }
    if (name.length > 50 || password.length > 128) {
      res.status(400).json({ error: 'Input exceeds maximum length' });
      return;
    }

    try {
      const result = await this.userService.login(name, password);
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

export function createAuthRouter(userService: UserService): Router {
  return new AuthRouter(userService).router;
}
