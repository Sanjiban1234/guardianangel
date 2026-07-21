import crypto from 'crypto';
import { QueryRunner } from '../db/QueryRunner';

export interface LastKnownLocation {
  latitude: number;
  longitude: number;
  device_timestamp: number;
}

export class PresenceService {
  constructor(private readonly db: QueryRunner) {}

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token.toUpperCase()).digest('hex');
  }

  async getLastKnownLocation(userId: string, groupCode: string): Promise<LastKnownLocation | null> {
    try {
      const tokenHash = this.hashToken(groupCode);
      const result = await this.db.run(
        `SELECT ST_Y(rcl.location::geometry) AS latitude,
                ST_X(rcl.location::geometry) AS longitude,
                rcl.device_timestamp_ms AS device_timestamp
         FROM rider_current_locations rcl
         JOIN ride_rooms rr ON rr.id = rcl.room_id
         WHERE rcl.user_id = $1 AND rr.token_hash = $2`,
        [userId, tokenHash]
      );

      if (result.rows.length === 0) return null;

      const row = result.rows[0];
      return {
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        device_timestamp: Number(row.device_timestamp),
      };
    } catch (err) {
      console.error('PresenceService.getLastKnownLocation: query failed:', err);
      return null;
    }
  }
}
