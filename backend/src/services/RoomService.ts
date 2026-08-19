import crypto from 'crypto';
import { QueryRunner } from '../db/QueryRunner';
import { AppError } from '../utils/AppError';

export interface CreateRoomResult {
  room_id: string;
  group_code: string;
  creator_id: string;
  destination: Destination;
}

export interface JoinRoomResult {
  room_id: string;
  destination?: Destination;
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
  role: string;
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
      `SELECT id, status, created_at, destination_latitude, destination_longitude, destination_label,
              created_at + INTERVAL '${ROOM_EXPIRY_HOURS} hours' AS expires_at
       FROM ride_rooms WHERE token_hash = $1 LIMIT 1`,
      [tokenHash]
    );

    if (existing.rows.length === 0) {
      throw new AppError('Ride group not found', 'ROOM_NOT_FOUND');
    }

    const room = existing.rows[0];

    if (room.status !== 'active') {
      throw new AppError('This ride group has already ended', 'ROOM_ENDED');
    }

    if (new Date(room.expires_at).getTime() <= Date.now()) {
      throw new AppError('This ride group has expired', 'ROOM_EXPIRED');
    }

    const memberCheck = await this.db.run(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2 LIMIT 1',
      [room.id, userId]
    );
    if (memberCheck.rows.length > 0) {
      const err: any = new AppError('You are already a member of this ride group', 'ALREADY_MEMBER');
      err.room_id = room.id;
      throw err;
    }

    const memberCount = await this.db.run(
      'SELECT COUNT(*)::int AS count FROM room_members WHERE room_id = $1',
      [room.id]
    );
    if (Number(memberCount.rows[0]?.count ?? 0) >= MAX_ROOM_MEMBERS) {
      throw new AppError('This ride group is full', 'ROOM_FULL');
    }

    await this.db.run(
      `INSERT INTO room_members (room_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [room.id, userId]
    );

    return {
      room_id: room.id,
      destination: room.destination_latitude != null && room.destination_longitude != null
        ? { latitude: room.destination_latitude, longitude: room.destination_longitude, label: room.destination_label }
        : undefined,
    };
  }

  /** Return persisted room details needed to recover an idempotent join. */
  async getRoomByCode(groupCode: string): Promise<{ room_id: string; destination?: { latitude: number; longitude: number; label: string | null } } | null> {
    const tokenHash = this.hashToken(groupCode.toUpperCase());
    const result = await this.db.run(
      `SELECT id, destination_latitude, destination_longitude, destination_label
       FROM ride_rooms WHERE token_hash = $1 LIMIT 1`,
      [tokenHash],
    );
    if (result.rows.length === 0) return null;
    const room = result.rows[0];
    return {
      room_id: room.id,
      destination: room.destination_latitude != null && room.destination_longitude != null
        ? {
            latitude: Number(room.destination_latitude),
            longitude: Number(room.destination_longitude),
            label: room.destination_label,
          }
        : undefined,
    };
  }

  private async assertProfileComplete(userId: string): Promise<void> {
    const result = await this.db.run(
      'SELECT profile_complete FROM users WHERE id = $1 LIMIT 1',
      [userId]
    );
    if (result.rows[0]?.profile_complete === false) {
      throw new AppError('Complete registration before creating or joining a ride', 'PROFILE_INCOMPLETE');
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
        `SELECT rm.user_id, u.name, rm.role
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

  async getRoomRideStatus(groupCode: string): Promise<{ rideStartedAt: string | null } | null> {
    const tokenHash = this.hashToken(groupCode.toUpperCase());
    try {
      const result = await this.db.run(
        `SELECT ride_started_at FROM ride_rooms WHERE token_hash = $1`,
        [tokenHash]
      );
      if (result.rows.length === 0) return null;
      return { rideStartedAt: result.rows[0].ride_started_at };
    } catch {
      return null;
    }
  }

  /** Authoritative state used by a client to restore an interrupted active ride. */
  async getActiveMembership(groupCode: string, userId: string): Promise<{
    group_code: string;
    role: string;
    rideStartedAt: string | null;
    destination?: Destination;
  } | null> {
    const tokenHash = this.hashToken(groupCode.toUpperCase());
    const result = await this.db.run(
      `SELECT rm.role, rr.ride_started_at, rr.destination_latitude, rr.destination_longitude, rr.destination_label
       FROM ride_rooms rr
       JOIN room_members rm ON rm.room_id = rr.id
       WHERE rr.token_hash = $1 AND rm.user_id = $2 AND rr.status = 'active'
       LIMIT 1`,
      [tokenHash, userId],
    );
    if (result.rows.length === 0) return null;
    const room = result.rows[0];
    return {
      group_code: groupCode.toUpperCase(),
      role: room.role,
      rideStartedAt: room.ride_started_at,
      destination: room.destination_latitude != null && room.destination_longitude != null
        ? {
            latitude: Number(room.destination_latitude),
            longitude: Number(room.destination_longitude),
            label: room.destination_label || undefined,
          }
        : undefined,
    };
  }

  async startRide(groupCode: string, userId: string): Promise<boolean> {
    const tokenHash = this.hashToken(groupCode.toUpperCase());
    const result = await this.db.run(
      `SELECT rr.id, rr.creator_id, rm.role
       FROM ride_rooms rr
       JOIN room_members rm ON rm.room_id = rr.id AND rm.user_id = $2
       WHERE rr.token_hash = $1 AND rr.status = 'active'`,
      [tokenHash, userId]
    );
    if (result.rows.length === 0) return false;
    if (result.rows[0].role !== 'owner') return false;

    await this.db.run(
      `UPDATE ride_rooms SET ride_started_at = NOW() WHERE token_hash = $1 AND ride_started_at IS NULL`,
      [tokenHash]
    );
    return true;
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

  async endRoom(groupCode: string, userId: string): Promise<boolean> {
    const tokenHash = this.hashToken(groupCode.toUpperCase());
    const result = await this.db.run(
      `UPDATE ride_rooms rr SET status = 'ended', ended_at = now()
       FROM room_members rm
       WHERE rr.token_hash = $1 AND rr.status = 'active'
         AND rm.room_id = rr.id AND rm.user_id = $2 AND rm.role = 'owner'
       RETURNING rr.id`,
      [tokenHash, userId],
    );
    return result.rows.length > 0;
  }

  /** Explicit leave only: network disconnects deliberately never call this. */
  async leaveRoom(groupCode: string, userId: string): Promise<boolean> {
    const tokenHash = this.hashToken(groupCode.toUpperCase());
    const result = await this.db.run(
      `DELETE FROM room_members rm
       USING ride_rooms rr
       WHERE rm.room_id = rr.id AND rr.token_hash = $1 AND rr.status = 'active'
         AND rm.user_id = $2 AND rm.role <> 'owner'
       RETURNING rm.user_id`,
      [tokenHash, userId],
    );
    return result.rows.length > 0;
  }
}
