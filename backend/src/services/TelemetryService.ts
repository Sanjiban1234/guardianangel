import crypto from 'crypto';
import { QueryRunner } from '../db/QueryRunner';
import { logger } from '../utils/logger';
import { RIDER_LOCATION_FRESHNESS_MS } from './PresenceService';

const MAX_LIVE_CLOCK_LEAD_MS = 5_000;

export interface TelemetryReading {
  client_reading_id?: string;
  groupCode?: string;
  timestamp: number;
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null;
}

export interface BulkTelemetryReading extends TelemetryReading {
  client_reading_id: string;
}

export class TelemetryService {
  constructor(private readonly db: QueryRunner) {}

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token.toUpperCase()).digest('hex');
  }

  async saveTelemetry(groupCode: string, userId: string, reading: TelemetryReading): Promise<{ accepted: boolean; live: boolean }> {
    const historical = Date.now() - reading.timestamp > RIDER_LOCATION_FRESHNESS_MS || reading.timestamp > Date.now() + MAX_LIVE_CLOCK_LEAD_MS;
    try {
      const result = await this.db.run(
        `INSERT INTO telemetry_readings
           (room_id, user_id, device_timestamp_ms, location, accuracy, speed, client_reading_id, is_historical)
         VALUES ((SELECT id FROM ride_rooms WHERE token_hash = $1 AND status = 'active' LIMIT 1),
           $2::uuid, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
           $6, $7, $8::uuid, $9)
         ON CONFLICT DO NOTHING RETURNING id`,
        [this.hashToken(groupCode), userId, reading.timestamp, reading.longitude, reading.latitude,
          reading.accuracy, reading.speed, reading.client_reading_id || crypto.randomUUID(), historical]);
      if (result.rows.length === 0) {
        const existing = await this.db.run(
          `SELECT tr.id FROM telemetry_readings tr JOIN ride_rooms rr ON rr.id = tr.room_id
           WHERE rr.token_hash = $1 AND tr.user_id = $2 AND tr.device_timestamp_ms = $3`,
          [this.hashToken(groupCode), userId, reading.timestamp]);
        return { accepted: existing.rows.length > 0, live: false };
      }
      if (historical) return { accepted: true, live: false };
      const current = await this.db.run(
        `SELECT l.device_timestamp_ms FROM rider_current_locations l JOIN ride_rooms rr ON rr.id = l.room_id
         WHERE rr.token_hash = $1 AND l.user_id = $2`, [this.hashToken(groupCode), userId]);
      return { accepted: true, live: Number(current.rows[0]?.device_timestamp_ms) === reading.timestamp };
    } catch {
      logger.warn('telemetry write failed');
      return { accepted: false, live: false };
    }
  }

  /** Historical upload is authorized independently of the currently joined room.
   * This permits final delivery for ended rides without joining/reactivating them. */
  async bulkSyncTelemetry(groupCode: string, userId: string, readings: BulkTelemetryReading[]): Promise<string[]> {
    if (!readings.length) return [];
    try {
      const room = await this.db.run(
        `SELECT rr.id FROM ride_rooms rr JOIN room_members rm ON rm.room_id = rr.id
         WHERE rr.token_hash = $1 AND rm.user_id = $2`, [this.hashToken(groupCode), userId]);
      if (!room.rows[0]) return [];
      await this.db.run(
        `INSERT INTO telemetry_readings
           (room_id, user_id, device_timestamp_ms, location, accuracy, speed, client_reading_id, is_historical)
         SELECT $1::uuid, $2::uuid, r.timestamp_ms,
           ST_SetSRID(ST_MakePoint(r.longitude, r.latitude), 4326)::geography,
           r.accuracy, r.speed, r.client_reading_id, true
         FROM jsonb_to_recordset($3::jsonb) AS r(client_reading_id uuid, timestamp_ms bigint,
           latitude double precision, longitude double precision, accuracy real, speed real)
         ON CONFLICT DO NOTHING`,
        [room.rows[0].id, userId, JSON.stringify(readings.map(r => ({
          client_reading_id: r.client_reading_id, timestamp_ms: r.timestamp,
          latitude: r.latitude, longitude: r.longitude, accuracy: r.accuracy, speed: r.speed,
        })))]);
      // INSERT has committed. Confirm existing retries too, scoped to this rider/ride.
      // Timestamp identity also handles legacy clients resending an identical fix with a new UUID.
      const stored = await this.db.run(
        `SELECT client_reading_id, device_timestamp_ms FROM telemetry_readings
         WHERE room_id = $1 AND user_id = $2 AND device_timestamp_ms = ANY($3::bigint[])`,
        [room.rows[0].id, userId, readings.map(r => r.timestamp)]);
      const timestamps = new Set(stored.rows.map(row => Number(row.device_timestamp_ms)));
      return readings.filter(r => timestamps.has(r.timestamp)).map(r => r.client_reading_id);
    } catch {
      logger.warn('bulk telemetry write failed');
      return [];
    }
  }

  async ridersNearby(
    groupCode: string,
    latitude: number,
    longitude: number,
    radiusMeters: number
  ): Promise<Array<{ userId: string; latitude: number; longitude: number; distanceMeters: number }>> {
    const tokenHash = this.hashToken(groupCode);
    const result = await this.db.run(
      `SELECT l.user_id,
              ST_Y(l.location::geometry) AS latitude,
              ST_X(l.location::geometry) AS longitude,
              ST_Distance(l.location, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) AS distance_meters
       FROM rider_current_locations l
       JOIN ride_rooms rr ON rr.id = l.room_id
       WHERE rr.token_hash = $1 AND rr.status = 'active'
         AND ST_DWithin(l.location, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4)
       ORDER BY distance_meters`,
      [tokenHash, longitude, latitude, radiusMeters]
    );
    return result.rows.map((row: any) => ({
      userId: row.user_id,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      distanceMeters: Number(row.distance_meters),
    }));
  }
}
