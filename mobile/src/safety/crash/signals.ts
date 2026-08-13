// mobile/src/safety/crash/signals.ts
import { AccelerometerReading, GyroscopeReading, TelemetryReading } from './types';
import { derivedSpeedKmh, GpsPoint } from './havershine';

export function computeMagnitude(r: AccelerometerReading): number {
  return Math.sqrt(r.x * r.x + r.y * r.y + r.z * r.z);
}

// Jerk = rate of change of acceleration magnitude between two readings
export function computeJerk(prev: AccelerometerReading, curr: AccelerometerReading): number {
  const dt = (curr.timestamp - prev.timestamp) / 1000;
  if (dt <= 0) return 0;
  const dMag = computeMagnitude(curr) - computeMagnitude(prev);
  return Math.abs(dMag / dt);
}

// Peak angular velocity magnitude across a window, in deg/s
export function computeGyroRotation(readings: GyroscopeReading[]): number {
  let peak = 0;
  for (const r of readings) {
    const magRadPerSec = Math.sqrt(r.x * r.x + r.y * r.y + r.z * r.z);
    const magDegPerSec = magRadPerSec * (180 / Math.PI);
    if (magDegPerSec > peak) peak = magDegPerSec;
  }
  return peak;
}

// Resolves a speed value (km/h) for a given telemetry reading, falling back
// to Haversine-derived speed from GPS deltas when telemetry's own speed
// field is null/stale or disagrees beyond tolerance with the derived value.
export function resolveSpeedKmh(
  readings: TelemetryReading[],
  index: number,
  toleranceKmh: number
): number | null {
  const curr = readings[index];
  const telemetrySpeedKmh = curr.speed !== null ? curr.speed * 3.6 : null;

  if (index === 0) return telemetrySpeedKmh;

  const prev = readings[index - 1];
  const a: GpsPoint = { latitude: prev.latitude, longitude: prev.longitude, timestamp: prev.timestamp };
  const b: GpsPoint = { latitude: curr.latitude, longitude: curr.longitude, timestamp: curr.timestamp };
  const derived = derivedSpeedKmh(a, b);

  if (telemetrySpeedKmh === null) return derived;
  if (derived === null) return telemetrySpeedKmh;

  const disagreement = Math.abs(telemetrySpeedKmh - derived);
  if (disagreement > toleranceKmh) {
    // Conservative: trust whichever is higher, so a bad low reading
    // doesn't wrongly suppress a real candidate via the speed gate.
    return Math.max(telemetrySpeedKmh, derived);
  }
  return telemetrySpeedKmh;
}

// Roughness = total up-and-down movement in the speed trace, divided by
// the net displacement. ~1 = smooth monotonic change (braking).
// Much greater than 1 = jagged, oscillating trace (crash signature).
export function computeSpeedRoughness(speedSequenceKmh: number[]): number {
  if (speedSequenceKmh.length < 2) return 1;

  let pathLength = 0;
  for (let i = 1; i < speedSequenceKmh.length; i++) {
    pathLength += Math.abs(speedSequenceKmh[i] - speedSequenceKmh[i - 1]);
  }

  const netDisplacement = Math.abs(
    speedSequenceKmh[speedSequenceKmh.length - 1] - speedSequenceKmh[0]
  );

  if (netDisplacement === 0) {
    // No net change at all but lots of path length = pure oscillation
    return pathLength > 0 ? pathLength : 1;
  }

  return pathLength / netDisplacement;
}