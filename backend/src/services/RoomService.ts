import crypto from 'crypto';
import { QueryRunner } from '../db/QueryRunner';

export interface CreateRoomResult {
  room_id: string;
  room_token: string;
  creator_id: string;
}

export interface JoinRoomResult {
  room_id: string;
}

export interface RoomMember {
  user_id: string;
  username: string;
}

export interface RoomVerification {
  id: string;
  status: string;
}

/**
 * RoomService — owns all Ride Room business logic.
 *
 * Each method is independently try/catch-able by its caller.
 * No Express, no Socket.io — pure domain operations.
 */
export class RoomService {
  constructor(private readonly db: QueryRunner) {}

  /** Generate a human-readable 16-character uppercase hex token */
  private generateRoomToken(): string {
    return crypto.randomBytes(8).toString('hex').toUpperCase();
  }

  /**
   * Create a new Ride Room and auto-enroll the creator as a member.
   * Throws if the DB write fails.
   */
  async createRoom(userId: string): Promise<CreateRoomResult> {
    const roomToken = this.generateRoomToken();

    const roomResult = await this.db.run(
      `INSERT INTO ride_rooms (room_token, creator_id, status)
       VALUES ($1, $2, 'active')
       RETURNING id, room_token, creator_id`,
      [roomToken, userId]
    );

    const room = roomResult.rows[0];

    // Auto-join creator — ignore if already a member
    await this.db.run(
      'INSERT INTO room_members (room_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [room.id, userId]
    );

    return {
      room_id: room.id,
      room_token: room.room_token,
      creator_id: room.creator_id,
    };
  }

  /**
   * Join an existing active Ride Room by token.
   * Throws with code ROOM_NOT_FOUND or ROOM_ENDED for business-logic errors.
   */
  async joinRoom(userId: string, roomToken: string): Promise<JoinRoomResult> {
    const roomResult = await this.db.run(
      'SELECT id, status FROM ride_rooms WHERE room_token = $1',
      [roomToken.toUpperCase()]
    );

    if (roomResult.rows.length === 0) {
      const err = new Error('Ride room not found');
      (err as any).code = 'ROOM_NOT_FOUND';
      throw err;
    }

    const room = roomResult.rows[0];

    if (room.status !== 'active') {
      const err = new Error('This ride room has already ended');
      (err as any).code = 'ROOM_ENDED';
      throw err;
    }

    await this.db.run(
      'INSERT INTO room_members (room_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [room.id, userId]
    );

    return { room_id: room.id };
  }

  /**
   * Check if a user is a member of a specific room.
   * Returns true/false — never throws.
   */
  async isMember(roomId: string, userId: string): Promise<boolean> {
    try {
      const result = await this.db.run(
        'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
        [roomId, userId]
      );
      return result.rows.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Verify that a room token is valid, active, and the user is a member.
   * Returns the room record or null.
   */
  async verifyMembership(
    roomToken: string,
    userId: string
  ): Promise<RoomVerification | null> {
    try {
      const result = await this.db.run(
        `SELECT r.id, r.status
         FROM ride_rooms r
         JOIN room_members m ON r.id = m.room_id
         WHERE r.room_token = $1 AND m.user_id = $2`,
        [roomToken.toUpperCase(), userId]
      );
      return result.rows.length > 0 ? result.rows[0] : null;
    } catch {
      return null;
    }
  }

  /**
   * List all members currently in a room.
   * Returns empty array on error — callers handle the empty case.
   */
  async getMembers(roomId: string): Promise<RoomMember[]> {
    try {
      const result = await this.db.run(
        `SELECT m.user_id, u.username
         FROM room_members m
         JOIN users u ON m.user_id = u.id
         WHERE m.room_id = $1`,
        [roomId]
      );
      return result.rows as RoomMember[];
    } catch {
      return [];
    }
  }

  /**
   * Retrieve full telemetry history for a room.
   * Caller must have already verified membership.
   */
  async getRoomHistory(roomId: string): Promise<any[]> {
    const result = await this.db.run(
      `SELECT t.user_id, u.username, t.device_timestamp,
              t.latitude, t.longitude, t.accuracy, t.speed
       FROM telemetry_readings t
       JOIN users u ON t.user_id = u.id
       WHERE t.room_id = $1
       ORDER BY t.device_timestamp ASC`,
      [roomId]
    );
    return result.rows;
  }
}
