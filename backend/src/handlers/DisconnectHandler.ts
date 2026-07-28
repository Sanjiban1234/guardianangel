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

    console.log(`DisconnectHandler: ${name} disconnected`);

    if (!groupCode) return;

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
  }
}
