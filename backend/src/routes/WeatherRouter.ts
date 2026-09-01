import { Router, Response } from 'express';
import { AuthMiddleware, AuthenticatedRequest } from '../middleware/AuthMiddleware';
import { RoomService } from '../services/RoomService';
import { WeatherService } from '../services/WeatherService';
import { logger } from '../utils/logger';
import { evaluateWeatherAdvisories } from '../services/WeatherSafetyRules';
import type { RouteWeatherPoint, WeatherPoint } from '@guardian-angel/contracts/weather';
import type { NormalizedWeather } from '@guardian-angel/contracts/weather';
import { WeatherProviderError } from '../services/OpenMeteoWeatherProvider';

export class WeatherRouter {
  readonly router: Router;

  constructor(
    private readonly roomService: RoomService,
    private readonly weatherService: WeatherService
  ) {
    this.router = Router();
    this.registerRoutes();
  }

  private registerRoutes(): void {
    this.router.get(
      '/rooms/:groupCode/weather',
      AuthMiddleware.authenticateJWT,
      (req, res) => this.handleGetWeather(req as AuthenticatedRequest, res)
    );
    this.router.post('/rooms/:groupCode/weather/safety', AuthMiddleware.authenticateJWT, (req, res) => this.handleSafety(req as AuthenticatedRequest, res));
  }

  private validPoint(value: unknown): value is WeatherPoint {
    const p = value as WeatherPoint;
    return !!p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && p.latitude >= -90 && p.latitude <= 90 && p.longitude >= -180 && p.longitude <= 180;
  }
  private async handleSafety(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user?.id; if (!userId) { res.status(401).json({ error: 'Unauthorized: Missing user credentials' }); return; }
    const room = await this.roomService.verifyMembership(req.params.groupCode, userId);
    if (!room) { res.status(403).json({ error: 'Forbidden: You are not a member of this ride group' }); return; }
    if (room.status !== 'active') { res.status(409).json({ error: 'Weather is only available for active rides', code: 'RIDE_ENDED' }); return; }
    const body = req.body || {}; const route = Array.isArray(body.route) ? body.route : [];
    if ((body.destination && !this.validPoint(body.destination)) || route.length > 5 || route.some((x: unknown) => !this.validPoint((x as RouteWeatherPoint).location))) { res.status(400).json({ error: 'Invalid weather coordinates or route point limit' }); return; }
    try {
      const riderLocations = await this.weatherService.getRiderLocations(room.id); const currentPoint = body.start && this.validPoint(body.start) ? body.start : riderLocations.length ? this.weatherService.computeCentroid(riderLocations) : null;
      const failures: string[] = [];
      const optional = async (category: string, loader: () => Promise<NormalizedWeather>): Promise<NormalizedWeather | null> => { try { return await loader(); } catch (error) { failures.push(error instanceof WeatherProviderError ? error.reason : 'unknown'); logger.warn('weather_sample_failed', { category, reason: failures[failures.length - 1] }); return null; } };
      const current = currentPoint ? await optional('current', () => this.weatherService.currentAt(currentPoint)) : null;
      const destination = body.destination ? await optional('destination', () => this.weatherService.forecastAt(body.destination)) : null;
      const ahead = await Promise.all(route.map(async (entry: RouteWeatherPoint) => ({ location: entry.location, progress: entry.progress, weather: await optional('ahead', () => this.weatherService.forecastAt(entry.location, entry.etaAt ? new Date(entry.etaAt) : undefined)) })));
      const advisories = [current && evaluateWeatherAdvisories(current, 'current'), destination && evaluateWeatherAdvisories(destination, 'destination'), ...ahead.map(item => item.weather && evaluateWeatherAdvisories(item.weather, 'ahead'))].flat().filter(Boolean);
      const reason = failures.length ? (current || destination || ahead.some(item => item.weather) ? 'partial_failure' : failures[0]) : current ? undefined : 'no_location_data';
      res.status(200).json({ current, destination, ahead, advisories, fetchedAt: new Date().toISOString(), ...(reason ? { reason } : {}) });
    } catch { logger.warn('weather_provider_failed', { category: 'weather_provider_failed', reason: 'unknown' }); res.status(200).json({ current: null, destination: null, ahead: [], advisories: [], fetchedAt: new Date().toISOString(), reason: 'unknown' }); }
  }

  private async handleGetWeather(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    const userId = req.user?.id;
    const { groupCode } = req.params;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized: Missing user credentials' });
      return;
    }

    try {
      const room = await this.roomService.verifyMembership(groupCode, userId);
      if (!room) {
        res.status(403).json({
          error: 'Forbidden: You are not a member of this ride group',
        });
        return;
      }

      if (room.status !== 'active') {
        res.status(409).json({
          error: 'Weather is only available for active rides',
          code: 'RIDE_ENDED',
        });
        return;
      }

      const result = await this.weatherService.getWeatherForRoom(room.id);

      res.status(200).json({
        weather: result.weather,
        location: result.location,
        ...(result.reason && { reason: result.reason }),
      });
    } catch (err) {
      logger.error('weather request failed', err);
      res.status(500).json({ error: 'Internal server error while fetching weather' });
    }
  }
}

export function createWeatherRouter(
  roomService: RoomService,
  weatherService: WeatherService
): Router {
  return new WeatherRouter(roomService, weatherService).router;
}
