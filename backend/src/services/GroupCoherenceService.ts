import crypto from 'crypto';
import { QueryRunner } from '../db/QueryRunner';
import type { GroupSeparationAlertPayload, GroupReunitedPayload } from '@guardian-angel/contracts/websocket-events';

export interface RiderLocation {
  user_id: string;
  name: string;
  latitude: number;
  longitude: number;
  speed: number;
  timestamp: number;
}

export interface CoherenceEvaluationResult {
  alerts: GroupSeparationAlertPayload[];
  reunions: GroupReunitedPayload[];
}

export interface CoherenceConfig {
  separationDistanceMeters: number;
  separationDurationMs: number;
  reunionDistanceMeters: number;
  reunionDurationMs: number;
  cooldownMs: number;
}

const DEFAULT_CONFIG: CoherenceConfig = {
  separationDistanceMeters: 500,
  separationDurationMs: 30_000,
  reunionDistanceMeters: 300,
  reunionDurationMs: 15_000,
  cooldownMs: 30_000,
};

interface RiderState {
  firstSeparatedAt: number | null;
  lastAlertEmittedAt: number | null;
  isSeparated: boolean;
  reunionPendingSince: number | null;
}

export class GroupCoherenceService {
  private readonly config: CoherenceConfig;

  // In-memory state keyed by "groupCode:userId"
  private readonly riderStates = new Map<string, RiderState>();

