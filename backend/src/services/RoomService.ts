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
  group_code: string;
  status: string;
  role: string;
  rideStartedAt: string | null;
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
  vehicle_model?: string;
  plate_number?: string;
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
         (token_hash, creator_id, destination_latitude, destination_longitude, destination_label, group_code)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [tokenHash, userId, destination.latitude, destination.longitude, destination.label || null, groupCode]
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
    return this.db.transaction(db => this.joinMembership(db, userId, { groupCode: groupCode.toUpperCase() }));
  }

  async joinRoomById(userId: string, roomId: string, transaction?: QueryRunner): Promise<JoinRoomResult> {
    const join = (db: QueryRunner) => this.joinMembership(db, userId, { roomId });
    return transaction ? join(transaction) : this.db.transaction(join);
  }

  /** Both entry methods serialize membership decisions per rider and capacity per room. */
  private async joinMembership(db: QueryRunner, userId: string, target: { roomId?: string; groupCode?: string }): Promise<JoinRoomResult> {
    const profile = await db.run('SELECT profile_complete FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (profile.rows[0]?.profile_complete === false) {
      throw new AppError('Complete registration before creating or joining a ride', 'PROFILE_INCOMPLETE');
    }
    const existing = await db.run(`SELECT id, group_code, status, ride_started_at,
      destination_latitude, destination_longitude, destination_label,
      created_at + INTERVAL '${ROOM_EXPIRY_HOURS} hours' AS expires_at
      FROM ride_rooms WHERE ${target.roomId ? 'id' : 'token_hash'} = $1 LIMIT 1 FOR UPDATE`,
      [target.roomId || this.hashToken(target.groupCode!)]);
    const room = existing.rows[0];
    if (!room) throw new AppError('Ride group not found', 'ROOM_NOT_FOUND');
    if (room.status !== 'active') throw new AppError('This ride group has already ended', 'ROOM_ENDED');
    if (new Date(room.expires_at).getTime() <= Date.now()) throw new AppError('This ride group has expired', 'ROOM_EXPIRED');
    const memberships = await db.run(`SELECT rm.room_id, rm.role FROM room_members rm
      JOIN ride_rooms rr ON rr.id = rm.room_id
      WHERE rm.user_id = $1 AND rr.status = 'active'
      AND rr.created_at + INTERVAL '${ROOM_EXPIRY_HOURS} hours' > now()`, [userId]);
    if (memberships.rows.some(member => member.room_id !== room.id)) {
      throw new AppError('You are already participating in another active ride.', 'ACTIVE_ROOM_CONFLICT');
    }
    const groupCode = target.groupCode || room.group_code;
    if (!groupCode) {
      throw new AppError('Ask the host to reopen this ride, then try accepting again.', 'ROOM_CODE_UNAVAILABLE');
    }
    if (room.group_code === null && target.groupCode) {
      await db.run('UPDATE ride_rooms SET group_code = $2 WHERE id = $1 AND group_code IS NULL', [room.id, groupCode]);
    }
    const member = memberships.rows.find(member => member.room_id === room.id);
    if (!member) {
      const count = await db.run('SELECT COUNT(*)::int AS count FROM room_members WHERE room_id = $1', [room.id]);
      if (Number(count.rows[0]?.count ?? 0) >= MAX_ROOM_MEMBERS) throw new AppError('This ride group is full', 'ROOM_FULL');
      await db.run("INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT (room_id, user_id) DO NOTHING", [room.id, userId]);
    }
    return {
      room_id: room.id, group_code: groupCode, status: room.status,
      role: member?.role || 'member', rideStartedAt: room.ride_started_at || null,
      destination: room.destination_latitude != null && room.destination_longitude != null
        ? { latitude: Number(room.destination_latitude), longitude: Number(room.destination_longitude), label: room.destination_label || undefined }
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
        `SELECT rr.id, rr.status, rr.group_code FROM ride_rooms rr
         JOIN room_members rm ON rm.room_id = rr.id
         WHERE rr.token_hash = $1 AND rm.user_id = $2`,
        [tokenHash, userId]
      );
      const room = result.rows[0];
      // A verified legacy member supplies the original code; never rotate it.
      if (room?.group_code === null && room.status === 'active') {
        await this.db.run('UPDATE ride_rooms SET group_code = $2 WHERE id = $1 AND group_code IS NULL', [room.id, groupCode.toUpperCase()]);
      }
      return room || null;
    } catch {
      return null;
    }
  }

  async getMembers(groupCode: string): Promise<RoomMember[]> {
    const tokenHash = this.hashToken(groupCode.toUpperCase());
    try {
      const result = await this.db.run(
        `SELECT rm.user_id, u.name, rm.role, u.vehicle_model, u.plate_number
         FROM room_members rm
         JOIN ride_rooms rr ON rr.id = rm.room_id
         JOIN users u ON rm.user_id = u.id
         WHERE rr.token_hash = $1 AND rr.status = 'active'`,
        [tokenHash]
      );
      return result.rows.map((row) => ({
        ...row,
        vehicle_model: row.vehicle_model || undefined,
        plate_number: row.plate_number || undefined,
      })) as RoomMember[];
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
    room_id: string;
    role: string;
    rideStartedAt: string | null;
    destination?: Destination;
  } | null> {
    const tokenHash = this.hashToken(groupCode.toUpperCase());
    const result = await this.db.run(
      `SELECT rr.id, rm.role, rr.ride_started_at, rr.destination_latitude, rr.destination_longitude, rr.destination_label
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
      room_id: room.id,
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

  async pauseRider(groupCode: string, userId: string): Promise<boolean> {
    const tokenHash = this.hashToken(groupCode.toUpperCase());
    const result = await this.db.run(
      `SELECT rr.id, rr.ride_started_at
       FROM ride_rooms rr
       JOIN room_members rm ON rm.room_id = rr.id AND rm.user_id = $2
       WHERE rr.token_hash = $1 AND rr.status = 'active'`,
      [tokenHash, userId]
    );
    if (result.rows.length === 0) return false;
    if (!result.rows[0].ride_started_at) return false;

    const updateRes = await this.db.run(
      `UPDATE room_members rm
       SET ride_state = 'paused'
       FROM ride_rooms rr
       WHERE rm.room_id = rr.id AND rr.token_hash = $1 AND rr.status = 'active'
         AND rm.user_id = $2
       RETURNING rm.user_id`,
      [tokenHash, userId]
    );
    return updateRes.rows.length > 0;
  }

  async resumeRider(groupCode: string, userId: string): Promise<boolean> {
    const tokenHash = this.hashToken(groupCode.toUpperCase());
    const result = await this.db.run(
      `UPDATE room_members rm
       SET ride_state = 'active'
       FROM ride_rooms rr
       WHERE rm.room_id = rr.id AND rr.token_hash = $1 AND rr.status = 'active'
         AND rm.user_id = $2
       RETURNING rm.user_id`,
      [tokenHash, userId]
    );
    return result.rows.length > 0;
  }
}
