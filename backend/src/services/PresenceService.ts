import { QueryRunner } from '../db/QueryRunner';

export interface LastKnownLocation {
  latitude: number;
  longitude: number;
  device_timestamp: number;
}

/**
 * PresenceService — owns last-known-location lookup used on disconnect.
 *
 * Completely isolated: a DB failure here returns null and the caller
 * broadcasts with zeroed coordinates rather than crashing the disconnect
 * handler or affecting any other service.
 */
export class PresenceService {
  constructor(private readonly db: QueryRunner) {}

  /**
   * Retrieve the most recent telemetry reading for a user.
   * Returns null if no data exists or the query fails.
   */
  async getLastKnownLocation(userId: string): Promise<LastKnownLocation | null> {
    try {
      const result = await this.db.run(
        `SELECT latitude, longitude, device_timestamp
         FROM telemetry_readings
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
