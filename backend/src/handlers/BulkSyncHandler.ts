import { AuthenticatedSocket } from '../middleware/AuthMiddleware';
import { TelemetryService, BulkTelemetryReading } from '../services/TelemetryService';
import { RoomState } from './SessionHandler';
import { MAX_BULK_BATCH } from '../config';

export class BulkSyncHandler {
  constructor(
    private readonly socket: AuthenticatedSocket,
    private readonly roomState: RoomState,
    private readonly telemetryService: TelemetryService
  ) {}

  register(): void {
    this.socket.on(
      'telemetry:bulkSync',
      (
        data: { readings: BulkTelemetryReading[] },
        callback?: (response: { confirmedClientReadingIds: string[] }) => void
      ) => this.handleBulkSync(data, callback)
    );
  }

  private async handleBulkSync(
    data: { readings: BulkTelemetryReading[] },
    callback?: (response: { confirmedClientReadingIds: string[] }) => void
  ): Promise<void> {
    const groupCode = this.roomState.currentGroupCode;

    if (!groupCode) {
      this.socket.emit('error', {
        message: 'Must join a ride session before synchronizing telemetry',
      });
      return;
    }

    if (!data || !Array.isArray(data.readings)) {
      this.socket.emit('error', {
        message: 'Invalid payload: readings array required',
      });
      return;
    }

    if (data.readings.length > MAX_BULK_BATCH) {
      this.socket.emit('error', {
        message: `Batch too large. Maximum ${MAX_BULK_BATCH} readings per sync.`,
      });
      return;
    }

    const now = Date.now();
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
    const fiveMinutesFuture = now + 5 * 60 * 1000;

    for (const reading of data.readings) {
      if (
        typeof reading?.timestamp !== 'number' ||
        typeof reading?.latitude !== 'number' ||
        typeof reading?.longitude !== 'number' ||
        typeof reading?.accuracy !== 'number' ||
        typeof reading?.speed !== 'number' ||
        !reading?.client_reading_id
      ) {
        this.socket.emit('error', { message: 'Invalid payload: malformed reading in batch' });
        return;
      }

      if (
        reading.latitude < -90 || reading.latitude > 90 ||
        reading.longitude < -180 || reading.longitude > 180 ||
        reading.speed < 0 || reading.speed > 200 ||
        reading.accuracy < 0
      ) {
        this.socket.emit('error', { message: 'Invalid coordinate or speed values in bulk batch' });
        return;
      }

      if (reading.timestamp < twentyFourHoursAgo || reading.timestamp > fiveMinutesFuture) {
        this.socket.emit('error', { message: 'Timestamp out of acceptable bounds in bulk batch' });
        return;
      }
    }

    const userId = this.socket.user!.id;
    const name = this.socket.user!.name;

    try {
      console.log(
        `BulkSyncHandler: starting sync for ${name}. Batch: ${data.readings.length}`
      );

      const confirmedClientReadingIds =
        await this.telemetryService.bulkSyncTelemetry(groupCode, userId, data.readings);

      console.log(
        `BulkSyncHandler: sync done for ${name}. ` +
        `${confirmedClientReadingIds.length}/${data.readings.length} confirmed.`
      );

      if (typeof callback === 'function') {
        callback({ confirmedClientReadingIds });
      } else {
        this.socket.emit('telemetry:bulkSyncAck', { confirmedClientReadingIds });
      }
    } catch (err) {
      console.error('BulkSyncHandler: sync error:', err);
      this.socket.emit('error', {
        message: 'Internal server error during bulk sync',
      });
    }
  }
}
