import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthMiddleware, AuthenticatedRequest } from '../middleware/AuthMiddleware';
import { RoomService } from '../services/RoomService';
import { PostgisTelemetryRepository } from '../repositories/PostgisTelemetryRepository';

const joinRoomLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many join attempts. Try again in 15 minutes.' },
});

export class RoomRouter {
  readonly router: Router;

  constructor(
    private readonly roomService: RoomService,
    private readonly telemetryRepo?: PostgisTelemetryRepository
  ) {
    this.router = Router();
    this.registerRoutes();
  }

  private registerRoutes(): void {
    this.router.get('/health', (_req: Request, res: Response) => {
      res.status(200).json({ status: 'healthy', timestamp: Date.now() });
    });

    this.router.post(
      '/rooms',
      AuthMiddleware.authenticateJWT,
      (req, res) => this.handleCreateRoom(req as AuthenticatedRequest, res)
    );

    this.router.post(
      '/rooms/join',
      AuthMiddleware.authenticateJWT,
      joinRoomLimiter,
      (req, res) => this.handleJoinRoom(req as AuthenticatedRequest, res)
    );

    this.router.get(
      '/rooms/:groupCode/history',
      AuthMiddleware.authenticateJWT,
      (req, res) => this.handleGetHistory(req as AuthenticatedRequest, res)
    );

    this.router.get(
      '/rooms/:groupCode/summary',
      AuthMiddleware.authenticateJWT,
      (req, res) => this.handleGetSummary(req as AuthenticatedRequest, res)
    );
  }

  private async handleCreateRoom(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized: Missing user credentials' });
      return;
    }

    try {
      const result = await this.roomService.createRoom(userId);
      res.status(201).json(result);
    } catch (err) {
      console.error('RoomRouter.createRoom error:', err);
      res.status(500).json({ error: 'Internal server error while creating ride room' });
    }
  }

  private async handleJoinRoom(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    const userId = req.user?.id;
    const { group_code } = req.body;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized: Missing user credentials' });
      return;
    }
    if (!group_code) {
      res.status(400).json({ error: 'Group code is required' });
      return;
    }
    if (typeof group_code !== 'string' || group_code.length > 32) {
      res.status(400).json({ error: 'Invalid group code format' });
      return;
    }

    try {
      const result = await this.roomService.joinRoom(userId, group_code);
      res.status(200).json({ message: 'Successfully joined ride group', room_id: result.room_id });
    } catch (err: any) {
      if (err?.code === 'ROOM_NOT_FOUND') {
        res.status(404).json({ error: 'Ride group not found' });
      } else if (err?.code === 'ROOM_ENDED') {
        res.status(400).json({ error: 'This ride group has already ended' });
      } else {
        console.error('RoomRouter.joinRoom error:', err);
        res.status(500).json({ error: 'Internal server error while joining ride group' });
      }
    }
  }

  private async handleGetHistory(
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
      const isMember = await this.roomService.isMember(groupCode, userId);
      if (!isMember) {
        res.status(403).json({
          error: 'Forbidden: You are not a member of this ride group',
        });
        return;
      }

      const history = await this.roomService.getRoomHistory(groupCode);
      res.status(200).json(history);
    } catch (err) {
      console.error('RoomRouter.getHistory error:', err);
      res.status(500).json({ error: 'Internal server error while fetching telemetry history' });
    }
  }
  private async handleGetSummary(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    const userId = req.user?.id;
    const { groupCode } = req.params;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized: Missing user credentials' });
      return;
    }

    if (!this.telemetryRepo) {
      res.status(503).json({ error: 'Telemetry repository not available' });
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

      const [totalDistance, durationMs] = await Promise.all([
        this.telemetryRepo.totalDistanceMeters(room.id, userId, 0, Date.now()),
        this.telemetryRepo.rideDurationMs(room.id, userId),
      ]);

      res.status(200).json({
        room_id: room.id,
        user_id: userId,
        total_distance_meters: totalDistance,
        duration_ms: durationMs,
      });
    } catch (err) {
      console.error('RoomRouter.getSummary error:', err);
      res.status(500).json({ error: 'Internal server error while fetching ride summary' });
    }
  }
}

export function createRoomRouter(roomService: RoomService, telemetryRepo?: PostgisTelemetryRepository): Router {
  return new RoomRouter(roomService, telemetryRepo).router;
}
