import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthenticatedRequest } from '../middleware/AuthMiddleware';
import { UserService } from '../services/UserService';

// Rate limiting: enabled for tests when ENABLE_AUTH_RATE_LIMIT_TEST=true
const rateLimitMiddleware = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later' },
});

export const authLimiter = (req: any, res: any, next: any) => {
  if (process.env.ENABLE_AUTH_RATE_LIMIT_TEST === 'true') {
    return rateLimitMiddleware(req, res, next);
  }
  return next();
};

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
    const { name, email, password, phone } = req.body;

    if (!name || !email || !password || !phone) {
      res.status(400).json({ error: 'Name, email, password, and phone number are required' });
      return;
    }
    if (
      typeof name !== 'string' ||
      typeof email !== 'string' ||
      typeof password !== 'string' ||
      typeof phone !== 'string'
    ) {
      res.status(400).json({ error: 'Invalid input format' });
      return;
    }
    if (name.length > 50) {
      res.status(400).json({ error: 'Name must not exceed 50 characters' });
      return;
    }
    if (email.length > 255) {
      res.status(400).json({ error: 'Email must not exceed 255 characters' });
      return;
    }
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({ error: 'Invalid email format' });
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

    const trimmedPhone = phone.trim();
    // Normalize Nepali local numbers to E.164:
    // 10-digit numbers starting with 9 (e.g. 9812345678 → +9779812345678)
    const normalizedPhone = /^9\d{9}$/.test(trimmedPhone) ? `+977${trimmedPhone}` : trimmedPhone;

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

    if (!/^\+[1-9]\d{1,14}$/.test(normalizedPhone)) {
      res.status(400).json({ error: 'Invalid phone number format. Use E.164 (e.g. +9779812345678) or a 10-digit Nepali number (e.g. 9812345678)' });
      return;
    }

    try {
      const user = await this.userService.register(name, email.toLowerCase().trim(), password, normalizedPhone);
      res.status(201).json({
        message: 'User registered successfully',
        user: { id: user.id, name: user.name, email: user.email },
      });
    } catch (err: any) {
      if (err?.code === 'EMAIL_TAKEN') {
        res.status(409).json({ error: 'Email is already registered' });
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
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }
    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'Invalid input format' });
      return;
    }
    if (email.length > 255 || password.length > 128) {
      res.status(400).json({ error: 'Input exceeds maximum length' });
      return;
    }

    try {
      const result = await this.userService.login(email.toLowerCase().trim(), password);
      res.status(200).json(result);
    } catch (err: any) {
      if (err?.code === 'AUTH_FAILED') {
        res.status(401).json({ error: 'Invalid email or password' });
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
