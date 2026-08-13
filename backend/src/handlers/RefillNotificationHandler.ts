import { Server } from 'socket.io';
import { AuthenticatedSocket } from '../middleware/AuthMiddleware';
import { RefillNotificationService } from '../services/RefillNotificationService';

export class RefillNotificationHandler {
  constructor(private readonly io: Server, private readonly socket: AuthenticatedSocket, private readonly refillService: RefillNotificationService) {}

  register(): void {
    this.socket.on('refill:requested', (data?: { group_code?: string; note?: string }) => this.handleRequest(data));
  }

  private async handleRequest(data?: { group_code?: string; note?: string }): Promise<void> {
    const groupCode = data?.group_code;
    const userId = this.socket.user?.id;
    const name = this.socket.user?.name;
    if (!groupCode || typeof groupCode !== 'string' || !userId || !name) {
      this.socket.emit('error', { message: 'A group code is required to request a petrol refill' });
      return;
    }
    try {
      const record = await this.refillService.requestRefill(groupCode, userId, name, data?.note);
      this.io.to(`group:${groupCode}`).emit('refill:notified', {
        refill_id: record.id, user_id: userId, name, group_code: groupCode,
        note: record.note, timestamp: record.created_at,
      });
    } catch (err) {
      this.socket.emit('error', { message: err instanceof Error ? err.message : 'Failed to request petrol refill' });
    }
  }
}
