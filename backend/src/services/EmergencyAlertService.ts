import { QueryRunner } from '../db/QueryRunner';

export interface EmergencyAlert {
  id: string;
  room_id: string;
  user_id: string;
  timestamp: number;
  status: string;
  latitude: number;
  longitude: number;
}

/**
 * EmergencyAlertService — owns SOS alert persistence.
 *
 * Completely isolated from TelemetryService and PresenceService.
 * If the DB insert fails, it throws — the caller (CrashHandler) catches
 * and handles the error without affecting any other socket handler.
 */
export class EmergencyAlertService {
  constructor(private readonly db: QueryRunner) {}

  /**
   * Persist a confirmed crash / SOS alert and return the full record.
   * Throws on DB failure so the caller can decide whether to broadcast.
   */
  async createAlert(
    roomId: string,
    userId: string,
    timestamp: number,
    latitude: number,
    longitude: number
  ): Promise<EmergencyAlert> {
    const result = await this.db.run(
      `INSERT INTO emergency_alerts (room_id, user_id, timestamp, status, latitude, longitude)
       VALUES ($1, $2, $3, 'active', $4, $5)
       RETURNING id`,
      [roomId, userId, timestamp, latitude, longitude]
    );

    return {
      id: result.rows[0].id,
      room_id: roomId,
      user_id: userId,
      timestamp,
      status: 'active',
      latitude,
      longitude,
    };
  }
}
