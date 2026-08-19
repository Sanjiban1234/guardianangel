import { AuthenticatedSocket } from '../middleware/AuthMiddleware';
import { TelemetryService, TelemetryReading } from '../services/TelemetryService';
import { GroupCoherenceService } from '../services/GroupCoherenceService';
import { RoomState } from './SessionHandler';

export class LocationHandler {
  constructor(
    private readonly socket: AuthenticatedSocket,
    private readonly roomState: RoomState,
    private readonly telemetryService: TelemetryService,
    private readonly coherenceService?: GroupCoherenceService
  ) {}

  register(): void {
    this.socket.on(
      'location:update',
      (reading: TelemetryReading) => this.handleLocationUpdate(reading)
    );
  }

  private async handleLocationUpdate(reading: TelemetryReading): Promise<void> {
    const groupCode = this.roomState.currentGroupCode;
    const userId = this.socket.user?.id;
    const name = this.socket.user?.name;

    console.log(`[LIVE LOCATION DIAG] [BOUNDARY-D] Backend received location:update | socketId=${this.socket.id} userId=${userId} name=${name} groupCode=${groupCode} lat=${reading.latitude?.toFixed(6)} lng=${reading.longitude?.toFixed(6)}`);

    if (!groupCode) {
      console.log(`[LIVE LOCATION TRACE] [TRACE 5-BLOCKED] No groupCode — user not in a room`);
      this.socket.emit('error', {
        message: 'Must join a ride session before sending location updates',
      });
      return;
    }

    if (!this.isValidReading(reading)) {
      console.log(`[LIVE LOCATION TRACE] [TRACE 6-BLOCKED] Validation failed`);
      return;
    }

    console.log(`[LIVE LOCATION TRACE] [TRACE 6] Location validated | groupCode=${groupCode}`);

    try {
      await this.telemetryService.saveTelemetry(groupCode, userId!, reading);

      const broadcastPayload = {
        user_id: userId,
        name,
        timestamp: reading.timestamp,
        latitude: reading.latitude,
        longitude: reading.longitude,
        accuracy: reading.accuracy,
        speed: reading.speed,
        last_updated_at: Date.now(),
        connection_state: 'CONNECTED',
        location_freshness: 'FRESH',
      };

      console.log(`[LIVE LOCATION AUDIT] Broadcasting location:broadcast for ${name} (${userId}) in group ${groupCode}`);
      console.log(`[LIVE LOCATION DIAG] [BOUNDARY-E] Backend broadcast location:broadcast to group:${groupCode} | from ${name}(${userId})`);

      const roomSockets = this.socket.nsp?.adapter?.rooms?.get(`group:${groupCode}`);
      console.log(`[LIVE LOCATION DIAG]   room_socket_count=${roomSockets?.size ?? 'unknown'} (includes sender)`);

      this.socket.to(`group:${groupCode}`).emit('location:broadcast', broadcastPayload);
      console.log(`[LIVE LOCATION DIAG]   emit completed`);
    } catch (err) {
      console.error('LocationHandler: broadcast error:', err);
    }

    if (this.coherenceService) {
      try {
        const { alerts, reunions } = await this.coherenceService.evaluateRoomCoherence(groupCode);

        for (const alert of alerts) {
          this.socket.nsp.to(`group:${groupCode}`).emit('group:separationAlert', alert);
        }
        for (const reunion of reunions) {
          this.socket.nsp.to(`group:${groupCode}`).emit('group:reunited', reunion);
        }
      } catch (coherenceErr) {
        console.error('LocationHandler: group coherence evaluation failed:', coherenceErr);
      }
    }
  }

  private isValidReading(reading: TelemetryReading): boolean {
    if (
      typeof reading?.timestamp !== 'number' ||
      typeof reading?.latitude !== 'number' ||
      typeof reading?.longitude !== 'number' ||
      typeof reading?.accuracy !== 'number' ||
      typeof reading?.speed !== 'number'
    ) {
      this.socket.emit('error', { message: 'Invalid telemetry payload' });
      return false;
    }

    if (
      reading.latitude < -90 || reading.latitude > 90 ||
      reading.longitude < -180 || reading.longitude > 180 ||
      reading.speed < 0 || reading.speed > 200 ||
      reading.accuracy < 0
    ) {
      this.socket.emit('error', { message: 'Invalid coordinate or speed values' });
      return false;
    }

    const now = Date.now();
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
    const fiveMinutesFuture = now + 5 * 60 * 1000;

    if (reading.timestamp < twentyFourHoursAgo || reading.timestamp > fiveMinutesFuture) {
      this.socket.emit('error', { message: 'Timestamp out of acceptable bounds' });
      return false;
    }

    return true;
  }
}
