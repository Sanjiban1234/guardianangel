import crypto from 'crypto';
import { QueryRunner } from '../db/QueryRunner';

export interface TelemetryReading {
  timestamp: number;
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number;
}

export interface BulkTelemetryReading extends TelemetryReading {
  client_reading_id: string;
}

export class TelemetryService {
  constructor(private readonly db: QueryRunner) {}

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token.toUpperCase()).digest('hex');
  }

  async saveTelemetry(
    groupCode: string,
    userId: string,
    reading: TelemetryReading
  ): Promise<boolean> {
    const tokenHash = this.hashToken(groupCode);
    try {
      await this.db.run(
        `INSERT INTO telemetry_readings
           (room_id, user_id, device_timestamp_ms, location, accuracy, speed, client_reading_id)
         VALUES (
           (SELECT id FROM ride_rooms WHERE token_hash = $1 AND status = 'active' LIMIT 1),
           $2::uuid, $3,
           ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
           $6, $7, gen_random_uuid()
         )
         ON CONFLICT (room_id, user_id, device_timestamp_ms) DO UPDATE SET
           location = EXCLUDED.location,
           accuracy = EXCLUDED.accuracy,
           speed = EXCLUDED.speed`,
        [tokenHash, userId, reading.timestamp, reading.longitude, reading.latitude,
          reading.accuracy, reading.speed]
      );
      return true;
    } catch (err) {
      console.error('TelemetryService.saveTelemetry: DB write failed:', err);
      return false;
    }
  }

  async bulkSyncTelemetry(
    groupCode: string,
    userId: string,
    readings: BulkTelemetryReading[]
  ): Promise<string[]> {
    if (readings.length === 0) return [];

    const tokenHash = this.hashToken(groupCode);
    try {
      const result = await this.db.run(
        `INSERT INTO telemetry_readings
           (room_id, user_id, device_timestamp_ms, location, accuracy, speed, client_reading_id)
         SELECT
           (SELECT id FROM ride_rooms WHERE token_hash = $1 AND status = 'active' LIMIT 1),
           $2::uuid,
           r.timestamp_ms,
           ST_SetSRID(ST_MakePoint(r.longitude, r.latitude), 4326)::geography,
           r.accuracy,
           r.speed,
           r.client_reading_id
         FROM jsonb_to_recordset($3::jsonb) AS r(
           client_reading_id uuid,
           timestamp_ms bigint,
           latitude double precision,
           longitude double precision,
           accuracy real,
           speed real
         )
         ON CONFLICT (user_id, client_reading_id) DO NOTHING
         RETURNING client_reading_id`,
        [tokenHash, userId, JSON.stringify(readings.map((r) => ({
          client_reading_id: r.client_reading_id,
          timestamp_ms: r.timestamp,
          latitude: r.latitude,
          longitude: r.longitude,
          accuracy: r.accuracy,
          speed: r.speed,
        })))]
      );
      return result.rows.map((row: any) => row.client_reading_id);
    } catch (err) {
      console.error('TelemetryService.bulkSyncTelemetry: DB write failed:', err);
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
