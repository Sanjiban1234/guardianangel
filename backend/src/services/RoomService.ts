import crypto from 'crypto';
import { QueryRunner } from '../db/QueryRunner';

export interface CreateRoomResult {
  room_id: string;
  group_code: string;
  creator_id: string;
}

export interface JoinRoomResult {
  room_id: string;
}

export interface RoomMember {
  user_id: string;
  name: string;
}

export interface RoomVerification {
  id: string;
  status: string;
}

export class RoomService {
  constructor(private readonly db: QueryRunner) {}

  private generateGroupCode(): string {
    return crypto.randomBytes(8).toString('hex').toUpperCase();
  }

  async createRoom(userId: string): Promise<CreateRoomResult> {
    const groupCode = this.generateGroupCode();

    const result = await this.db.run(
      `INSERT INTO active_riders (user_id, group_code, type_of_operation, status)
       VALUES ($1, $2, 'ride', 'active')
       RETURNING id, group_code`,
      [userId, groupCode]
    );

    const row = result.rows[0];
    return {
      room_id: row.id,
      group_code: row.group_code,
      creator_id: userId,
    };
  }

  async joinRoom(userId: string, groupCode: string): Promise<JoinRoomResult> {
    const existing = await this.db.run(
      "SELECT id, status FROM active_riders WHERE group_code = $1 AND status = 'active' LIMIT 1",
      [groupCode.toUpperCase()]
    );

    if (existing.rows.length === 0) {
      const err = new Error('Ride group not found');
      (err as any).code = 'ROOM_NOT_FOUND';
      throw err;
    }

    const room = existing.rows[0];

    if (room.status !== 'active') {
      const err = new Error('This ride group has already ended');
      (err as any).code = 'ROOM_ENDED';
      throw err;
    }

    await this.db.run(
      `INSERT INTO active_riders (user_id, group_code, include_id, type_of_operation, status)
       VALUES ($1, $2, $3, 'ride', 'active')
       ON CONFLICT (user_id, group_code) DO NOTHING`,
      [userId, groupCode.toUpperCase(), existing.rows[0].id]
    );

    return { room_id: room.id };
  }

  async isMember(groupCode: string, userId: string): Promise<boolean> {
    try {
      const result = await this.db.run(
        "SELECT 1 FROM active_riders WHERE group_code = $1 AND user_id = $2 AND status = 'active'",
        [groupCode, userId]
      );
      return result.rows.length > 0;
    } catch {
      return false;
    }
  }

  async verifyMembership(
    groupCode: string,
    userId: string
  ): Promise<RoomVerification | null> {
    try {
      const result = await this.db.run(
        "SELECT id, status FROM active_riders WHERE group_code = $1 AND user_id = $2 AND status = 'active'",
        [groupCode.toUpperCase(), userId]
      );
      return result.rows.length > 0 ? result.rows[0] : null;
    } catch {
      return null;
    }
  }

  async getMembers(groupCode: string): Promise<RoomMember[]> {
    try {
      const result = await this.db.run(
        `SELECT ar.user_id, u.name
         FROM active_riders ar
         JOIN users u ON ar.user_id = u.id
         WHERE ar.group_code = $1 AND ar.status = 'active'`,
        [groupCode]
      );
      return result.rows as RoomMember[];
    } catch {
      return [];
    }
  }

  async getRoomHistory(groupCode: string): Promise<any[]> {
    const result = await this.db.run(
      `SELECT eh.user_id, u.name, eh.device_timestamp,
              eh.latitude, eh.longitude, eh.accuracy, eh.speed
       FROM engine_heartbeat eh
       JOIN users u ON eh.user_id = u.id
       WHERE eh.group_code = $1
       ORDER BY eh.device_timestamp ASC`,
      [groupCode]
    );
    return result.rows;
  }

  async endRoom(groupCode: string): Promise<void> {
    await this.db.run(
      "UPDATE active_riders SET status = 'ended' WHERE group_code = $1",
      [groupCode]
    );
  }
}
