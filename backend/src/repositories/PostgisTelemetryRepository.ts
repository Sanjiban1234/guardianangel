import { Pool, PoolClient } from 'pg';

export interface TelemetryInput {
  clientReadingId: string;
  timestampMs: number;
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number;
}

export interface NearbyRider {
  userId: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
}

/**
 * Parameterized PostGIS queries using node-postgres (`pg`).
 * The caller owns authorization: verify room membership before calling writes
 * or exposing returned rider locations.
 */
export class PostgisTelemetryRepository {
  constructor(private readonly pool: Pool) {}

  async insertLiveReading(
    roomId: string,
    userId: string,
    reading: TelemetryInput
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO telemetry_readings
         (room_id, user_id, device_timestamp_ms, location, accuracy, speed, synced, client_reading_id)
       VALUES (
         $1, $2, $3,
         ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
         $6, $7, true, $8
       )
       ON CONFLICT (user_id, client_reading_id) DO NOTHING`,
      [roomId, userId, reading.timestampMs, reading.longitude, reading.latitude,
        reading.accuracy, reading.speed, reading.clientReadingId]
    );
  }

  /** A single INSERT ... SELECT makes the offline re-sync atomic and efficient. */
  async bulkInsert(
    roomId: string,
    userId: string,
    readings: TelemetryInput[]
  ): Promise<string[]> {
    if (readings.length === 0) return [];
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ client_reading_id: string }>(
        `INSERT INTO telemetry_readings
           (room_id, user_id, device_timestamp_ms, location, accuracy, speed, synced, client_reading_id)
         SELECT
           $1::uuid,
           $2::uuid,
           r.timestamp_ms,
           ST_SetSRID(ST_MakePoint(r.longitude, r.latitude), 4326)::geography,
           r.accuracy,
           r.speed,
           true,
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
        [roomId, userId, JSON.stringify(readings.map((r) => ({
          client_reading_id: r.clientReadingId,
          timestamp_ms: r.timestampMs,
          latitude: r.latitude,
          longitude: r.longitude,
          accuracy: r.accuracy,
          speed: r.speed,
        })))]
      );
      await client.query('COMMIT');
      return result.rows.map((row) => row.client_reading_id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async totalDistanceMeters(
    roomId: string, userId: string, fromTimestampMs: number, toTimestampMs: number
  ): Promise<number> {
    const result = await this.pool.query<{ distance_meters: number }>(
      `WITH track AS (
         SELECT device_timestamp_ms, location::geometry AS point
         FROM telemetry_readings
         WHERE room_id = $1 AND user_id = $2
           AND device_timestamp_ms BETWEEN $3 AND $4
         ORDER BY device_timestamp_ms
       )
       SELECT COALESCE(
         ST_Length(ST_MakeLine(point ORDER BY device_timestamp_ms)::geography), 0
       ) AS distance_meters
       FROM track`,
      [roomId, userId, fromTimestampMs, toTimestampMs]
    );
    return Number(result.rows[0]?.distance_meters ?? 0);
  }

  async rideDurationMs(roomId: string, userId: string): Promise<number> {
    const result = await this.pool.query<{ duration_ms: string }>(
      `SELECT COALESCE(
         MAX(device_timestamp_ms) - MIN(device_timestamp_ms), 0
       ) AS duration_ms
       FROM telemetry_readings
       WHERE room_id = $1 AND user_id = $2`,
      [roomId, userId]
    );
    return Number(result.rows[0]?.duration_ms ?? 0);
  }

  async activeGeofencesAt(latitude: number, longitude: number): Promise<Array<{ id: string; name: string; type: string }>> {
    const result = await this.pool.query<{ id: string; name: string; type: string }>(
      `SELECT id, name, type
       FROM geofences
       WHERE is_active
         AND ST_Covers(area, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)`,
      [longitude, latitude]
    );
    return result.rows;
  }

  async ridersWithinMeters(
    roomId: string, latitude: number, longitude: number, radiusMeters: number
  ): Promise<NearbyRider[]> {
    const result = await this.pool.query<{
      user_id: string; latitude: number; longitude: number; distance_meters: number;
    }>(
      `WITH point AS (
         SELECT ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography AS location
       )
       SELECT l.user_id,
              ST_Y(l.location::geometry) AS latitude,
              ST_X(l.location::geometry) AS longitude,
              ST_Distance(l.location, p.location) AS distance_meters
       FROM rider_current_locations l CROSS JOIN point p
       WHERE l.room_id = $1
         AND ST_DWithin(l.location, p.location, $4)
       ORDER BY distance_meters`,
      [roomId, longitude, latitude, radiusMeters]
    );
    return result.rows.map((row) => ({
      userId: row.user_id,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      distanceMeters: Number(row.distance_meters),
    }));
  }
}
