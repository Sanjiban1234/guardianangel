import { AuthenticatedSocket } from '../middleware/AuthMiddleware';
import { TelemetryService, TelemetryReading } from '../services/TelemetryService';
import { GroupCoherenceService } from '../services/GroupCoherenceService';
import { RoomState } from './SessionHandler';
import { logger } from '../utils/logger';
import { GuardianPortalShareService } from '../services/GuardianPortalShareService';
import { PortalBroadcaster } from '../sockets/GuardianPortalSocketController';

export class LocationHandler {
  constructor(
    private readonly socket: AuthenticatedSocket,
    private readonly roomState: RoomState,
    private readonly telemetryService: TelemetryService,
    private readonly coherenceService?: GroupCoherenceService,
    private readonly portalShares?: GuardianPortalShareService,
    private readonly portal?: PortalBroadcaster,
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

    logger.debug('location update received', { event: 'location:update' });

    if (!groupCode) {
      logger.warn('location update rejected: no active room');
      this.socket.emit('error', {
        message: 'Must join a ride session before sending location updates',
      });
      return;
    }

    if (!this.isValidReading(reading)) {
      logger.warn('location update rejected: invalid payload');
      return;
    }


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

      this.socket.to(`group:${groupCode}`).emit('location:broadcast', broadcastPayload);
      const shareIds = this.portalShares ? await this.portalShares.activeSharesForRoom(groupCode) : [];
      const ownShareIds = shareIds.filter((share) => share.owner_user_id === userId).map((share) => share.id);
      this.portal?.location(ownShareIds, { latitude: reading.latitude, longitude: reading.longitude, lastUpdatedAt: broadcastPayload.last_updated_at });
    } catch (err) {
      logger.error('location broadcast failed', err);
    }

    if (this.coherenceService) {
      try {
        const { alerts, reunions } = await this.coherenceService.evaluateRoomCoherence(groupCode);

        for (const alert of alerts) {
          this.socket.nsp.to(`group:${groupCode}`).emit('group:separationAlert', alert);
          const shareIds = await this.portalShares?.markSeparation(groupCode, alert.separated_rider.user_id, 'separated') || [];
          this.portal?.separation(shareIds, 'separated', alert.timestamp);
        }
        for (const reunion of reunions) {
          this.socket.nsp.to(`group:${groupCode}`).emit('group:reunited', reunion);
          const shareIds = await this.portalShares?.markSeparation(groupCode, reunion.user_id, 'reunited') || [];
          this.portal?.separation(shareIds, 'reunited', reunion.timestamp);
        }
      } catch (coherenceErr) {
        logger.error('group coherence evaluation failed', coherenceErr);
      }
    }
  }

  private isValidReading(reading: TelemetryReading): boolean {
    if (
      typeof reading?.timestamp !== 'number' || !Number.isFinite(reading.timestamp) ||
      typeof reading?.latitude !== 'number' || !Number.isFinite(reading.latitude) ||
      typeof reading?.longitude !== 'number' || !Number.isFinite(reading.longitude) ||
      typeof reading?.accuracy !== 'number' || !Number.isFinite(reading.accuracy) ||
      (reading?.speed !== null && (typeof reading?.speed !== 'number' || !Number.isFinite(reading.speed)))
    ) {
      this.socket.emit('error', { message: 'Invalid telemetry payload' });
      return false;
    }

    if (
      reading.latitude < -90 || reading.latitude > 90 ||
      reading.longitude < -180 || reading.longitude > 180 ||
      (reading.speed != null && (reading.speed < 0 || reading.speed > 200)) ||
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
