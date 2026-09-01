/**
 * @file RideMetricsAccumulator.ts
 * @description Single-source-of-truth for live ride statistics.
 *
 * This module is intentionally independent of React so it can be unit-tested
 * without a render environment.  It accumulates GPS readings in the same way
 * the Post-Ride Summary would interpret them, ensuring live and post-ride
 * metrics do not fundamentally disagree.
 *
 * SINGLE-SOURCE-OF-TRUTH RULES
 * ─────────────────────────────
 * • STOP_THRESHOLD_MS  — ≤1.0 m/s → rider is considered stopped.
 *   Post-ride summary must use the same value when stop time is added there.
 * • OUTLIER_SPEED_MS   — ≥ 80 m/s (~288 km/h) → reading excluded from avg/max.
 *   Post-ride summary spike flag should use the same floor.
 * • Distance is computed via the Haversine formula on the device.
 *   The backend uses PostGIS ST_Length on a LineString; a small disagreement
 *   (<1%) between the two is expected and acceptable — PostGIS is authoritative
 *   for the final summary.
 */

/** Speed at or below which the rider is considered stopped (m/s). */
export const STOP_THRESHOLD_MS = 1.0;

/** GPS-reported speed above this value (m/s) is treated as an outlier and
 *  excluded from average-moving-speed and max-speed calculations. */
export const OUTLIER_SPEED_MS = 80.0;

/** Minimum GPS accuracy (metres) a reading must have to contribute to
 *  distance and speed calculations.  Readings with accuracy > this value
 *  are still recorded for duration purposes but skipped for distance/speed. */
export const MAX_ACCEPTABLE_ACCURACY_M = 50;

export interface MetricsSnapshot {
  /** Wall-clock duration since ride start (ms). */
  durationMs: number;
  /** Accumulated haversine distance (metres). */
  distanceMeters: number;
  /**
   * Current speed in m/s from the latest GPS fix.
   * null = no valid reading yet or last reading had null speed.
   */
  currentSpeedMs: number | null;
  /**
   * Average speed only during moving intervals (excludes stop periods and
   * outlier readings).  null when no valid moving readings have been seen.
   */
  avgMovingSpeedMs: number | null;
  /**
   * Highest non-outlier speed observed so far.
   * null when no valid speed readings have been seen.
   */
  maxSpeedMs: number | null;
  /** Total time (ms) during which the rider was considered stopped. */
  stoppedTimeMs: number;
  /** Number of GPS readings processed. */
  readingCount: number;
}

interface AccumulatedReading {
  timestamp: number;
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null;
}

/**
 * Calculates the haversine great-circle distance between two GPS coordinates.
 * Returns distance in metres.
 */
