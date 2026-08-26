import crypto from 'crypto';
import { QueryRunner } from '../db/QueryRunner';
import { logger } from '../utils/logger';

export interface LastKnownLocation {
  latitude: number;
  longitude: number;
  device_timestamp: number;
}

export const RIDER_LOCATION_FRESHNESS_MS = 15_000;
export type RiderConnectionState = 'CONNECTED' | 'DISCONNECTED';
export type RiderLocationFreshness = 'FRESH' | 'STALE';

export interface RiderPresence {
  user_id: string;
  name: string;
  role: string;
  vehicle_model?: string;
  plate_number?: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  speed?: number;
  device_timestamp?: number;
  last_updated_at?: number;
  connection_state: RiderConnectionState;
  location_freshness: RiderLocationFreshness;
  has_active_breakdown?: boolean;
}

export class PresenceService {
  // Socket.IO presence is deliberately independent of persistent membership.
  private readonly socketsByGroup = new Map<string, Map<string, Set<string>>>();

  constructor(private readonly db: QueryRunner) {}

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token.toUpperCase()).digest('hex');
  }

  markConnected(groupCode: string, userId: string, socketId: string): void {
    const group = this.socketsByGroup.get(groupCode) ?? new Map<string, Set<string>>();
    const sockets = group.get(userId) ?? new Set<string>();
    sockets.add(socketId);
    group.set(userId, sockets);
    this.socketsByGroup.set(groupCode, group);
  }

  markDisconnected(groupCode: string, userId: string, socketId: string): void {
    const group = this.socketsByGroup.get(groupCode);
    const sockets = group?.get(userId);
    if (!group || !sockets) return;
    sockets.delete(socketId);
    if (sockets.size === 0) group.delete(userId);
    if (group.size === 0) this.socketsByGroup.delete(groupCode);
  }

  markLeft(groupCode: string, userId: string, socketId: string): void {
    this.markDisconnected(groupCode, userId, socketId);
  }

  private isConnected(groupCode: string, userId: string): boolean {
    const group = this.socketsByGroup.get(groupCode);
    // Coherence only runs after session:join in production. The fallback keeps
    // isolated service tests usable without manufacturing socket identities.
    if (!group) return true;
    return (group.get(userId)?.size ?? 0) > 0;
  }

  classifyLocation(lastUpdatedAt: number | undefined, now: number): RiderLocationFreshness {
    return typeof lastUpdatedAt === 'number' && now - lastUpdatedAt <= RIDER_LOCATION_FRESHNESS_MS
      ? 'FRESH'
      : 'STALE';
  }

  async getRiderPresence(groupCode: string, now: number = Date.now()): Promise<RiderPresence[]> {
    const tokenHash = this.hashToken(groupCode);
    const result = await this.db.run(
      `SELECT rm.user_id, u.name, rm.role, u.vehicle_model, u.plate_number,
              ST_Y(rcl.location::geometry) AS latitude,
              ST_X(rcl.location::geometry) AS longitude,
              rcl.accuracy, rcl.speed, rcl.device_timestamp_ms AS device_timestamp,
              EXTRACT(EPOCH FROM tr.received_at) * 1000 AS last_updated_at,
              EXISTS (SELECT 1 FROM vehicle_breakdowns vb
                WHERE vb.room_id = rr.id AND vb.user_id = rm.user_id AND vb.resolved_at IS NULL) AS has_active_breakdown
       FROM ride_rooms rr
       JOIN room_members rm ON rm.room_id = rr.id
       JOIN users u ON u.id = rm.user_id
       LEFT JOIN rider_current_locations rcl ON rcl.room_id = rr.id AND rcl.user_id = rm.user_id
       LEFT JOIN telemetry_readings tr ON tr.room_id = rcl.room_id AND tr.user_id = rcl.user_id
         AND tr.device_timestamp_ms = rcl.device_timestamp_ms
       WHERE rr.token_hash = $1 AND rr.status = 'active'`,
      [tokenHash],
    );
    return result.rows.map((row) => {
      // `timestamp` is retained as a test/legacy-query fallback. Production
      // rows use telemetry_readings.received_at, the server acceptance clock.
      const lastUpdatedAt = row.last_updated_at != null ? Number(row.last_updated_at)
        : row.timestamp != null ? Number(row.timestamp) : undefined;
      return {
        user_id: row.user_id,
        name: row.name,
        role: row.role,
        vehicle_model: row.vehicle_model || undefined,
        plate_number: row.plate_number || undefined,
        latitude: row.latitude == null ? undefined : Number(row.latitude),
        longitude: row.longitude == null ? undefined : Number(row.longitude),
        accuracy: row.accuracy == null ? undefined : Number(row.accuracy),
        speed: row.speed == null ? undefined : Number(row.speed),
        device_timestamp: row.device_timestamp == null ? undefined : Number(row.device_timestamp),
        last_updated_at: lastUpdatedAt,
        connection_state: this.isConnected(groupCode, row.user_id) ? 'CONNECTED' : 'DISCONNECTED',
        location_freshness: this.classifyLocation(lastUpdatedAt, now),
        has_active_breakdown: Boolean(row.has_active_breakdown),
      };
    });
  }

  async getLastKnownLocation(userId: string, groupCode: string): Promise<LastKnownLocation | null> {
    try {
      const tokenHash = this.hashToken(groupCode);
      const result = await this.db.run(
        `SELECT ST_Y(rcl.location::geometry) AS latitude,
                ST_X(rcl.location::geometry) AS longitude,
                rcl.device_timestamp_ms AS device_timestamp,
                EXTRACT(EPOCH FROM tr.received_at) * 1000 AS last_updated_at
         FROM rider_current_locations rcl
         JOIN ride_rooms rr ON rr.id = rcl.room_id
         JOIN telemetry_readings tr ON tr.room_id = rcl.room_id AND tr.user_id = rcl.user_id
           AND tr.device_timestamp_ms = rcl.device_timestamp_ms
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
      logger.error('last known location query failed', err);
      return null;
    }
  }
}
