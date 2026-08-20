import { Response, Router } from 'express';
import { AuthMiddleware, AuthenticatedRequest } from '../middleware/AuthMiddleware';
import { UserService } from '../services/UserService';

export class UserProfileRouter {
  readonly router = Router();

  constructor(private readonly userService: UserService) {
    this.router.get('/users/profile', AuthMiddleware.authenticateJWT, (req, res) => this.get(req as AuthenticatedRequest, res));
    this.router.patch('/users/profile', AuthMiddleware.authenticateJWT, (req, res) => this.update(req as AuthenticatedRequest, res));
  }

  private async get(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    try {
      const profile = await this.userService.getVehicleProfile(userId);
      if (!profile) { res.status(404).json({ error: 'User not found' }); return; }
      res.status(200).json({ profile });
    } catch (error) {
      console.error('UserProfileRouter.get error:', error);
      res.status(500).json({ error: 'Unable to load rider profile' });
    }
  }

  private async update(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user?.id;
    const { vehicle_model, plate_number, vehicle_color } = req.body || {};
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (typeof vehicle_model !== 'string' || typeof plate_number !== 'string' || typeof vehicle_color !== 'string') {
      res.status(400).json({ error: 'Vehicle model, plate number, and vehicle color are required' });
      return;
    }
    try {
      const profile = await this.userService.updateVehicleProfile(userId, vehicle_model, plate_number, vehicle_color);
      res.status(200).json({ profile });
    } catch (error: any) {
      if (error?.code === 'INVALID_PROFILE') { res.status(400).json({ error: error.message }); return; }
      if (error?.code === 'USER_NOT_FOUND') { res.status(404).json({ error: error.message }); return; }
      console.error('UserProfileRouter.update error:', error);
      res.status(500).json({ error: 'Unable to update rider profile' });
    }
  }
}
