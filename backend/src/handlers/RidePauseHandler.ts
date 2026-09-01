import { Server } from 'socket.io';
import { AuthenticatedSocket } from '../middleware/AuthMiddleware';
import { RoomService } from '../services/RoomService';
import { GroupCoherenceService } from '../services/GroupCoherenceService';
import { RoomState } from './SessionHandler';
import { logger } from '../utils/logger';

export class RidePauseHandler {
  constructor(
    private readonly io: Server,
    private readonly socket: AuthenticatedSocket,
    private readonly roomState: RoomState,
    private readonly roomService: RoomService,
    private readonly coherenceService?: GroupCoherenceService,
  ) {}

  register(): void {
    logger.debug('ride pause handler registered');
    this.socket.on('ride:pause', (data?: { group_code?: string }, callback?: (response: any) => void) =>
      this.handlePause(data, callback),
    );
    this.socket.on('ride:resume', (data?: { group_code?: string }, callback?: (response: any) => void) =>
      this.handleResume(data, callback),
    );
  }

  private async handlePause(data?: { group_code?: string }, callback?: (response: any) => void): Promise<void> {
    const groupCode = data?.group_code || this.roomState.currentGroupCode;
    const userId = this.socket.user!.id;
    const name = this.socket.user!.name;

    if (!groupCode) {
      const err = { error: 'Not currently in a room' };
      logger.warn('ride pause rejected: no active room');
      if (callback) callback(err);
      return;
    }

    try {
      const success = await this.roomService.pauseRider(groupCode, userId);

      if (!success) {
        const err = { error: 'Cannot pause ride. Room may be inactive, not started, or user not a member.' };
        logger.warn('ride pause rejected');
        if (callback) callback(err);
        return;
      }

      logger.info('rider paused');

      // A paused rider is excluded from coherence calculations. Drop any
      // partial separation state now so it cannot survive the pause period.
      this.coherenceService?.resetRiderState(groupCode, userId);

      const payload = {
        user_id: userId,
        name,
        group_code: groupCode,
        timestamp: Date.now(),
      };

      this.io.to(`group:${groupCode}`).emit('ride:paused', payload);

      if (callback) callback({ success: true, ...payload });
    } catch (err) {
      logger.error('ride pause failed', err);
      const errResp = { error: 'Internal server error while pausing ride' };
      if (callback) callback(errResp);
    }
  }

  private async handleResume(data?: { group_code?: string }, callback?: (response: any) => void): Promise<void> {
    const groupCode = data?.group_code || this.roomState.currentGroupCode;
    const userId = this.socket.user!.id;
    const name = this.socket.user!.name;

    if (!groupCode) {
      const err = { error: 'Not currently in a room' };
      logger.warn('ride resume rejected: no active room');
      if (callback) callback(err);
      return;
    }

    try {
      const success = await this.roomService.resumeRider(groupCode, userId);

      if (!success) {
        const err = { error: 'Cannot resume ride. Room may be inactive or user not a member.' };
        logger.warn('ride resume rejected');
        if (callback) callback(err);
        return;
      }

      logger.info('rider resumed');

      if (this.coherenceService) {
        this.coherenceService.resetRiderState(groupCode, userId);
      }

      const payload = {
        user_id: userId,
        name,
        group_code: groupCode,
        timestamp: Date.now(),
      };

      this.io.to(`group:${groupCode}`).emit('ride:resumed', payload);

      if (callback) callback({ success: true, ...payload });
    } catch (err) {
      logger.error('ride resume failed', err);
      const errResp = { error: 'Internal server error while resuming ride' };
      if (callback) callback(errResp);
    }
  }
}
