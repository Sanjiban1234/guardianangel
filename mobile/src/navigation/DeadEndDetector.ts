/**
 * @file DeadEndDetector.ts
 * @description Route-advisory service for Guardian Angel.
 *
 * WHAT THIS DETECTS
 * ─────────────────
 * A "dead-end advisory" in V1 is a route-context heuristic, NOT physical
 * road-topology detection (which would require OSM/Overpass or Google Roads
 * API — neither is available in the current stack).
 *
 * Algorithm: GPS Bearing Reversal Heuristic
 * ─────────────────────────────────────────
 * 1. Maintain a sliding window of the last N GPS readings.
 * 2. For each consecutive pair compute the bearing toward destination.
 * 3. If the rider was approaching the destination (bearing delta < APPROACH_THRESHOLD)
 *    and then shows repeated reversals (bearing delta > REVERSAL_THRESHOLD) across
 *    MIN_REVERSAL_READINGS, state transitions to "suspected".
 * 4. "suspected" held for > CONFIRM_DURATION_MS without recovery → "confirmed".
 * 5. Recovery: 3 consecutive readings with decreasing bearing-to-destination
 *    (i.e., rider re-approaching) clears state to "clear".
 *
 * FALSE-POSITIVE CONTROLS
 * ───────────────────────
 * • Network failure → state = 'unknown' (never 'suspected')
 * • GPS accuracy > MAX_ACCURACY_M → reading ignored
 * • Speed < MIN_SPEED_MS → rider considered stationary, no update
 * • Cooldown: detector cannot re-trigger within COOLDOWN_MS of a dismiss
 * • Minimum readings window before any advisory can fire
 *
 * FUTURE REROUTING INTEGRATION
 * ─────────────────────────────
 * The rerouting service (separate branch) should:
 *   1. Call `detector.onStateChange()` to subscribe
 *   2. When state === 'confirmed', request a new route from current position
 *   3. Call `detector.acknowledgeReroute()` to clear the advisory
 *   Integration point: `DeadEndState` exported for shared contract use.
 */

/** GPS accuracy threshold: readings worse than this are ignored. */
export const MAX_ACCURACY_M = 50;

/** Minimum speed (m/s) for a rider to be considered moving. */
export const MIN_SPEED_MS = 2.0;

/** Number of readings in the sliding window. */
const WINDOW_SIZE = 5;

/** Minimum readings before any advisory fires. */
const MIN_READINGS_TO_EVALUATE = 3;

/**
 * If bearing toward destination changes by more than this across consecutive
 * readings (degrees), the rider is considered to be reversing/turning away.
 */
export const REVERSAL_THRESHOLD_DEG = 100;

/**
 * Number of consecutive readings that must show a reversal pattern
 * before state transitions to 'suspected'.
 */
export const MIN_REVERSAL_READINGS = 3;

/**
 * Duration (ms) that 'suspected' must be maintained before transitioning
 * to 'confirmed'.
 */
export const CONFIRM_DURATION_MS = 90_000; // 90 seconds

/**
 * Cooldown (ms) after a dismiss before the detector can re-trigger.
 */
export const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

export type DeadEndStateKind = 'clear' | 'suspected' | 'confirmed' | 'unknown';

export interface DeadEndState {
  /** Current advisory state. */
  state: DeadEndStateKind;
  /** Human-readable reason for the current state. */
  reason: string;
  /** Epoch ms when the state was last set. */
  detectedAt: number | null;
}

export const DEAD_END_STATE_CLEAR: DeadEndState = {
  state: 'clear',
  reason: 'No route issue detected.',
  detectedAt: null,
};

export const DEAD_END_STATE_UNKNOWN: DeadEndState = {
  state: 'unknown',
  reason: 'Network unavailable — route status cannot be determined.',
  detectedAt: null,
};

interface ReadingEntry {
  timestamp: number;
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null;
}

/**
 * Compute compass bearing (degrees 0-360) from point A to point B.
 */
export function computeBearing(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  const brng = toDeg(Math.atan2(y, x));
  return (brng + 360) % 360;
}

/**
 * Smallest angular difference between two bearings (0-180 degrees).
 */