  constructor(
    private readonly db: QueryRunner,
    configPartial?: Partial<CoherenceConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...configPartial };
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token.toUpperCase()).digest('hex');
  }

  /**
   * Pure function: Haversine distance in meters between two lat/lng points.
   */
  public calculateHaversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371000; // Earth radius in meters
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Pure function: Calculates safe speed recommendations for separated rider and group.
   * Safety caps:
   *  - Separated rider max increase: +15% and capped at +4.17 m/s (+15 km/h).
   *  - Group max decrease: -20% and capped at -4.17 m/s (-15 km/h).
   *  - Low speed guard: if speed <= 1.4 m/s (5 km/h), return null for that side.
   */
  public calculateSpeedRecommendations(
    separatedSpeed: number,
    separatedDistToMidpoint: number,
    groupSpeed: number,
    groupDistToMidpoint: number
  ): {
    separatedRecommendedSpeed: number | null;
    groupRecommendedSpeed: number | null;
  } {
    const LOW_SPEED_THRESHOLD = 1.4; // ~5 km/h
    const MAX_DELTA_MPS = 4.17; // 15 km/h

    let separatedRecommendedSpeed: number | null = null;
    let groupRecommendedSpeed: number | null = null;

    const totalDist = separatedDistToMidpoint + groupDistToMidpoint;
    const totalSpeed = Math.max(separatedSpeed + groupSpeed, 0.1);
    const timeTarget = totalDist / totalSpeed;

    if (separatedSpeed > LOW_SPEED_THRESHOLD && timeTarget > 0) {
      const rawTarget = separatedDistToMidpoint / timeTarget;
      const pctCap = separatedSpeed * 1.15;
      const absCap = separatedSpeed + MAX_DELTA_MPS;
      const maxAllowed = Math.min(pctCap, absCap);
      separatedRecommendedSpeed = Math.max(separatedSpeed, Math.min(rawTarget, maxAllowed));
      separatedRecommendedSpeed = Math.round(separatedRecommendedSpeed * 100) / 100;
    }

    if (groupSpeed > LOW_SPEED_THRESHOLD && timeTarget > 0) {
      const rawTarget = groupDistToMidpoint / timeTarget;
      const pctCap = groupSpeed * 0.80;
      const absCap = groupSpeed - MAX_DELTA_MPS;
      const minAllowed = Math.max(pctCap, absCap);
      groupRecommendedSpeed = Math.min(groupSpeed, Math.max(rawTarget, minAllowed));
      groupRecommendedSpeed = Math.round(groupRecommendedSpeed * 100) / 100;
    }

    return { separatedRecommendedSpeed, groupRecommendedSpeed };
  }

  /**
   * Main evaluation method called on telemetry updates for a ride room.
   */
  public async evaluateRoomCoherence(
    groupCode: string,
    now: number = Date.now()
  ): Promise<CoherenceEvaluationResult> {
    const alerts: GroupSeparationAlertPayload[] = [];
    const reunions: GroupReunitedPayload[] = [];

    try {
      const tokenHash = this.hashToken(groupCode);
      const result = await this.db.run(
        `SELECT rcl.user_id,
                u.name,
                ST_Y(rcl.location::geometry) AS latitude,
                ST_X(rcl.location::geometry) AS longitude,
                rcl.speed,
                rcl.device_timestamp_ms AS timestamp,
                EXISTS (
                  SELECT 1 FROM vehicle_breakdowns vb
                  WHERE vb.room_id = rcl.room_id
                    AND vb.user_id = rcl.user_id
                    AND vb.resolved_at IS NULL
                ) AS has_active_breakdown
         FROM rider_current_locations rcl
         JOIN ride_rooms rr ON rr.id = rcl.room_id
         JOIN users u ON u.id = rcl.user_id
         WHERE rr.token_hash = $1 AND rr.status = 'active'`,
        [tokenHash]
      );

      const riders: (RiderLocation & { has_active_breakdown?: boolean })[] =
        result.rows.map((row) => ({
          user_id: row.user_id,
          name: row.name,
          latitude: Number(row.latitude),
          longitude: Number(row.longitude),
          speed: Number(row.speed),
          timestamp: Number(row.timestamp),
          has_active_breakdown: Boolean(row.has_active_breakdown),
        }));

      if (riders.length < 2) {
        return { alerts, reunions };
      }

      for (let i = 0; i < riders.length; i++) {
        const rider = riders[i];
        const stateKey = `${groupCode}:${rider.user_id}`;

        if (!this.riderStates.has(stateKey)) {
          this.riderStates.set(stateKey, {
            firstSeparatedAt: null,
            lastAlertEmittedAt: null,
            isSeparated: false,
            reunionPendingSince: null,
          });
        }
        const state = this.riderStates.get(stateKey)!;

        // Calculate distance to all other riders
        const otherRiders = riders.filter((_, idx) => idx !== i);
        let minDistanceMeters = Infinity;
        let nearestOtherRider: (RiderLocation & { has_active_breakdown?: boolean }) | null = null;

        for (const other of otherRiders) {
          const dist = this.calculateHaversineDistance(
            rider.latitude,
            rider.longitude,
            other.latitude,
            other.longitude
          );
          if (dist < minDistanceMeters) {
            minDistanceMeters = dist;
            nearestOtherRider = other;
          }
        }

        // Calculate group centroid for the rest of the group
        const groupLatSum = otherRiders.reduce((acc, r) => acc + r.latitude, 0);
        const groupLngSum = otherRiders.reduce((acc, r) => acc + r.longitude, 0);
        const groupSpeedSum = otherRiders.reduce((acc, r) => acc + r.speed, 0);
        const groupCentroidLat = groupLatSum / otherRiders.length;
        const groupCentroidLng = groupLngSum / otherRiders.length;
        const groupAvgSpeed = groupSpeedSum / otherRiders.length;

        // Check separation condition (> threshold distance)
        if (minDistanceMeters > this.config.separationDistanceMeters) {
          state.reunionPendingSince = null;

          if (state.firstSeparatedAt === null) {
            state.firstSeparatedAt = now;
          }

          const separationDuration = now - state.firstSeparatedAt;
          if (separationDuration >= this.config.separationDurationMs) {
            state.isSeparated = true;

            // Check cooldown before re-broadcasting alert
            const canEmit =
              state.lastAlertEmittedAt === null ||
              now - state.lastAlertEmittedAt >= this.config.cooldownMs;

            if (canEmit) {
              // Suppress generic separation alert if rider or nearest neighbor has an active vehicle breakdown reported
              if (rider.has_active_breakdown || nearestOtherRider?.has_active_breakdown) {
                continue;
              }

              state.lastAlertEmittedAt = now;

              // Meeting point: straight-line midpoint between separated rider and group centroid
              const midpointLat = (rider.latitude + groupCentroidLat) / 2;
              const midpointLng = (rider.longitude + groupCentroidLng) / 2;

              const separatedDistToMidpoint = this.calculateHaversineDistance(
                rider.latitude,
                rider.longitude,
                midpointLat,
                midpointLng
              );
              const groupDistToMidpoint = this.calculateHaversineDistance(
                groupCentroidLat,
                groupCentroidLng,
                midpointLat,
                midpointLng
              );

              const { separatedRecommendedSpeed, groupRecommendedSpeed } =
                this.calculateSpeedRecommendations(
                  rider.speed,
                  separatedDistToMidpoint,
                  groupAvgSpeed,
                  groupDistToMidpoint
                );

              alerts.push({
                separated_rider: {
                  user_id: rider.user_id,
                  name: rider.name,
                  current_speed: rider.speed,
                  recommended_speed: separatedRecommendedSpeed,
                  distance_from_nearest_meters: Math.round(minDistanceMeters * 10) / 10,
                },
                meeting_point: {
                  latitude: midpointLat,
                  longitude: midpointLng,
                  is_approximate: true,
                },
                group_recommendation: {
                  recommended_speed: groupRecommendedSpeed,
                },
                timestamp: now,
              });
            }
          }
        }
        // Check reunion condition (<= reunion threshold distance)
        else if (minDistanceMeters <= this.config.reunionDistanceMeters && state.isSeparated) {
          if (state.reunionPendingSince === null) {
            state.reunionPendingSince = now;
          }

          const reunionDuration = now - state.reunionPendingSince;
          if (reunionDuration >= this.config.reunionDurationMs) {
            state.isSeparated = false;
            state.firstSeparatedAt = null;
            state.lastAlertEmittedAt = null;
            state.reunionPendingSince = null;

            reunions.push({
              user_id: rider.user_id,
              name: rider.name,
              timestamp: now,
            });
          }
        }
        // In-between zone (300m < dist <= 500m)
        else {
          if (!state.isSeparated) {
            state.firstSeparatedAt = null;
          }
          state.reunionPendingSince = null;
        }
      }
    } catch (err) {
      console.error('GroupCoherenceService.evaluateRoomCoherence error:', err);
    }

    return { alerts, reunions };
  }

  /**
   * Helper to clear memory state for testing or room cleanup.
   */
  public clearState(groupCode?: string): void {
    if (groupCode) {
      for (const key of this.riderStates.keys()) {
        if (key.startsWith(`${groupCode}:`)) {
          this.riderStates.delete(key);
        }
      }
    } else {
      this.riderStates.clear();
    }
  }
}
