import { QueryRunner } from '../db/QueryRunner';

export interface EmergencyAlert {
  alarm_no: string;
  user_id: string;
  correlation_id: string;
  status: string;
  latitude: number;
  longitude: number;
  join_check_timestamp: string;
}

export class EmergencyAlertService {
  constructor(private readonly db: QueryRunner) {}

  async createAlert(
    groupCode: string,
    userId: string,
    timestamp: number,
    latitude: number,
    longitude: number
  ): Promise<EmergencyAlert> {
    const activeRider = await this.db.run(
      "SELECT id FROM active_riders WHERE group_code = $1 AND user_id = $2 AND status = 'active' LIMIT 1",
      [groupCode, userId]
    );

    const activeRiderId = activeRider.rows.length > 0 ? activeRider.rows[0].id : null;

    const result = await this.db.run(
      `INSERT INTO emergency_alarms (user_id, active_rider_id, latitude, longitude, expire, status)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 hour', 'active')
       RETURNING alarm_no, correlation_id, join_check_timestamp, status`,
      [userId, activeRiderId, latitude, longitude]
    );

    const row = result.rows[0];
    return {
      alarm_no: row.alarm_no,
      user_id: userId,
      correlation_id: row.correlation_id,
      status: row.status,
      latitude,
      longitude,
      join_check_timestamp: row.join_check_timestamp,
    };
  }

  async resolveAlert(alarmNo: string): Promise<void> {
    await this.db.run(
      "UPDATE emergency_alarms SET status = 'resolved' WHERE alarm_no = $1",
      [alarmNo]
    );
  }

  async getActiveAlerts(userId: string): Promise<EmergencyAlert[]> {
    const result = await this.db.run(
      "SELECT alarm_no, user_id, correlation_id, status, latitude, longitude, join_check_timestamp FROM emergency_alarms WHERE user_id = $1 AND status = 'active' ORDER BY created_at DESC",
      [userId]
    );
    return result.rows as EmergencyAlert[];
  }
}
