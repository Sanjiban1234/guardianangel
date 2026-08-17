import { Server } from 'socket.io';
import { AuthenticatedSocket } from '../middleware/AuthMiddleware';
import { RoomService } from '../services/RoomService';
import { RoomState } from './SessionHandler';

export class RideStartHandler {
  constructor(
    private readonly io: Server,
    private readonly socket: AuthenticatedSocket,
    private readonly roomState: RoomState,
    private readonly roomService: RoomService
  ) {}

  register(): void {
    console.log('[RideStart BACKEND] Registering ride:start handler on socket', this.socket.user?.name);
    this.socket.on('ride:start', (callback?: (response: any) => void) =>
      this.handleStartRide(callback)
    );
  }

  private async handleStartRide(callback?: (response: any) => void): Promise<void> {
    console.log('[RideStart BACKEND 1] ride:start RECEIVED', { socketId: this.socket.id });
    const groupCode = this.roomState.currentGroupCode;
    const userId = this.socket.user!.id;
    const name = this.socket.user!.name;

    console.log('[RideStart BACKEND 2] auth state', {
      userId,
      name,
      groupCode,
      role: '(checked in service)',
    });

    if (!groupCode) {
      const err = { error: 'Not currently in a room' };
      console.error('[RideStart BACKEND ERROR]', err);
      if (callback) callback(err);
      return;
    }

    try {
      console.log('[RideStart BACKEND 2B] calling RoomService.startRide');
      const success = await this.roomService.startRide(groupCode, userId);

      if (!success) {
        const err = { error: 'Only the host can start the ride' };
        console.error('[RideStart BACKEND ERROR]', err);
        if (callback) callback(err);
        return;
      }

      console.log('[RideStart BACKEND 3] startRide SUCCESS');
      console.log('[RideStart BACKEND 4] broadcasting ride:started to group:', groupCode);

      this.io.to(`group:${groupCode}`).emit('ride:started', {
        group_code: groupCode,
        started_at: Date.now(),
      });

      if (callback) callback({ success: true });

      console.log(`RideStartHandler: ${name} started ride in group ${groupCode}`);
    } catch (err) {
      console.error('[RideStart BACKEND ERROR]', err);
      const errResp = { error: 'Internal server error while starting ride' };
      if (callback) callback(errResp);
    }
  }
}
