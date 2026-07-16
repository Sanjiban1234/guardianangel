import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/AuthMiddleware';
import { UserService } from '../services/UserService';

export class AuthRouter {
  readonly router: Router;

  constructor(private readonly userService: UserService) {
    this.router = Router();
    this.registerRoutes();
  }

  private registerRoutes(): void {
    this.router.post('/register', (req, res) => this.handleRegister(req as AuthenticatedRequest, res));
    this.router.post('/login', (req, res) => this.handleLogin(req as AuthenticatedRequest, res));
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
    if (name.length > 100 || password.length > 128 || phone.length > 20) {
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
