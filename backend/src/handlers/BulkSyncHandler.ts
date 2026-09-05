import { AuthenticatedSocket } from '../middleware/AuthMiddleware';
import { TelemetryService, BulkTelemetryReading } from '../services/TelemetryService';
import { RoomState } from './SessionHandler';
import { MAX_BULK_BATCH } from '../config';
import { logger } from '../utils/logger';

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
        data: { groupCode?: string; readings: BulkTelemetryReading[] },
        callback?: (response: { confirmedClientReadingIds: string[]; rejectedClientReadingIds?: string[] }) => void
      ) => this.handleBulkSync(data, callback)
    );
  }

  private async handleBulkSync(
    data: { groupCode?: string; readings: BulkTelemetryReading[] },
    callback?: (response: { confirmedClientReadingIds: string[]; rejectedClientReadingIds?: string[] }) => void
  ): Promise<void> {
    const groupCode = data?.groupCode || this.roomState.currentGroupCode;

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

    const rejectedClientReadingIds: string[] = [];
    const valid = data.readings.filter(reading => {
      const ok = typeof reading?.client_reading_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reading.client_reading_id) &&
        Number.isFinite(reading.timestamp) && reading.timestamp >= 1600000000000 && reading.timestamp <= Date.now() + 300_000 &&
        Number.isFinite(reading.latitude) && Math.abs(reading.latitude) <= 90 &&
        Number.isFinite(reading.longitude) && Math.abs(reading.longitude) <= 180 &&
        Number.isFinite(reading.accuracy) && reading.accuracy >= 0 &&
        (reading.speed === null || (Number.isFinite(reading.speed) && reading.speed >= 0 && reading.speed <= 200));
      if (!ok && typeof reading?.client_reading_id === 'string') rejectedClientReadingIds.push(reading.client_reading_id);
      return ok;
    });
    if (rejectedClientReadingIds.length) logger.warn('invalid historical samples rejected', { count: rejectedClientReadingIds.length });

    if (!valid.length) {
      this.socket.emit('error', { message: 'Invalid telemetry batch' });
      if (typeof callback === 'function') callback({ confirmedClientReadingIds: [], rejectedClientReadingIds });
      return;
    }
    const userId = this.socket.user!.id;

    try {
      logger.info('bulk telemetry sync started', { count: data.readings.length });

      const confirmedClientReadingIds =
        await this.telemetryService.bulkSyncTelemetry(groupCode, userId, valid);

      logger.info('bulk telemetry sync completed', { count: confirmedClientReadingIds.length });

      if (typeof callback === 'function') {
        callback({ confirmedClientReadingIds, rejectedClientReadingIds });
      } else {
        this.socket.emit('telemetry:bulkSyncAck', { confirmedClientReadingIds });
      }
    } catch (err) {
      logger.error('bulk telemetry sync failed', err);
      this.socket.emit('error', {
        message: 'Internal server error during bulk sync',
      });
    }
  }
}
