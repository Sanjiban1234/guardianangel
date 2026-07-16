import { Server } from 'socket.io';
import { AuthenticatedSocket } from '../middleware/AuthMiddleware';
import { EmergencyAlertService } from '../services/EmergencyAlertService';
import { RoomState } from './SessionHandler';

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
    const groupCode = this.roomState.currentGroupCode;
    if (!groupCode) return;
    console.log(
      `CrashHandler: CANDIDATE — user "${this.socket.user!.name}" ` +
      `group "${groupCode}" @ ${data.latitude},${data.longitude}`
    );
  }

  private async handleCountdownExpired(data: {
    timestamp: number;
    latitude: number;
    longitude: number;
  }): Promise<void> {
    const groupCode = this.roomState.currentGroupCode;
    if (!groupCode) return;

    const userId = this.socket.user!.id;
    const name = this.socket.user!.name;

    try {
      console.log(
        `CrashHandler: CONFIRMED — user "${name}" group "${groupCode}". Creating SOS alert.`
      );

      const alert = await this.alertService.createAlert(
        groupCode,
        userId,
        data.timestamp,
        data.latitude,
        data.longitude
      );

      this.io.to(`group:${groupCode}`).emit('sos:broadcast', {
        alarm_no: alert.alarm_no,
        user_id: userId,
        name,
        timestamp: data.timestamp,
        latitude: data.latitude,
        longitude: data.longitude,
      });
    } catch (err) {
      console.error('CrashHandler.handleCountdownExpired: alert insert/broadcast failed:', err);
    }
  }
}
