import { Router, Response } from 'express';
import { AuthMiddleware, AuthenticatedRequest } from '../middleware/AuthMiddleware';
import { QueryRunner } from '../db/QueryRunner';

export interface GeofenceInput {
  name: string;
  type: 'hazard' | 'dead_zone';
  area: Array<{ latitude: number; longitude: number }>;
}

export class GeofenceRouter {
  readonly router: Router;

  constructor(private readonly db: QueryRunner) {
    this.router = Router();
    this.registerRoutes();
  }

  private registerRoutes(): void {
    this.router.post(
      '/geofences',
      AuthMiddleware.authenticateJWT,
      (req, res) => this.handleCreate(req as AuthenticatedRequest, res)
    );

    this.router.get(
      '/geofences',
      AuthMiddleware.authenticateJWT,
      (req, res) => this.handleList(req as AuthenticatedRequest, res)
    );

    this.router.patch(
      '/geofences/:id',
      AuthMiddleware.authenticateJWT,
      (req, res) => this.handleUpdate(req as AuthenticatedRequest, res)
    );

    this.router.delete(
      '/geofences/:id',
      AuthMiddleware.authenticateJWT,
      (req, res) => this.handleDelete(req as AuthenticatedRequest, res)
    );
  }

  private async handleCreate(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    const { name, type, area } = req.body as GeofenceInput;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }
    if (type !== 'hazard' && type !== 'dead_zone') {
      res.status(400).json({ error: 'Type must be "hazard" or "dead_zone"' });
      return;
    }
    if (!Array.isArray(area) || area.length < 3) {
      res.status(400).json({ error: 'Area must be an array of at least 3 coordinate points' });
      return;
    }
    for (const point of area) {
      if (
        typeof point.latitude !== 'number' || typeof point.longitude !== 'number' ||
        point.latitude < -90 || point.latitude > 90 ||
        point.longitude < -180 || point.longitude > 180
      ) {
        res.status(400).json({ error: 'Each point must have valid latitude (-90..90) and longitude (-180..180)' });
        return;
      }
    }

    try {
      const polygonWKT = this.pointsToPolygonWKT(area);

      const result = await this.db.run(
        `INSERT INTO geofences (name, area, type)
         VALUES ($1, ST_SetSRID(ST_GeomFromText($2), 4326)::geography, $3)
         RETURNING id, name, type, is_active, created_at`,
        [name.trim(), polygonWKT, type]
      );

      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error('GeofenceRouter.create error:', err);
      res.status(500).json({ error: 'Internal server error while creating geofence' });
    }
  }

  private async handleList(
    _req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    try {
      const result = await this.db.run(
        `SELECT id, name, type, is_active, created_at
         FROM geofences
         WHERE is_active = true
         ORDER BY created_at DESC`,
        []
      );

      res.status(200).json(result.rows);
    } catch (err) {
      console.error('GeofenceRouter.list error:', err);
      res.status(500).json({ error: 'Internal server error while listing geofences' });
    }
  }

  private async handleUpdate(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    const { id } = req.params;
    const { name, type, is_active } = req.body;

    const setClauses: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({ error: 'Name must be a non-empty string' });
        return;
      }
      setClauses.push(`name = $${paramIdx++}`);
      params.push(name.trim());
    }
    if (type !== undefined) {
      if (type !== 'hazard' && type !== 'dead_zone') {
        res.status(400).json({ error: 'Type must be "hazard" or "dead_zone"' });
        return;
      }
      setClauses.push(`type = $${paramIdx++}`);
      params.push(type);
    }
    if (is_active !== undefined) {
      if (typeof is_active !== 'boolean') {
        res.status(400).json({ error: 'is_active must be a boolean' });
        return;
      }
      setClauses.push(`is_active = $${paramIdx++}`);
      params.push(is_active);
    }

    if (setClauses.length === 0) {
      res.status(400).json({ error: 'No valid fields to update' });
      return;
    }

    params.push(id);

    try {
      const result = await this.db.run(
        `UPDATE geofences SET ${setClauses.join(', ')}
         WHERE id = $${paramIdx}
         RETURNING id, name, type, is_active, created_at`,
        params
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Geofence not found' });
        return;
      }

      res.status(200).json(result.rows[0]);
    } catch (err) {
      console.error('GeofenceRouter.update error:', err);
      res.status(500).json({ error: 'Internal server error while updating geofence' });
    }
  }

  private async handleDelete(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    const { id } = req.params;

    try {
      const result = await this.db.run(
        `UPDATE geofences SET is_active = false
         WHERE id = $1 AND is_active = true
         RETURNING id`,
        [id]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Geofence not found or already inactive' });
        return;
      }

      res.status(200).json({ message: 'Geofence deactivated', id: result.rows[0].id });
    } catch (err) {
      console.error('GeofenceRouter.delete error:', err);
      res.status(500).json({ error: 'Internal server error while deactivating geofence' });
    }
  }

  private pointsToPolygonWKT(points: Array<{ latitude: number; longitude: number }>): string {
    const coords = points.map(p => `${p.longitude} ${p.latitude}`);
    const first = points[0];
    const last = points[points.length - 1];
    if (first.latitude !== last.latitude || first.longitude !== last.longitude) {
      coords.push(`${first.longitude} ${first.latitude}`);
    }
    return `POLYGON((${coords.join(', ')}))`;
  }
}

export function createGeofenceRouter(db: QueryRunner): Router {
  return new GeofenceRouter(db).router;
}
