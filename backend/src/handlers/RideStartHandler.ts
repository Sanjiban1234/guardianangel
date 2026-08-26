import { Server } from 'socket.io';
import { AuthenticatedSocket } from '../middleware/AuthMiddleware';
import { RoomService } from '../services/RoomService';
import { RoomState } from './SessionHandler';
import { logger } from '../utils/logger';

export class RideStartHandler {
  constructor(
    private readonly io: Server,
    private readonly socket: AuthenticatedSocket,
    private readonly roomState: RoomState,
    private readonly roomService: RoomService
  ) {}

  register(): void {
    logger.debug('ride start handler registered');
    this.socket.on('ride:start', (callback?: (response: any) => void) =>
      this.handleStartRide(callback)
    );
  }

  private async handleStartRide(callback?: (response: any) => void): Promise<void> {
    logger.info('ride start requested');
    const groupCode = this.roomState.currentGroupCode;
    const userId = this.socket.user!.id;

    if (!groupCode) {
      const err = { error: 'Not currently in a room' };
      logger.warn('ride start rejected: no active room');
      if (callback) callback(err);
      return;
    }

    try {
      const success = await this.roomService.startRide(groupCode, userId);

      if (!success) {
        const err = { error: 'Only the host can start the ride' };
        logger.warn('ride start rejected: not host');
        if (callback) callback(err);
        return;
      }

      logger.info('ride started');

      this.io.to(`group:${groupCode}`).emit('ride:started', {
        group_code: groupCode,
        started_at: Date.now(),
      });

      if (callback) callback({ success: true });

    } catch (err) {
      logger.error('ride start failed', err);
      const errResp = { error: 'Internal server error while starting ride' };
      if (callback) callback(errResp);
    }
  }
}
