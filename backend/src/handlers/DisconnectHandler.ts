import { AuthenticatedSocket } from '../middleware/AuthMiddleware';
import { PresenceService } from '../services/PresenceService';
import { RoomState } from './SessionHandler';

export class DisconnectHandler {
  constructor(
    private readonly socket: AuthenticatedSocket,
    private readonly roomState: RoomState,
    private readonly presenceService: PresenceService
  ) {}

  register(): void {
    this.socket.on('disconnect', () => this.handleDisconnect());
  }

  private async handleDisconnect(): Promise<void> {
    const userId = this.socket.user!.id;
    const name = this.socket.user!.name;
    const groupCode = this.roomState.currentGroupCode;
    const socketId = this.socket.id;

    console.log(`[SOCKET BACKEND DISCONNECT] userId=${userId} name=${name} socketId=${socketId} groupCode=${groupCode || 'none'}`);

    if (!groupCode) {
      console.log(`[SOCKET BACKEND DISCONNECT]   no groupCode — user was not in a room, no further action`);
      return;
    }

    const roomSocketsBefore = this.socket.nsp?.adapter?.rooms?.get(`group:${groupCode}`)?.size ?? 'unknown';
    console.log(`[SOCKET BACKEND DISCONNECT]   roomSocketCountBefore=${roomSocketsBefore} (includes this socket until Socket.IO removes it)`);

    const payload = {
      user_id: userId,
      name,
      timestamp: Date.now(),
      latitude: 0,
      longitude: 0,
    };

    try {
      const lastLoc = await this.presenceService.getLastKnownLocation(userId, groupCode);
      if (lastLoc) {
        payload.latitude = lastLoc.latitude;
        payload.longitude = lastLoc.longitude;
        payload.timestamp = lastLoc.device_timestamp;
      }
    } catch (err) {
      console.error('DisconnectHandler: failed to fetch last location:', err);
    }

    this.socket.to(`group:${groupCode}`).emit('peer:lastKnown', payload);

    const roomSocketsAfter = this.socket.nsp?.adapter?.rooms?.get(`group:${groupCode}`)?.size ?? 'unknown';
    console.log(`[SOCKET BACKEND DISCONNECT]   roomSocketCountAfter=${roomSocketsAfter}`);
    console.log(`[SOCKET BACKEND DISCONNECT]   impact: peer:lastKnown broadcast only — DB room membership unchanged`);
  }
}
