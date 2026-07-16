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
    this.socket.on('session:join', (data: { group_code: string }) =>
      this.handleJoin(data)
    );
    this.socket.on('session:leave', () => this.handleLeave());
  }

  private async handleJoin(data: { group_code: string }): Promise<void> {
    const { group_code } = data;
    const userId = this.socket.user!.id;
    const name = this.socket.user!.name;

    if (!group_code) {
      this.socket.emit('error', { message: 'Group code is required' });
      return;
    }

    try {
      const room = await this.roomService.verifyMembership(group_code, userId);

      if (!room) {
        this.socket.emit('error', {
          message: 'Forbidden: You are not authorized to join this group',
        });
        return;
      }

      if (room.status !== 'active') {
        this.socket.emit('error', {
          message: 'This ride group is no longer active',
        });
        return;
      }

      this.roomState.currentGroupCode = group_code;

      this.socket.join(`group:${group_code}`);

      const members = await this.roomService.getMembers(group_code);

      this.socket.emit('session:joined', { group_code, members });

      this.socket
        .to(`group:${group_code}`)
        .emit('session:member_joined', { user_id: userId, name });

      console.log(`SessionHandler: ${name} joined group ${group_code}`);
    } catch (err) {
      console.error('SessionHandler.handleJoin error:', err);
      this.socket.emit('error', {
        message: 'Internal server error while joining session',
      });
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
