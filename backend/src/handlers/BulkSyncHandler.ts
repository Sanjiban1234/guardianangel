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
