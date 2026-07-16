import { AuthenticatedSocket } from '../middleware/AuthMiddleware';
import { TelemetryService, TelemetryReading } from '../services/TelemetryService';
import { RoomState } from './SessionHandler';

export class LocationHandler {
  constructor(
    private readonly socket: AuthenticatedSocket,
    private readonly roomState: RoomState,
    private readonly telemetryService: TelemetryService
  ) {}

  register(): void {
    this.socket.on(
      'location:update',
      (reading: TelemetryReading) => this.handleLocationUpdate(reading)
    );
  }

  private async handleLocationUpdate(reading: TelemetryReading): Promise<void> {
    const groupCode = this.roomState.currentGroupCode;

    if (!groupCode) {
      this.socket.emit('error', {
        message: 'Must join a ride session before sending location updates',
      });
      return;
    }

    if (!this.isValidReading(reading)) return;

    const userId = this.socket.user!.id;
    const name = this.socket.user!.name;

    try {
      await this.telemetryService.saveTelemetry(groupCode, userId, reading);

      this.socket.to(`group:${groupCode}`).emit('location:broadcast', {
        user_id: userId,
        name,
        timestamp: reading.timestamp,
        latitude: reading.latitude,
        longitude: reading.longitude,
        accuracy: reading.accuracy,
        speed: reading.speed,
      });
    } catch (err) {
      console.error('LocationHandler: broadcast error:', err);
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
      reading.speed < 0 ||
      reading.accuracy < 0
    ) {
      this.socket.emit('error', { message: 'Invalid coordinate values' });
      return false;
    }

    const now = Date.now();
    if (reading.timestamp > now + 300_000 || reading.timestamp < 1_600_000_000_000) {
      this.socket.emit('error', { message: 'Invalid timestamp' });
      return false;
    }

    return true;
  }
}
