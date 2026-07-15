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

/**
 * TelemetryService — owns all telemetry persistence logic.
 *
 * Each method:
 *  - Tries a PostGIS-aware INSERT first (with geometry column).
 *  - Falls back to a plain INSERT if PostGIS is unavailable.
 *  - Returns a boolean / string[] so callers never need to catch here.
 *
 * A failure in saveTelemetry() never affects bulkSyncTelemetry() and
 * vice-versa because they share no mutable state.
 */
export class TelemetryService {
  constructor(private readonly db: QueryRunner) {}

  /**
   * Persist a single live telemetry reading (State A — Online).
   * Returns true on success, false on failure.
   */
  async saveTelemetry(
    roomId: string,
    userId: string,
    reading: TelemetryReading
  ): Promise<boolean> {
    const params = [
      roomId, userId,
      reading.timestamp, reading.latitude, reading.longitude,
      reading.accuracy, reading.speed,
    ];

    try {
      await this.db.run(
        `INSERT INTO telemetry_readings
           (room_id, user_id, device_timestamp, latitude, longitude, accuracy, speed, geom)
         VALUES ($1, $2, $3, $4, $5, $6, $7, ST_SetSRID(ST_MakePoint($5, $4), 4326))
         ON CONFLICT (user_id, device_timestamp)
         DO UPDATE SET
           room_id = EXCLUDED.room_id,
           latitude = EXCLUDED.latitude,
           longitude = EXCLUDED.longitude,
           accuracy = EXCLUDED.accuracy,
           speed = EXCLUDED.speed,
           geom = EXCLUDED.geom`,
        params
      );
      return true;
    } catch {
      // PostGIS unavailable — retry without geometry column
      try {
        await this.db.run(
          `INSERT INTO telemetry_readings
             (room_id, user_id, device_timestamp, latitude, longitude, accuracy, speed)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (user_id, device_timestamp)
           DO UPDATE SET
             room_id = EXCLUDED.room_id,
             latitude = EXCLUDED.latitude,
             longitude = EXCLUDED.longitude,
             accuracy = EXCLUDED.accuracy,
             speed = EXCLUDED.speed`,
          params
        );
        return true;
      } catch (fallbackErr) {
        console.error('TelemetryService.saveTelemetry: DB write failed:', fallbackErr);
        return false;
      }
    }
  }

  /**
   * Bulk-sync cached readings (State B to State A catch-up).
   * Processes each reading independently — one row failure never aborts others.
   * Returns an array of client_reading_ids that were successfully persisted.
   */
  async bulkSyncTelemetry(
    roomId: string,
    userId: string,
    readings: BulkTelemetryReading[]
  ): Promise<string[]> {
    const confirmed: string[] = [];

    for (const reading of readings) {
      const params = [
        roomId, userId,
        reading.timestamp, reading.latitude, reading.longitude,
        reading.accuracy, reading.speed,
      ];

      let saved = false;

      try {
        await this.db.run(
          `INSERT INTO telemetry_readings
             (room_id, user_id, device_timestamp, latitude, longitude, accuracy, speed, geom)
           VALUES ($1, $2, $3, $4, $5, $6, $7, ST_SetSRID(ST_MakePoint($5, $4), 4326))
           ON CONFLICT (user_id, device_timestamp)
           DO UPDATE SET
             room_id = EXCLUDED.room_id,
             latitude = EXCLUDED.latitude,
             longitude = EXCLUDED.longitude,
             accuracy = EXCLUDED.accuracy,
             speed = EXCLUDED.speed,
             geom = EXCLUDED.geom`,
          params
        );
        saved = true;
      } catch {
        // Fallback without geometry
        try {
          await this.db.run(
            `INSERT INTO telemetry_readings
               (room_id, user_id, device_timestamp, latitude, longitude, accuracy, speed)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (user_id, device_timestamp)
             DO UPDATE SET
               room_id = EXCLUDED.room_id,
               latitude = EXCLUDED.latitude,
               longitude = EXCLUDED.longitude,
               accuracy = EXCLUDED.accuracy,
               speed = EXCLUDED.speed`,
            params
          );
          saved = true;
        } catch (fallbackErr) {
          console.error(
            `TelemetryService.bulkSync: failed for client_reading_id "${reading.client_reading_id}":`,
            fallbackErr
          );
        }
      }

      if (saved) {
        confirmed.push(reading.client_reading_id);
      }
    }

    return confirmed;
  }
}