export function haversineMeters(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 6_371_000; // Earth radius in metres
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Accumulates GPS telemetry readings and derives live ride statistics.
 *
 * Usage:
 *   const acc = new RideMetricsAccumulator(Date.now());
 *   acc.addReading({ timestamp, latitude, longitude, accuracy, speed });
 *   const snap = acc.snapshot();
 */
export class RideMetricsAccumulator {
  private readonly rideStartMs: number;
  private readings: AccumulatedReading[] = [];
  private totalDistanceMeters = 0;
  private movingSpeedSum = 0;
  private movingSpeedCount = 0;
  private maxSpeedMs: number | null = null;
  private stoppedTimeMs = 0;
  private lastTimestamp: number | null = null;

  constructor(rideStartMs: number) {
    this.rideStartMs = rideStartMs;
  }

  /**
   * Add a new GPS reading from TelemetryModule.
   * Readings with accuracy worse than MAX_ACCEPTABLE_ACCURACY_M are accepted
   * for duration/timing but excluded from distance and speed calculations.
   */
  addReading(reading: {
    timestamp: number;
    latitude: number;
    longitude: number;
    accuracy: number;
    speed: number | null;
  }): void {
    const prev = this.readings.length > 0
      ? this.readings[this.readings.length - 1]
      : null;

    const goodAccuracy = reading.accuracy <= MAX_ACCEPTABLE_ACCURACY_M;

    // ── Distance accumulation ─────────────────────────────────────────────
    if (prev && goodAccuracy) {
      const prevGoodAccuracy = prev.accuracy <= MAX_ACCEPTABLE_ACCURACY_M;
      if (prevGoodAccuracy) {
        const d = haversineMeters(
          prev.latitude, prev.longitude,
          reading.latitude, reading.longitude,
        );
        // Sanity check: >5000 m between consecutive readings is a GPS
        // teleport jump — skip the distance contribution but keep the reading.
        if (d < 5000) {
          this.totalDistanceMeters += d;
        }
      }
    }

    // ── Speed accounting ──────────────────────────────────────────────────
    const rawSpeed = reading.speed;
    const speedValid =
      rawSpeed !== null &&
      rawSpeed >= 0 &&
      rawSpeed < OUTLIER_SPEED_MS &&
      goodAccuracy;

    if (speedValid && rawSpeed !== null) {
      // Max speed (non-outlier)
      if (this.maxSpeedMs === null || rawSpeed > this.maxSpeedMs) {
        this.maxSpeedMs = rawSpeed;
      }

      // Moving average (exclude stopped periods)
      if (rawSpeed > STOP_THRESHOLD_MS) {
        this.movingSpeedSum += rawSpeed;
        this.movingSpeedCount++;
      }
    }

    // ── Stopped time accounting ───────────────────────────────────────────
    if (prev && this.lastTimestamp !== null) {
      const intervalMs = reading.timestamp - this.lastTimestamp;
      // Only accumulate stop time when interval is plausible (< 60 s gap)
      if (intervalMs > 0 && intervalMs < 60_000) {
        const prevSpeed = prev.speed;
        const isStopped =
          prevSpeed === null ||
          prevSpeed <= STOP_THRESHOLD_MS;
        if (isStopped) {
          this.stoppedTimeMs += intervalMs;
        }
      }
    }

    this.lastTimestamp = reading.timestamp;
    this.readings.push(reading);
  }

  /**
   * Returns the latest non-null speed from the most recent reading.
   * Returns null if no reading with a valid speed has been seen.
   */
  private currentSpeed(): number | null {
    for (let i = this.readings.length - 1; i >= 0; i--) {
      const r = this.readings[i];
      if (
        r.speed !== null &&
        r.speed >= 0 &&
        r.speed < OUTLIER_SPEED_MS
      ) {
        return r.speed;
      }
    }
    return null;
  }

  /** Returns a snapshot of all live statistics derived so far. */
  snapshot(): MetricsSnapshot {
    const now = Date.now();
    return {
      durationMs: now - this.rideStartMs,
      distanceMeters: this.totalDistanceMeters,
      currentSpeedMs: this.currentSpeed(),
      avgMovingSpeedMs:
        this.movingSpeedCount > 0
          ? this.movingSpeedSum / this.movingSpeedCount
          : null,
      maxSpeedMs: this.maxSpeedMs,
      stoppedTimeMs: this.stoppedTimeMs,
      readingCount: this.readings.length,
    };
  }

  /** Resets all accumulated state (call on ride end). */
  reset(): void {
    this.readings = [];
    this.totalDistanceMeters = 0;
    this.movingSpeedSum = 0;
    this.movingSpeedCount = 0;
    this.maxSpeedMs = null;
    this.stoppedTimeMs = 0;
    this.lastTimestamp = null;
  }

  /** Number of GPS readings processed so far. */
  get readingCount(): number {
    return this.readings.length;
  }

  /** Returns the most recently processed reading, or null if none yet. */
  get lastReading(): AccumulatedReading | null {
    return this.readings.length > 0
      ? this.readings[this.readings.length - 1]
      : null;
  }
}
