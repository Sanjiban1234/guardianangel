import { QueryRunner } from '../db/QueryRunner';

export interface LastKnownLocation {
  latitude: number;
  longitude: number;
  device_timestamp: number;
}

export class PresenceService {
  constructor(private readonly db: QueryRunner) {}

  async getLastKnownLocation(userId: string): Promise<LastKnownLocation | null> {
    try {
      const result = await this.db.run(
        `SELECT latitude, longitude, device_timestamp
         FROM engine_heartbeat
         WHERE user_id = $1
         ORDER BY device_timestamp DESC
         LIMIT 1`,
        [userId]
      );

      if (result.rows.length === 0) return null;

      const row = result.rows[0];
      return {
        latitude: parseFloat(row.latitude),
        longitude: parseFloat(row.longitude),
        device_timestamp: parseInt(row.device_timestamp, 10),
      };
    } catch (err) {
      console.error('PresenceService.getLastKnownLocation: query failed:', err);
      return null;
    }
  }
}
