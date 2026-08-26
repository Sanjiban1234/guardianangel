import { Router, Response } from 'express';
import { AuthMiddleware, AuthenticatedRequest } from '../middleware/AuthMiddleware';
import { FcmPushService } from '../services/FcmPushService';
import { logger } from '../utils/logger';

export class DeviceRouter {
  readonly router: Router;

  constructor(private readonly fcmPushService: FcmPushService) {
    this.router = Router();
    this.registerRoutes();
  }

  private registerRoutes(): void {
    this.router.post(
      '/devices/register',
      AuthMiddleware.authenticateJWT,
      (req, res) => this.handleRegister(req as AuthenticatedRequest, res)
    );
  }

  private async handleRegister(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { token, platform } = req.body || {};

    if (!token || typeof token !== 'string' || token.trim() === '' || token.length > 4096) {
      res.status(400).json({ error: 'token must be a non-empty string' });
      return;
    }

    if (platform !== 'ios' && platform !== 'android') {
      res.status(400).json({ error: 'platform must be either "ios" or "android"' });
      return;
    }

    try {
      await this.fcmPushService.registerDeviceToken(
        userId,
        token.trim(),
        platform
      );
      res.status(200).json({ message: 'Device token registered successfully' });
    } catch (err) {
      logger.error('device registration failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}
