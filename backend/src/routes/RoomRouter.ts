import { Router, Request, Response } from 'express';
import { AuthMiddleware, AuthenticatedRequest } from '../middleware/AuthMiddleware';
import { RoomService } from '../services/RoomService';
import { PostgisTelemetryRepository } from '../repositories/PostgisTelemetryRepository';

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
      const destination = this.parseDestination(req.body);
      if (!destination) {
        res.status(400).json({ error: 'A valid destination latitude and longitude are required' });
        return;
      }
      const result = await this.roomService.createRoom(userId, destination);
      res.status(201).json(result);
    } catch (err: any) {
      if (err?.code === 'PROFILE_INCOMPLETE') {
        res.status(403).json({ error: err.message, code: err.code });
        return;
      }
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
      res.status(400).json({ error: 'Group code is required', code: 'MISSING_GROUP_CODE' });
      return;
    }
    if (typeof group_code !== 'string') {
      res.status(400).json({ error: 'Invalid group code format', code: 'INVALID_GROUP_CODE' });
      return;
    }
    if (group_code.length < 4 || group_code.length > 32) {
      res.status(400).json({ error: 'Invalid group code format', code: 'INVALID_GROUP_CODE' });
      return;
    }
    if (!/^[A-Za-z0-9]+$/.test(group_code)) {
      res.status(400).json({ error: 'Group code must contain only letters and numbers', code: 'INVALID_GROUP_CODE' });
      return;
    }

    try {
      const result = await this.roomService.joinRoom(userId, group_code);
      res.status(200).json({
        message: 'Successfully joined ride group',
        room_id: result.room_id,
        destination: result.destination ?? null,
      });
    } catch (err: any) {
      if (err?.code === 'ROOM_NOT_FOUND') {
        res.status(404).json({ error: 'Room not found. Check the room code and try again.', code: 'ROOM_NOT_FOUND' });
      } else if (err?.code === 'ROOM_ENDED') {
        res.status(400).json({ error: 'This ride group has already ended', code: 'ROOM_ENDED' });
      } else if (err?.code === 'ROOM_EXPIRED') {
        res.status(410).json({ error: 'This ride group has expired', code: 'ROOM_EXPIRED' });
      } else if (err?.code === 'ROOM_FULL') {
        res.status(409).json({ error: 'This ride group is full', code: 'ROOM_FULL' });
      } else if (err?.code === 'ALREADY_MEMBER') {
        // A retry must be able to restore the same client state as a fresh
        // join.  In particular, the mobile client needs the persisted
        // destination to render its map after a transient REST retry.
        const room = await this.roomService.getRoomByCode(group_code);
        res.status(409).json({
          error: 'You are already a member of this ride group',
          code: 'ALREADY_MEMBER',
          room_id: err.room_id,
          destination: room?.destination ?? null,
        });
      } else if (err?.code === 'PROFILE_INCOMPLETE') {
        res.status(403).json({ error: err.message, code: 'PROFILE_INCOMPLETE' });
      } else {
        console.error('RoomRouter.joinRoom error:', err);
        res.status(500).json({ error: 'Internal server error while joining ride group', code: 'INTERNAL_ERROR' });
      }
    }
  }

  private parseDestination(body: unknown): { latitude: number; longitude: number; label?: string } | null {
    const b = body as Record<string, unknown>;
    const destination = b?.destination;
    if (!destination || typeof destination !== 'object') return null;
    const { latitude, longitude, label } = destination as Record<string, unknown>;
    if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
        (label !== undefined && (typeof label !== 'string' || (label as string).length > 255))) return null;
    return { latitude, longitude, ...(label ? { label: label as string } : {}) };
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
