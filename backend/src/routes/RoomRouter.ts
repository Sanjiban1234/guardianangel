import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthMiddleware, AuthenticatedRequest } from '../middleware/AuthMiddleware';
import { RoomService } from '../services/RoomService';

const joinRoomLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many join attempts. Try again in 15 minutes.' },
});

/**
 * RoomRouter — thin Express router delegating all logic to RoomService.
 * Also owns the /health endpoint (no service dependency needed).
 */
export class RoomRouter {
  readonly router: Router;

  constructor(private readonly roomService: RoomService) {
    this.router = Router();
    this.registerRoutes();
  }

  private registerRoutes(): void {
    // GET /api/health
    this.router.get('/health', (_req: Request, res: Response) => {
      res.status(200).json({ status: 'healthy', timestamp: Date.now() });
    });

    // POST /api/rooms
    this.router.post(
      '/rooms',
      AuthMiddleware.authenticateJWT,
      (req, res) => this.handleCreateRoom(req as AuthenticatedRequest, res)
    );

    // POST /api/rooms/join
    this.router.post(
      '/rooms/join',
      AuthMiddleware.authenticateJWT,
      joinRoomLimiter,
      (req, res) => this.handleJoinRoom(req as AuthenticatedRequest, res)
    );

    // GET /api/rooms/:roomId/history
    this.router.get(
      '/rooms/:roomId/history',
      AuthMiddleware.authenticateJWT,
      (req, res) => this.handleGetHistory(req as AuthenticatedRequest, res)
    );
  }

  // ─── POST /api/rooms ──────────────────────────────────────────────────────

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

  // ─── POST /api/rooms/join ─────────────────────────────────────────────────

  private async handleJoinRoom(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    const userId = req.user?.id;
    const { room_token } = req.body;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized: Missing user credentials' });
      return;
    }
    if (!room_token) {
      res.status(400).json({ error: 'Room token is required' });
      return;
    }
    if (typeof room_token !== 'string' || room_token.length > 32) {
      res.status(400).json({ error: 'Invalid room token format' });
      return;
    }

    try {
      const result = await this.roomService.joinRoom(userId, room_token);
      res.status(200).json({ message: 'Successfully joined room', room_id: result.room_id });
    } catch (err: any) {
      if (err?.code === 'ROOM_NOT_FOUND') {
        res.status(404).json({ error: 'Ride room not found' });
      } else if (err?.code === 'ROOM_ENDED') {
        res.status(400).json({ error: 'This ride room has already ended' });
      } else {
        console.error('RoomRouter.joinRoom error:', err);
        res.status(500).json({ error: 'Internal server error while joining ride room' });
      }
    }
  }

  // ─── GET /api/rooms/:roomId/history ──────────────────────────────────────

  private async handleGetHistory(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    const userId = req.user?.id;
    const { roomId } = req.params;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized: Missing user credentials' });
      return;
    }

    try {
      const isMember = await this.roomService.isMember(roomId, userId);
      if (!isMember) {
        res.status(403).json({
          error: 'Forbidden: You are not a member of this ride room',
        });
        return;
      }

      const history = await this.roomService.getRoomHistory(roomId);
      res.status(200).json(history);
    } catch (err) {
      console.error('RoomRouter.getHistory error:', err);
      res.status(500).json({ error: 'Internal server error while fetching telemetry history' });
    }
  }
}

// ─── Factory helper ──────────────────────────────────────────────────────────

export function createRoomRouter(roomService: RoomService): Router {
  return new RoomRouter(roomService).router;
}
