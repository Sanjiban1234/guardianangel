import crypto from 'crypto';
import { QueryRunner } from '../db/QueryRunner';
import { FcmPushService } from './FcmPushService';

export interface RefillNotificationRecord {
  id: string;
  room_id: string;
  rider_id: string;
  note?: string;
  created_at: number;
}

export class RefillNotificationService {
  constructor(private readonly db: QueryRunner, private readonly fcmPushService?: FcmPushService) {}

  private hashToken(groupCode: string): string {
    return crypto.createHash('sha256').update(groupCode.toUpperCase()).digest('hex');
  }

  async requestRefill(groupCode: string, riderId: string, riderName: string, note?: string): Promise<RefillNotificationRecord> {
    if (note !== undefined && (typeof note !== 'string' || note.length > 1000)) {
      throw new Error('Refill note must be at most 1000 characters');
    }
    const room = await this.db.run(
      `SELECT rr.id FROM ride_rooms rr JOIN room_members rm ON rm.room_id = rr.id
       WHERE rr.token_hash = $1 AND rm.user_id = $2 AND rr.status = 'active'
         AND rr.created_at + INTERVAL '24 hours' > now() LIMIT 1`,
      [this.hashToken(groupCode), riderId]
    );
    if (room.rows.length === 0) throw new Error('You are not a member of an active ride group');
    const roomId = room.rows[0].id;
    const inserted = await this.db.run(
      `INSERT INTO refill_notifications (room_id, rider_id, note)
       VALUES ($1, $2, $3) RETURNING id, room_id, rider_id, note, created_at`,
      [roomId, riderId, note || null]
    );
    const row = inserted.rows[0];
    const record: RefillNotificationRecord = {
      id: row.id, room_id: row.room_id, rider_id: row.rider_id,
      note: row.note || undefined, created_at: new Date(row.created_at).getTime(),
    };
    if (this.fcmPushService) {
      try {
        const members = await this.db.run('SELECT user_id FROM room_members WHERE room_id = $1 AND user_id != $2', [roomId, riderId]);
        await this.fcmPushService.sendRefillPush(members.rows.map((member) => member.user_id), {
          refill_id: record.id, user_id: riderId, name: riderName, group_code: groupCode,
          note: record.note, created_at: record.created_at,
        });
      } catch (err) {
        console.error('RefillNotificationService: failed sending FCM notification:', err);
      }
    }
    return record;
  }
}