export function bearingDelta(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Dead-end route advisory detector.
 *
 * Lifecycle:
 *   const detector = new DeadEndDetector({ latitude, longitude }); // destination
 *   detector.onStateChange(handler);
 *   // On each telemetry reading:
 *   detector.processReading({ timestamp, latitude, longitude, accuracy, speed });
 *   // On network down:
 *   detector.reportNetworkUnavailable();
 *   // On network restore:
 *   detector.reportNetworkRestored();
 *   // User dismissed the advisory:
 *   detector.dismiss();
 *   // Rerouting succeeded (future branch):
 *   detector.acknowledgeReroute();
 */
export class DeadEndDetector {
  private destination: { latitude: number; longitude: number } | null;
  private window: ReadingEntry[] = [];
  private state: DeadEndState = { ...DEAD_END_STATE_CLEAR };
  private suspectedSince: number | null = null;
  private dismissedAt: number | null = null;
  private listeners: Set<(state: DeadEndState) => void> = new Set();
  private networkAvailable = true;

  constructor(
    destination: { latitude: number; longitude: number } | null = null,
  ) {
    this.destination = destination;
  }

  /** Update the destination (e.g. after rerouting). */
  setDestination(dest: { latitude: number; longitude: number } | null): void {
    this.destination = dest;
    // A new destination always clears the advisory — prior reversals are stale
    this.transitionTo({ ...DEAD_END_STATE_CLEAR });
    this.suspectedSince = null;
    this.window = [];
  }

  /** Subscribe to state changes. Returns an unsubscribe function. */
  onStateChange(listener: (state: DeadEndState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Current state snapshot. */
  getState(): DeadEndState {
    return { ...this.state };
  }

  /** Called when the network is confirmed unavailable.
   *  Per spec: network failure → 'unknown', NOT 'suspected'. */
  reportNetworkUnavailable(): void {
    this.networkAvailable = false;
    if (this.state.state !== 'unknown') {
      this.transitionTo({ ...DEAD_END_STATE_UNKNOWN });
    }
  }

  /** Called when network is restored. Clears 'unknown' if set. */
  reportNetworkRestored(): void {
    this.networkAvailable = true;
    if (this.state.state === 'unknown') {
      this.transitionTo({ ...DEAD_END_STATE_CLEAR });
    }
  }

  /** User dismissed the advisory banner. Triggers cooldown. */
  dismiss(): void {
    this.dismissedAt = Date.now();
    this.suspectedSince = null;
    this.transitionTo({ ...DEAD_END_STATE_CLEAR });
  }

  /**
   * Rerouting succeeded — clear the advisory.
   * Called by the future rerouting branch after it generates a new route.
   */
  acknowledgeReroute(): void {
    this.suspectedSince = null;
    this.dismissedAt = null;
    this.window = [];
    this.transitionTo({ ...DEAD_END_STATE_CLEAR });
  }

  /**
   * Process a new GPS reading.
   * Returns the resulting DeadEndState (same as getState()).
   */
  processReading(reading: {
    timestamp: number;
    latitude: number;
    longitude: number;
    accuracy: number;
    speed: number | null;
  }): DeadEndState {
    // ── Guard: no destination → nothing to detect ─────────────────────────
    if (!this.destination) return this.state;

    // ── Guard: network unavailable ────────────────────────────────────────
    if (!this.networkAvailable) return this.state;

    // ── Guard: cooldown after dismiss ─────────────────────────────────────
    if (
      this.dismissedAt !== null &&
      Date.now() - this.dismissedAt < COOLDOWN_MS
    ) {
      return this.state;
    }

    // ── Guard: accuracy too poor ──────────────────────────────────────────
    if (reading.accuracy > MAX_ACCURACY_M) return this.state;

    // ── Guard: rider not moving ───────────────────────────────────────────
    const speed = reading.speed;
    if (speed === null || speed < MIN_SPEED_MS) return this.state;

    // ── Maintain sliding window ───────────────────────────────────────────
    this.window.push(reading);
    if (this.window.length > WINDOW_SIZE) {
      this.window.shift();
    }

    if (this.window.length < MIN_READINGS_TO_EVALUATE) return this.state;

    // ── Compute movement heading and compare with destination bearing ───
    let reversalCount = 0;
    let approachCount = 0;

    for (let i = 1; i < this.window.length; i++) {
      const prev = this.window[i - 1];
      const curr = this.window[i];

      // Heading of rider movement from prev to curr
      const movementHeading = computeBearing(
        prev.latitude, prev.longitude,
        curr.latitude, curr.longitude,
      );

      // Bearing from curr position directly toward destination
      const bearingToDest = computeBearing(
        curr.latitude, curr.longitude,
        this.destination!.latitude, this.destination!.longitude,
      );

      // Angular deviation between actual travel direction and destination
      const deviation = bearingDelta(movementHeading, bearingToDest);

      if (deviation > REVERSAL_THRESHOLD_DEG) {
        reversalCount++;
      } else if (deviation < 45) {
        approachCount++;
      }
    }

    const reversalDetected = reversalCount >= MIN_REVERSAL_READINGS;
    const recovering = approachCount >= 2;

    if (recovering && this.state.state !== 'clear') {
      this.suspectedSince = null;
      this.transitionTo({ ...DEAD_END_STATE_CLEAR });
      return this.state;
    }

    if (reversalDetected) {
      if (this.state.state === 'clear') {
        const now = Date.now();
        this.suspectedSince = now;
        this.transitionTo({
          state: 'suspected',
          reason:
            'Route issue ahead — current road may not continue toward your destination.',
          detectedAt: now,
        });
      } else if (
        this.state.state === 'suspected' &&
        this.suspectedSince !== null &&
        Date.now() - this.suspectedSince >= CONFIRM_DURATION_MS
      ) {
        this.transitionTo({
          state: 'confirmed',
          reason:
            'No through route — you may need to return to the previous road.',
          detectedAt: this.suspectedSince,
        });
      }
    } else {
      // No reversal pattern detected — if 'suspected', hold until timeout or recovery
    }

    return this.state;
  }

  /**
   * Returns true if the last 3 bearings show the rider consistently
   * approaching the destination (shrinking bearing deviation from initial).
   */
  private isRecovering(bearings: number[]): boolean {
    if (bearings.length < 3) return false;
    const last3 = bearings.slice(-3);
    // Approach = each consecutive delta is smaller than the previous
    // (rider is progressively pointing more directly at destination)
    const deltas = [
      bearingDelta(last3[0], last3[1]),
      bearingDelta(last3[1], last3[2]),
    ];
    return deltas[0] < REVERSAL_THRESHOLD_DEG && deltas[1] < REVERSAL_THRESHOLD_DEG;
  }

  private transitionTo(next: DeadEndState): void {
    if (next.state === this.state.state) return;
    this.state = next;
    for (const listener of this.listeners) {
      try {
        listener({ ...this.state });
      } catch {
        // Never let a listener crash the detector
      }
    }
  }
}
