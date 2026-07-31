import { Router, Response } from 'express';
import { AuthMiddleware, AuthenticatedRequest } from '../middleware/AuthMiddleware';
import { QueryRunner } from '../db/QueryRunner';

export class SafetyRouter {
  readonly router: Router;

  constructor(private readonly db: QueryRunner) {
    this.router = Router();
    this.router.get(
      '/safety/stats',
      AuthMiddleware.authenticateJWT,
      AuthMiddleware.requireRole('admin'),
      (req, res) => this.handleStats(req as AuthenticatedRequest, res)
    );
  }

  private async handleStats(_req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const result = await this.db.run(
        `SELECT COUNT(*)::int AS total_crashes,
                COUNT(*) FILTER (WHERE outcome = 'confirmed')::int AS confirmed,
                COUNT(*) FILTER (WHERE outcome = 'false_alarm')::int AS false_alarms
         FROM crash_candidates`
      );
      const row = result.rows[0] ?? { total_crashes: 0, confirmed: 0, false_alarms: 0 };
      res.status(200).json({
        totalCrashes: Number(row.total_crashes),
        confirmed: Number(row.confirmed),
        falseAlarms: Number(row.false_alarms),
      });
    } catch (err) {
      console.error('SafetyRouter.stats error:', err);
      res.status(500).json({ error: 'Internal server error while loading safety stats' });
    }
  }
}

export function createSafetyRouter(db: QueryRunner): Router {
  return new SafetyRouter(db).router;
}
