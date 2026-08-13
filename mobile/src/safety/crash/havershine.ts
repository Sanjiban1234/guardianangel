export interface GpsPoint {
  latitude: number;
  longitude: number;
  timestamp: number;
}

const EARTH_RADIUS_M = 6371000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// Great-circle distance between two GPS points, in meters
export function haversineDistanceMeters(a: GpsPoint, b: GpsPoint): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_M * c;
}

// Derives speed (km/h) between two consecutive GPS fixes.
// Used as a cross-check / fallback when telemetry's own `speed` field
// is null or stale (common during violent post-impact motion).
export function derivedSpeedKmh(a: GpsPoint, b: GpsPoint): number | null {
  const dtSeconds = (b.timestamp - a.timestamp) / 1000;
  if (dtSeconds <= 0) return null;

  const distanceM = haversineDistanceMeters(a, b);
  const speedMs = distanceM / dtSeconds;
  return speedMs * 3.6; // m/s -> km/h
}