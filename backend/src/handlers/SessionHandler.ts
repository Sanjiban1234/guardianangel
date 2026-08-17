import { Server } from 'socket.io';
import { AuthenticatedSocket } from '../middleware/AuthMiddleware';
import { RoomService } from '../services/RoomService';

export interface RoomState {
  currentGroupCode: string | null;
}

export class SessionHandler {
  constructor(
    private readonly io: Server,
    private readonly socket: AuthenticatedSocket,
    private readonly roomState: RoomState,
    private readonly roomService: RoomService
  ) {}

  register(): void {
    this.socket.on('session:join', (data: { group_code: string }, callback?: (response: any) => void) =>
      this.handleJoin(data, callback)
    );
    this.socket.on('session:leave', () => this.handleLeave());
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

      const members = await this.roomService.getMembers(group_code);

      this.socket.emit('session:joined', { group_code, members });

      this.socket
        .to(`group:${group_code}`)
        .emit('session:member_joined', { user_id: userId, name });

      if (callback) callback({ group_code, members });

      console.log(`SessionHandler: ${name} joined group ${group_code}`);
    } catch (err) {
      console.error('SessionHandler.handleJoin error:', err);
      const errResp = { error: 'Internal server error while joining session' };
      this.socket.emit('error', errResp);
      if (callback) callback(errResp);
    }
  }

  private handleLeave(): void {
    const groupCode = this.roomState.currentGroupCode;
    if (!groupCode) return;

    const userId = this.socket.user!.id;
    const name = this.socket.user!.name;

    console.log(`SessionHandler: ${name} leaving group ${groupCode}`);

    this.socket
      .to(`group:${groupCode}`)
      .emit('session:member_left', { user_id: userId, name });

    this.socket.leave(`group:${groupCode}`);
    this.roomState.currentGroupCode = null;
  }
}
