import { Server } from 'socket.io';
import { AuthenticatedSocket } from '../middleware/AuthMiddleware';
import { RoomService } from '../services/RoomService';

/**
 * Shared mutable state passed between all handlers for a single socket connection.
 * Using a reference object so every handler sees the same currentRoomId value.
 */
export interface RoomState {
  currentRoomId: string | null;
}

/**
 * SessionHandler — handles session:join and session:leave socket events.
 *
 * Failure in join/leave is caught here and emitted as a socket error.
 * It never propagates to LocationHandler, BulkSyncHandler, etc.
 */
export class SessionHandler {
  constructor(
    private readonly io: Server,
    private readonly socket: AuthenticatedSocket,
    private readonly roomState: RoomState,
    private readonly roomService: RoomService
  ) {}

  register(): void {
    this.socket.on('session:join', (data: { room_token: string }) =>
      this.handleJoin(data)
    );
    this.socket.on('session:leave', () => this.handleLeave());
  }

  private async handleJoin(data: { room_token: string }): Promise<void> {
    const { room_token } = data;
    const userId = this.socket.user!.id;
    const username = this.socket.user!.username;

    if (!room_token) {
      this.socket.emit('error', { message: 'Room token is required' });
      return;
    }

    try {
      const room = await this.roomService.verifyMembership(room_token, userId);

      if (!room) {
        this.socket.emit('error', {
          message: 'Forbidden: You are not authorized to join this room',
        });
        return;
      }

      if (room.status !== 'active') {
        this.socket.emit('error', {
          message: 'This ride room is no longer active',
        });
        return;
      }

      const roomId = room.id;
      this.roomState.currentRoomId = roomId;

      this.socket.join(`room:${roomId}`);

      const members = await this.roomService.getMembers(roomId);

      this.socket.emit('session:joined', { room_id: roomId, members });

      this.socket
        .to(`room:${roomId}`)
        .emit('session:member_joined', { user_id: userId, username });

      console.log(`SessionHandler: ${username} joined room ${roomId}`);
    } catch (err) {
      console.error('SessionHandler.handleJoin error:', err);
      this.socket.emit('error', {
        message: 'Internal server error while joining session',
      });
    }
  }

  private handleLeave(): void {
    const roomId = this.roomState.currentRoomId;
    if (!roomId) return;

    const userId = this.socket.user!.id;
    const username = this.socket.user!.username;

    console.log(`SessionHandler: ${username} leaving room ${roomId}`);

    this.socket
      .to(`room:${roomId}`)
      .emit('session:member_left', { user_id: userId, username });

    this.socket.leave(`room:${roomId}`);
    this.roomState.currentRoomId = null;
  }
}
