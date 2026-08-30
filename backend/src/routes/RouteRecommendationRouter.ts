import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { ROUTE_RECOMMENDATION } from '../config';
import { AuthenticatedRequest, AuthMiddleware } from '../middleware/AuthMiddleware';
import { AiRouteRecommendationService } from '../services/AiRouteRecommendationService';
import { decodePolyline, routeWithProgress } from '../services/RouteGeometry';
import { logger } from '../utils/logger';

const recommendationLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });

export class RouteRecommendationRouter {
  readonly router = Router();
  constructor(private readonly service = new AiRouteRecommendationService()) {
    this.router.post('/routes/recommendations', recommendationLimiter, AuthMiddleware.authenticateJWT, (req, res) => void this.handle(req as AuthenticatedRequest, res));
  }
  private async handle(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { origin, destination, routePolyline, routeDistanceMeters } = req.body || {};
    const coordinateValid = (value: any) => value && Number.isFinite(value.latitude) && value.latitude >= -90 && value.latitude <= 90 && Number.isFinite(value.longitude) && value.longitude >= -180 && value.longitude <= 180;
    if (!coordinateValid(origin) || !coordinateValid(destination) || typeof routePolyline !== 'string' || !routePolyline.length || routePolyline.length > ROUTE_RECOMMENDATION.maximumPolylineCharacters || !Number.isFinite(routeDistanceMeters) || routeDistanceMeters <= 0 || routeDistanceMeters > ROUTE_RECOMMENDATION.maximumRouteMeters) {
      res.status(400).json({ error: 'Invalid or oversized route payload' }); return;
    }
    try {
      const decoded = decodePolyline(routePolyline);
      if (decoded.length < 2 || decoded.length > 5_000) { res.status(400).json({ error: 'Invalid or oversized route polyline' }); return; }
      const route = routeWithProgress(decoded);
      const recommendations = await this.service.recommend(route, routeDistanceMeters, `${routePolyline}:${Math.round(routeDistanceMeters / 100)}`);
      res.json({ generatedAt: new Date().toISOString(), routeDistanceMeters, recommendations });
    } catch (error) {
      logger.warn('route recommendation request failed');
      res.status(error instanceof Error && error.message.includes('polyline') ? 400 : 503).json({ error: 'Route recommendations are temporarily unavailable' });
    }
  }
}
