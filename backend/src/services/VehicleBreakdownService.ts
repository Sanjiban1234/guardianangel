import crypto from 'crypto';
import { QueryRunner } from '../db/QueryRunner';
import { FcmPushService } from './FcmPushService';
import type { VehicleBreakdownReason } from '@guardian-angel/contracts/websocket-events';

export interface BreakdownRecord {
  id: string;
  room_id: string | null;
  user_id: string;
  reason?: VehicleBreakdownReason;
  note?: string;
  latitude: number;
  longitude: number;
  reported_at: number;
  resolved_at: number | null;
}

export interface ResolveBreakdownResult {
  breakdown_id: string;
  user_id: string;
  resolved_at: number;
}

export class VehicleBreakdownService {
  constructor(
    private readonly db: QueryRunner,
    private readonly fcmPushService?: FcmPushService
  ) {}

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token.toUpperCase()).digest('hex');
  }

  /**
   * Helper to resolve active room ID from groupCode.
   */
  async resolveRoomId(groupCode: string): Promise<string | null> {
    const tokenHash = this.hashToken(groupCode);
    const res = await this.db.run(
      `SELECT id FROM ride_rooms WHERE token_hash = $1 AND status = 'active'`,
      [tokenHash]
    );
    return res.rows[0]?.id ?? null;
  }

  /**
   * Report a vehicle breakdown for a rider in an active ride room.
   */
  async reportBreakdown(
    groupCode: string,
    userId: string,
    userName: string,
    reason?: VehicleBreakdownReason,
    note?: string
  ): Promise<BreakdownRecord> {
    const roomId = await this.resolveRoomId(groupCode);
    if (!roomId) {
      throw new Error(`Active ride room not found for code ${groupCode}`);
    }

    // Validate reason enum if provided
    const validReasons: VehicleBreakdownReason[] = [
      'flat_tire',
      'mechanical_failure',
      'fuel',
      'other',
    ];
    if (reason && !validReasons.includes(reason)) {
      throw new Error(`Invalid breakdown reason: ${reason}`);
    }

    // Pull current location from rider_current_locations
    const locRes = await this.db.run(
      `SELECT ST_Y(location::geometry) as latitude,
              ST_X(location::geometry) as longitude
       FROM rider_current_locations
       WHERE room_id = $1 AND user_id = $2`,
      [roomId, userId]
    );

    if (locRes.rows.length === 0) {
      throw new Error(`No current location telemetry available for user ${userId}`);
    }

    const latitude = Number(locRes.rows[0].latitude);
    const longitude = Number(locRes.rows[0].longitude);

    // Insert breakdown record
    const insertRes = await this.db.run(
      `INSERT INTO vehicle_breakdowns (room_id, user_id, reason, note, location)
       VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography)
       RETURNING id, room_id, user_id, reason, note,
                 ST_Y(location::geometry) as latitude,
                 ST_X(location::geometry) as longitude,
                 reported_at`,
      [roomId, userId, reason || null, note || null, longitude, latitude]
    );

    const row = insertRes.rows[0];
    const reportedAtMs = new Date(row.reported_at).getTime();

    const record: BreakdownRecord = {
      id: row.id,
      room_id: row.room_id,
      user_id: row.user_id,
      reason: row.reason || undefined,
      note: row.note || undefined,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      reported_at: reportedAtMs,
      resolved_at: null,
    };

    // Trigger FCM Push notification to other room members asynchronously
    if (this.fcmPushService) {
      try {
        const memberRes = await this.db.run(
          `SELECT user_id FROM room_members WHERE room_id = $1 AND user_id != $2`,
          [roomId, userId]
        );
        const otherUserIds = memberRes.rows.map((r) => r.user_id);
        if (otherUserIds.length > 0) {
          // Push notification send isolated call
          await this.fcmPushService.sendBreakdownPush(otherUserIds, {
            breakdown_id: record.id,
            user_id: userId,
            name: userName,
            reason: record.reason,
            note: record.note,
            latitude: record.latitude,
            longitude: record.longitude,
            reported_at: record.reported_at,
          });
        }
      } catch (err) {
        console.error('VehicleBreakdownService: failed fetching room members for FCM:', err);
      }
    }

    return record;
  }

  /**
   * Resolve an active vehicle breakdown.
   */
  async resolveBreakdown(
    groupCode: string,
    userId: string
  ): Promise<ResolveBreakdownResult> {
    const roomId = await this.resolveRoomId(groupCode);

    // Find and update active breakdown
    const res = await this.db.run(
      `UPDATE vehicle_breakdowns
       SET resolved_at = NOW()
       WHERE user_id = $1
         AND (room_id = $2 OR $2::uuid IS NULL)
         AND resolved_at IS NULL
       RETURNING id, user_id, resolved_at`,
      [userId, roomId]
    );

    if (res.rows.length > 0) {
      return {
        breakdown_id: res.rows[0].id,
        user_id: res.rows[0].user_id,
        resolved_at: new Date(res.rows[0].resolved_at).getTime(),
      };
    }

    // Fallback: look for latest breakdown for user
    const fallbackRes = await this.db.run(
      `SELECT id, user_id, resolved_at
       FROM vehicle_breakdowns
       WHERE user_id = $1
       ORDER BY reported_at DESC
       LIMIT 1`,
      [userId]
    );

    if (fallbackRes.rows.length === 0) {
      throw new Error(`No breakdown record found for user ${userId}`);
    }

    const fallbackRow = fallbackRes.rows[0];
    const resolvedAt = fallbackRow.resolved_at
      ? new Date(fallbackRow.resolved_at).getTime()
      : Date.now();

    return {
      breakdown_id: fallbackRow.id,
      user_id: fallbackRow.user_id,
      resolved_at: resolvedAt,
    };
  }

  /**
   * Check if a rider currently has an active breakdown.
   */
  async hasActiveBreakdown(userId: string, roomId: string): Promise<boolean> {
    const res = await this.db.run(
      `SELECT 1 FROM vehicle_breakdowns
       WHERE user_id = $1 AND room_id = $2 AND resolved_at IS NULL
       LIMIT 1`,
      [userId, roomId]
    );
    return res.rows.length > 0;
  }
}
