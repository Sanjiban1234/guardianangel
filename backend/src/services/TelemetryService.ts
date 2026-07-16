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

  async saveTelemetry(
    groupCode: string,
    userId: string,
    reading: TelemetryReading
  ): Promise<boolean> {
    const params = [
      userId, groupCode,
      reading.timestamp, reading.latitude, reading.longitude,
      reading.accuracy, reading.speed,
    ];

    try {
      await this.db.run(
        `INSERT INTO engine_heartbeat
           (user_id, group_code, device_timestamp, latitude, longitude, accuracy, speed, status_id, pulses, seconds, number_of_pulse)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'normal', 1, 0, 1)
         ON CONFLICT (user_id, device_timestamp)
         DO UPDATE SET
           group_code = EXCLUDED.group_code,
           latitude = EXCLUDED.latitude,
           longitude = EXCLUDED.longitude,
           accuracy = EXCLUDED.accuracy,
           speed = EXCLUDED.speed`,
        params
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
    const confirmed: string[] = [];

    for (const reading of readings) {
      const params = [
        userId, groupCode,
        reading.timestamp, reading.latitude, reading.longitude,
        reading.accuracy, reading.speed,
      ];

      try {
        await this.db.run(
          `INSERT INTO engine_heartbeat
             (user_id, group_code, device_timestamp, latitude, longitude, accuracy, speed, status_id, pulses, seconds, number_of_pulse)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'normal', 1, 0, 1)
           ON CONFLICT (user_id, device_timestamp)
           DO UPDATE SET
             group_code = EXCLUDED.group_code,
             latitude = EXCLUDED.latitude,
             longitude = EXCLUDED.longitude,
             accuracy = EXCLUDED.accuracy,
             speed = EXCLUDED.speed`,
          params
        );
        confirmed.push(reading.client_reading_id);
      } catch (err) {
        console.error(
          `TelemetryService.bulkSync: failed for client_reading_id "${reading.client_reading_id}":`,
          err
        );
      }
    }

    return confirmed;
  }
}
