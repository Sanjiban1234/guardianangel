import { Server } from 'socket.io';
import { AuthenticatedSocket } from '../middleware/AuthMiddleware';
import { RoomService } from '../services/RoomService';
import { RoomState } from './SessionHandler';
import { logger } from '../utils/logger';

/** Host-authorized ride termination.  Members must use session:leave instead. */
export class RideEndHandler {
  constructor(
    private readonly io: Server,
    private readonly socket: AuthenticatedSocket,
    private readonly roomState: RoomState,
    private readonly roomService: RoomService,
  ) {}

  register(): void {
    this.socket.on('ride:end', (callback?: (response: any) => void) => this.handleEnd(callback));
  }

  private async handleEnd(callback?: (response: any) => void): Promise<void> {
    const groupCode = this.roomState.currentGroupCode;
    if (!groupCode) {
      callback?.({ error: 'Not currently in a room' });
      return;
    }
    try {
      const ended = await this.roomService.endRoom(groupCode, this.socket.user!.id);
      if (!ended) {
        callback?.({ error: 'Only the host can end this ride' });
        return;
      }
      this.io.to(`group:${groupCode}`).emit('ride:ended', { group_code: groupCode, ended_at: Date.now() });
      callback?.({ success: true });
    } catch (err) {
      logger.error('ride end failed', err);
      callback?.({ error: 'Unable to end ride' });
    }
  }
}
