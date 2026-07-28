import { Router, Response } from 'express';
import { AuthMiddleware, AuthenticatedRequest } from '../middleware/AuthMiddleware';
import { RoomService } from '../services/RoomService';
import { WeatherService } from '../services/WeatherService';

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
      console.error('WeatherRouter.getWeather error:', err);
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
