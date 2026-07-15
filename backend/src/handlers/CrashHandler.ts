import { Server } from 'socket.io';
import { AuthenticatedSocket } from '../middleware/AuthMiddleware';
import { EmergencyAlertService } from '../services/EmergencyAlertService';
import { RoomState } from './SessionHandler';

/**
 * CrashHandler — handles crash:candidate and crash:countdownExpired events.
 *
 * crash:candidate is fire-and-forget logging.
 * crash:countdownExpired persists an alert and broadcasts SOS to the room.
 *
 * A DB failure in countdownExpired is caught here and logged — it never
 * crashes the socket or affects SessionHandler, LocationHandler, etc.
 */
export class CrashHandler {
  constructor(
    private readonly io: Server,
    private readonly socket: AuthenticatedSocket,
    private readonly roomState: RoomState,
    private readonly alertService: EmergencyAlertService
  ) {}

  register(): void {
    this.socket.on(
      'crash:candidate',
      (data: { timestamp: number; latitude: number; longitude: number }) =>
        this.handleCandidate(data)
    );

    this.socket.on(
      'crash:countdownExpired',
      (data: { timestamp: number; latitude: number; longitude: number }) =>
        this.handleCountdownExpired(data)
    );
  }

  private handleCandidate(data: {
    timestamp: number;
    latitude: number;
    longitude: number;
  }): void {
    const roomId = this.roomState.currentRoomId;
    if (!roomId) return;
    console.log(
      `CrashHandler: CANDIDATE — user "${this.socket.user!.username}" ` +
      `room "${roomId}" @ ${data.latitude},${data.longitude}`
    );
  }

  private async handleCountdownExpired(data: {
    timestamp: number;
    latitude: number;
    longitude: number;
  }): Promise<void> {
    const roomId = this.roomState.currentRoomId;
    if (!roomId) return;

    const userId = this.socket.user!.id;
    const username = this.socket.user!.username;

    try {
      console.log(
        `CrashHandler: CONFIRMED — user "${username}" room "${roomId}". Creating SOS alert.`
      );

      const alert = await this.alertService.createAlert(
        roomId,
        userId,
        data.timestamp,
        data.latitude,
        data.longitude
      );

      this.io.to(`room:${roomId}`).emit('sos:broadcast', {
        alert_id: alert.id,
        user_id: userId,
        username,
        timestamp: data.timestamp,
        latitude: data.latitude,
        longitude: data.longitude,
      });
    } catch (err) {
      console.error('CrashHandler.handleCountdownExpired: alert insert/broadcast failed:', err);
    }
  }
}
