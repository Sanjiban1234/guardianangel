import { AuthenticatedSocket } from '../middleware/AuthMiddleware';
import { PresenceService } from '../services/PresenceService';
import { RoomState } from './SessionHandler';

/**
 * DisconnectHandler — handles the disconnect socket event.
 *
 * On disconnect, fetches the user's last known location and broadcasts it
 * to the room as peer:lastKnown. If PresenceService fails, a zeroed-out
 * payload is still broadcast so peers know the rider has gone offline.
 *
 * Failure here is isolated — it never affects any other handler.
 */
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
    const username = this.socket.user!.username;
    const roomId = this.roomState.currentRoomId;

    console.log(`DisconnectHandler: ${username} disconnected`);

    if (!roomId) return;

    const payload = {
      user_id: userId,
      username,
      timestamp: Date.now(),
      latitude: 0,
      longitude: 0,
    };

    try {
      const lastLoc = await this.presenceService.getLastKnownLocation(userId);
      if (lastLoc) {
        payload.latitude = lastLoc.latitude;
        payload.longitude = lastLoc.longitude;
        payload.timestamp = lastLoc.device_timestamp;
      }
    } catch (err) {
      // PresenceService already logs internally; we still broadcast with zeros
      console.error('DisconnectHandler: failed to fetch last location:', err);
    }

    this.socket.to(`room:${roomId}`).emit('peer:lastKnown', payload);
  }
}
