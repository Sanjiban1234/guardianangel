import { AuthenticatedSocket } from '../middleware/AuthMiddleware';
import { PresenceService } from '../services/PresenceService';
import { RoomState } from './SessionHandler';
import { logger } from '../utils/logger';
import { GuardianPortalShareService } from '../services/GuardianPortalShareService';
import { PortalBroadcaster } from '../sockets/GuardianPortalSocketController';

export class DisconnectHandler {
  constructor(
    private readonly socket: AuthenticatedSocket,
    private readonly roomState: RoomState,
    private readonly presenceService: PresenceService,
    private readonly portalShares?: GuardianPortalShareService,
    private readonly portal?: PortalBroadcaster,
  ) {}

  register(): void {
    this.socket.on('disconnect', () => this.handleDisconnect());
  }

  private async handleDisconnect(): Promise<void> {
    const userId = this.socket.user!.id;
    const name = this.socket.user!.name;
    const groupCode = this.roomState.currentGroupCode;
    const socketId = this.socket.id;

    logger.info('socket disconnected');

    if (!groupCode) {
      logger.info('socket disconnected without active room');
      return;
    }

    this.presenceService.markDisconnected(groupCode, userId, socketId);

    const payload = {
      user_id: userId,
      name,
      timestamp: Date.now(),
      latitude: 0,
      longitude: 0,
      connection_state: 'DISCONNECTED' as const,
      location_freshness: 'STALE' as const,
    };

    try {
      const lastLoc = await this.presenceService.getLastKnownLocation(userId, groupCode);
      if (lastLoc) {
        payload.latitude = lastLoc.latitude;
        payload.longitude = lastLoc.longitude;
        payload.timestamp = lastLoc.device_timestamp;
      }
    } catch (err) {
      logger.error('last known location lookup failed', err);
    }

    this.socket.to(`group:${groupCode}`).emit('peer:lastKnown', payload);
    const shareIds = this.portalShares ? await this.portalShares.activeSharesForRoom(groupCode) : [];
    this.portal?.presence(shareIds.filter((share) => share.owner_user_id === userId).map((share) => share.id), { lastUpdatedAt: payload.timestamp, connectionState: 'DISCONNECTED', freshness: 'STALE' });

    logger.info('last known location broadcast completed');
  }
}
