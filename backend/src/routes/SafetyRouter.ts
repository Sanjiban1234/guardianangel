import { Router, Response } from 'express';
import { AuthMiddleware, AuthenticatedRequest } from '../middleware/AuthMiddleware';
import { QueryRunner } from '../db/QueryRunner';
import { MAX_BULK_BATCH } from '../config';

export class SafetyRouter {
  readonly router: Router;

  constructor(private readonly db: QueryRunner) {
    this.router = Router();
    this.registerRoutes();
  }

  private registerRoutes(): void {
    this.router.get(
      '/safety/config',
      AuthMiddleware.authenticateJWT,
      (_req, res) => this.handleGetConfig(_req as AuthenticatedRequest, res)
    );

    this.router.get(
      '/safety/stats',
      AuthMiddleware.authenticateJWT,
      (_req, res) => this.handleGetStats(_req as AuthenticatedRequest, res)
    );
  }

  private handleGetConfig(_req: AuthenticatedRequest, res: Response): void {
    res.status(200).json({
      impactThreshold: 4.0,
      stillnessThreshold: 0.5,
      confirmWindowMs: 15000,
      telemetrySampleRateMs: 1000,
      maxBulkBatch: MAX_BULK_BATCH,
    });
  }

  private async handleGetStats(
    _req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    try {
      const result = await this.db.run(
        `SELECT
           COUNT(*)::int AS total_crashes,
           COUNT(*) FILTER (WHERE outcome = 'confirmed')::int AS confirmed,
           COUNT(*) FILTER (WHERE outcome = 'false_alarm')::int AS false_alarms
         FROM crash_candidates`
      );

      const row = result.rows[0] || { total_crashes: 0, confirmed: 0, false_alarms: 0 };
      const totalCrashes = Number(row.total_crashes || 0);
      const confirmed = Number(row.confirmed || 0);
      const falseAlarms = Number(row.false_alarms || 0);
      const evaluated = confirmed + falseAlarms;
      const falsePositiveRate = evaluated > 0 ? Number((falseAlarms / evaluated).toFixed(3)) : 0;

      res.status(200).json({
        totalCrashes,
        confirmed,
        falseAlarms,
        falsePositiveRate,
        avgConfirmationTime: 15.0,
      });
    } catch (err) {
      console.error('SafetyRouter.getStats error:', err);
      res.status(500).json({ error: 'Internal server error while fetching safety stats' });
    }
  }
}

export function createSafetyRouter(db: QueryRunner): Router {
  return new SafetyRouter(db).router;
}
