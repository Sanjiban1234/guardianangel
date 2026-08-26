import { Router, Response } from 'express';
import { AuthMiddleware, AuthenticatedRequest } from '../middleware/AuthMiddleware';
import { MedicalInfoService } from '../services/MedicalInfoService';
import { logger } from '../utils/logger';

export class MedicalInfoRouter {
  readonly router: Router;

  constructor(private readonly medicalService: MedicalInfoService) {
    this.router = Router();
    this.registerRoutes();
  }

  private registerRoutes(): void {
    this.router.post(
      '/users/medical-info',
      AuthMiddleware.authenticateJWT,
      (req, res) => this.handleUpsert(req as AuthenticatedRequest, res)
    );

    this.router.get(
      '/users/medical-info',
      AuthMiddleware.authenticateJWT,
      (req, res) => this.handleGet(req as AuthenticatedRequest, res)
    );

    this.router.delete(
      '/users/medical-info',
      AuthMiddleware.authenticateJWT,
      (req, res) => this.handleDelete(req as AuthenticatedRequest, res)
    );
  }

  private async handleUpsert(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    try {
      const updated = await this.medicalService.upsertMedicalInfo(userId, req.body || {});
      res.status(200).json({
        message: 'Medical info updated successfully',
        medical_info: updated,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update medical info';
      if (message.includes('Invalid blood group') || message.includes('Invalid emergency contact phone')) {
        res.status(400).json({ error: message });
      } else {
        logger.error('medical information update failed', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  private async handleGet(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    try {
      const info = await this.medicalService.getMedicalInfo(userId);
      res.status(200).json({ medical_info: info });
    } catch (err) {
      logger.error('medical information read failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private async handleDelete(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    try {
      await this.medicalService.deleteMedicalInfo(userId);
      res.status(200).json({ message: 'Medical info deleted successfully' });
    } catch (err) {
      logger.error('medical information delete failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}
