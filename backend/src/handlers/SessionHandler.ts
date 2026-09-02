import { Server } from 'socket.io';
import { AuthenticatedSocket } from '../middleware/AuthMiddleware';
import { RoomService } from '../services/RoomService';
import { PresenceService } from '../services/PresenceService';
import { logger } from '../utils/logger';
import { GuardianPortalShareService } from '../services/GuardianPortalShareService';
import { PortalBroadcaster } from '../sockets/GuardianPortalSocketController';

export interface RoomState {
  currentGroupCode: string | null;
}

export class SessionHandler {
  constructor(
    private readonly io: Server,
    private readonly socket: AuthenticatedSocket,
    private readonly roomState: RoomState,
    private readonly roomService: RoomService,
    private readonly presenceService: PresenceService, private readonly portalShares?: GuardianPortalShareService, private readonly portal?: PortalBroadcaster,
  ) {}

  register(): void {
    this.socket.on('session:join', (data: { group_code: string }, callback?: (response: any) => void) =>
      this.handleJoin(data, callback)
    );
    this.socket.on('session:leave', (callback?: (response: any) => void) => this.handleLeave(callback));
  }

  private async handleJoin(data: { group_code: string }, callback?: (response: any) => void): Promise<void> {
    const { group_code } = data;
    const userId = this.socket.user!.id;
    const name = this.socket.user!.name;

    if (!group_code) {
      const err = { error: 'Group code is required' };
      this.socket.emit('error', err);
      if (callback) callback(err);
      return;
    }

    try {
      const room = await this.roomService.verifyMembership(group_code, userId);

      if (!room) {
        const err = { error: 'Forbidden: You are not authorized to join this group' };
        this.socket.emit('error', err);
        if (callback) callback(err);
        return;
      }

      if (room.status !== 'active') {
        const err = { error: 'This ride group is no longer active' };
        this.socket.emit('error', err);
        if (callback) callback(err);
        return;
      }

      this.roomState.currentGroupCode = group_code;

      this.socket.join(`group:${group_code}`);
      this.presenceService.markConnected(group_code, userId, this.socket.id);
      const ownShareIds = (await this.portalShares?.activeSharesForRoom(group_code) || []).filter((share) => share.owner_user_id === userId).map((share) => share.id);
      this.portal?.presence(ownShareIds, { connectionState: 'CONNECTED', updatedAt: Date.now() });

      const members = await this.presenceService.getRiderPresence(group_code);
      const joiningRider = members.find((member) => member.user_id === userId);
      const rideStatus = await this.roomService.getRoomRideStatus(group_code);

      logger.info('session joined', { memberCount: members.length });

      this.socket.emit('session:joined', {
        group_code,
        members,
        ride_started_at: rideStatus?.rideStartedAt || null,
      });

      this.socket
        .to(`group:${group_code}`)
        .emit('session:member_joined', {
          user_id: userId,
          name,
          vehicle_model: joiningRider?.vehicle_model,
          plate_number: joiningRider?.plate_number,
          connection_state: 'CONNECTED',
          location_freshness: 'STALE',
        });

      if (callback) callback({ group_code, members, ride_started_at: rideStatus?.rideStartedAt || null });

    } catch (err) {
      logger.error('session join failed', err);
      const errResp = { error: 'Internal server error while joining session' };
      this.socket.emit('error', errResp);
      if (callback) callback(errResp);
    }
  }

  private async handleLeave(callback?: (response: any) => void): Promise<void> {
    const groupCode = this.roomState.currentGroupCode;
    logger.info('session leave requested');
    if (!groupCode) {
      callback?.({ error: 'Not currently in a room' });
      return;
    }

    const userId = this.socket.user!.id;
    const name = this.socket.user!.name;

    let didLeave = false;
    try {
      didLeave = await this.roomService.leaveRoom(groupCode, userId);
    } catch (err) {
      logger.error('session leave failed', err);
      callback?.({ error: 'Unable to leave ride' });
      return;
    }
    if (!didLeave) {
      callback?.({ error: 'Only a member can leave this ride. Hosts must end the ride.' });
      return;
    }

    logger.info('session leave completed');

    this.socket
      .to(`group:${groupCode}`)
      .emit('session:member_left', { user_id: userId, name });

    this.socket.leave(`group:${groupCode}`);
    this.portal?.revoked(await this.portalShares?.revokeForRider(groupCode, userId) || []);
    this.presenceService.markLeft(groupCode, userId, this.socket.id);
    this.roomState.currentGroupCode = null;
    logger.info('session state cleared');
    callback?.({ success: true });
  }
}
