import crypto from 'crypto';
import { QueryRunner } from '../db/QueryRunner';

export interface CreateRoomResult {
  room_id: string;
  group_code: string;
  creator_id: string;
  destination: Destination;
}

export interface JoinRoomResult {
  room_id: string;
}

export interface Destination {
  latitude: number;
  longitude: number;
  label?: string;
}

const ROOM_EXPIRY_HOURS = 24;
const MAX_ROOM_MEMBERS = 20;

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
    return crypto.randomBytes(6).toString('hex').toUpperCase();
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  async createRoom(userId: string, destination: Destination): Promise<CreateRoomResult> {
    await this.assertProfileComplete(userId);
    const groupCode = this.generateGroupCode();
    const tokenHash = this.hashToken(groupCode);

    const result = await this.db.run(
      `INSERT INTO ride_rooms
         (token_hash, creator_id, destination_latitude, destination_longitude, destination_label)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [tokenHash, userId, destination.latitude, destination.longitude, destination.label || null]
    );

    const roomId = result.rows[0].id;

    await this.db.run(
      `INSERT INTO room_members (room_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [roomId, userId]
    );

    return {
      room_id: roomId,
      group_code: groupCode,
      creator_id: userId,
      destination,
    };
  }

  async joinRoom(userId: string, groupCode: string): Promise<JoinRoomResult> {
    await this.assertProfileComplete(userId);
    const tokenHash = this.hashToken(groupCode.toUpperCase());

    const existing = await this.db.run(
      `SELECT id, status, created_at,
              created_at + INTERVAL '${ROOM_EXPIRY_HOURS} hours' AS expires_at
       FROM ride_rooms WHERE token_hash = $1 LIMIT 1`,
      [tokenHash]
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

    if (new Date(room.expires_at).getTime() <= Date.now()) {
      const err = new Error('This ride group has expired');
      (err as any).code = 'ROOM_EXPIRED';
      throw err;
    }

    const memberCheck = await this.db.run(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2 LIMIT 1',
      [room.id, userId]
    );
    if (memberCheck.rows.length > 0) {
      const err = new Error('You are already a member of this ride group');
      (err as any).code = 'ALREADY_MEMBER';
      throw err;
    }

    const memberCount = await this.db.run(
      'SELECT COUNT(*)::int AS count FROM room_members WHERE room_id = $1',
      [room.id]
    );
    if (Number(memberCount.rows[0]?.count ?? 0) >= MAX_ROOM_MEMBERS) {
      const err = new Error('This ride group is full');
      (err as any).code = 'ROOM_FULL';
      throw err;
    }

    await this.db.run(
      `INSERT INTO room_members (room_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [room.id, userId]
    );

    return { room_id: room.id };
  }

  private async assertProfileComplete(userId: string): Promise<void> {
    const result = await this.db.run(
      'SELECT profile_complete FROM users WHERE id = $1 LIMIT 1',
      [userId]
    );
    if (result.rows[0]?.profile_complete === false) {
      const err = new Error('Complete registration before creating or joining a ride');
      (err as any).code = 'PROFILE_INCOMPLETE';
      throw err;
    }
  }

  async isMember(groupCode: string, userId: string): Promise<boolean> {
    const tokenHash = this.hashToken(groupCode.toUpperCase());
    try {
      const result = await this.db.run(
        `SELECT 1 FROM room_members rm
         JOIN ride_rooms rr ON rr.id = rm.room_id
         WHERE rr.token_hash = $1 AND rm.user_id = $2 AND rr.status = 'active'`,
        [tokenHash, userId]
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
    const tokenHash = this.hashToken(groupCode.toUpperCase());
    try {
      const result = await this.db.run(
        `SELECT rr.id, rr.status FROM ride_rooms rr
         JOIN room_members rm ON rm.room_id = rr.id
         WHERE rr.token_hash = $1 AND rm.user_id = $2`,
        [tokenHash, userId]
      );
      return result.rows.length > 0 ? result.rows[0] : null;
    } catch {
      return null;
    }
  }

  async getMembers(groupCode: string): Promise<RoomMember[]> {
    const tokenHash = this.hashToken(groupCode.toUpperCase());
    try {
      const result = await this.db.run(
        `SELECT rm.user_id, u.name
         FROM room_members rm
         JOIN ride_rooms rr ON rr.id = rm.room_id
         JOIN users u ON rm.user_id = u.id
         WHERE rr.token_hash = $1 AND rr.status = 'active'`,
        [tokenHash]
      );
      return result.rows as RoomMember[];
    } catch {
      return [];
    }
  }

  async getRoomHistory(groupCode: string): Promise<any[]> {
    const tokenHash = this.hashToken(groupCode.toUpperCase());
    const result = await this.db.run(
      `SELECT tr.user_id, u.name, tr.device_timestamp_ms AS device_timestamp,
              ST_Y(tr.location::geometry) AS latitude,
              ST_X(tr.location::geometry) AS longitude,
              tr.accuracy, tr.speed
       FROM telemetry_readings tr
       JOIN ride_rooms rr ON rr.id = tr.room_id
       JOIN users u ON tr.user_id = u.id
       WHERE rr.token_hash = $1
       ORDER BY tr.device_timestamp_ms ASC`,
      [tokenHash]
    );
    return result.rows;
  }

  async endRoom(groupCode: string): Promise<void> {
    const tokenHash = this.hashToken(groupCode.toUpperCase());
    await this.db.run(
      "UPDATE ride_rooms SET status = 'ended', ended_at = now() WHERE token_hash = $1",
      [tokenHash]
    );
  }
}
