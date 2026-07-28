import crypto from 'crypto';
import { QueryRunner } from '../db/QueryRunner';

export interface CrashCandidate {
  id: string;
  room_id: string;
  user_id: string;
  device_timestamp_ms: number;
  latitude: number;
  longitude: number;
  speed: number | null;
  speed_reading_timestamp_ms: number | null;
  outcome: 'confirmed' | 'false_alarm' | null;
  created_at: string;
}

export class CrashCandidateRepository {
  constructor(private readonly db: QueryRunner) {}

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token.toUpperCase()).digest('hex');
  }

  async resolveRoomId(groupCode: string): Promise<string | null> {
    const tokenHash = this.hashToken(groupCode);
    const result = await this.db.run(
      "SELECT id FROM ride_rooms WHERE token_hash = $1 AND status = 'active' LIMIT 1",
      [tokenHash]
    );
    return result.rows.length > 0 ? result.rows[0].id : null;
  }

  async insert(
    roomId: string | null,
    userId: string,
    deviceTimestampMs: number,
    latitude: number,
    longitude: number
  ): Promise<CrashCandidate> {
    let speed: number | null = null;
    let speedReadingTimestampMs: number | null = null;

    if (roomId) {
      const telemetry = await this.db.run(
        `SELECT speed, device_timestamp_ms
         FROM rider_current_locations
         WHERE room_id = $1 AND user_id = $2`,
        [roomId, userId]
      );
      if (telemetry.rows.length > 0) {
        speed = telemetry.rows[0].speed;
        speedReadingTimestampMs = Number(telemetry.rows[0].device_timestamp_ms);
      }
    }

    const result = await this.db.run(
      `INSERT INTO crash_candidates
         (room_id, user_id, device_timestamp_ms, location, speed, speed_reading_timestamp_ms)
       VALUES (
         $1, $2, $3,
         ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
         $6, $7
       )
       RETURNING id, room_id, user_id, device_timestamp_ms,
                 ST_Y(location::geometry) AS latitude,
                 ST_X(location::geometry) AS longitude,
                 speed, speed_reading_timestamp_ms, outcome, created_at`,
      [roomId, userId, deviceTimestampMs, longitude, latitude, speed, speedReadingTimestampMs]
    );

    return result.rows[0];
  }

  async updateOutcome(
    id: string,
    outcome: 'confirmed' | 'false_alarm'
  ): Promise<void> {
    await this.db.run(
      `UPDATE crash_candidates SET outcome = $1 WHERE id = $2`,
      [outcome, id]
    );
  }

  async findById(id: string): Promise<CrashCandidate | null> {
    const result = await this.db.run(
      `SELECT id, room_id, user_id, device_timestamp_ms,
              ST_Y(location::geometry) AS latitude,
              ST_X(location::geometry) AS longitude,
              speed, speed_reading_timestamp_ms, outcome, created_at
       FROM crash_candidates WHERE id = $1`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  async findLatestForUserInRoom(
    roomId: string,
    userId: string
  ): Promise<CrashCandidate | null> {
    const result = await this.db.run(
      `SELECT id, room_id, user_id, device_timestamp_ms,
              ST_Y(location::geometry) AS latitude,
              ST_X(location::geometry) AS longitude,
              speed, speed_reading_timestamp_ms, outcome, created_at
       FROM crash_candidates
       WHERE room_id = $1 AND user_id = $2
       ORDER BY device_timestamp_ms DESC
       LIMIT 1`,
      [roomId, userId]
    );
    return result.rows[0] ?? null;
  }

  async findLatestForUserByGroupCode(
    groupCode: string,
    userId: string
  ): Promise<CrashCandidate | null> {
    const tokenHash = this.hashToken(groupCode);
    const result = await this.db.run(
      `SELECT cc.id, cc.room_id, cc.user_id, cc.device_timestamp_ms,
              ST_Y(cc.location::geometry) AS latitude,
              ST_X(cc.location::geometry) AS longitude,
              cc.speed, cc.speed_reading_timestamp_ms, cc.outcome, cc.created_at
       FROM crash_candidates cc
       JOIN ride_rooms rr ON rr.id = cc.room_id
       WHERE rr.token_hash = $1 AND cc.user_id = $2
       ORDER BY cc.device_timestamp_ms DESC
       LIMIT 1`,
      [tokenHash, userId]
    );
    return result.rows[0] ?? null;
  }
}
