/**
 * @file routeUtils.ts
 * @description Geographical math and route corridor deviation detection utilities.
 */

export interface LatLng {
  latitude: number;
  longitude: number;
}

export const DEVIATION_CONFIG = {
  /** Distance threshold in meters to consider rider outside route corridor */
  DEVIATION_THRESHOLD_METERS: 50,
  /** Number of consecutive location updates required to confirm sustained route deviation */
  REQUIRED_DEVIATION_SAMPLES: 3,
  /** Maximum GPS accuracy reading (in meters) allowed to trigger rerouting */
  MAX_GPS_ACCURACY_THRESHOLD_METERS: 30,
  /** Cooldown in milliseconds between reroute API requests */
  REROUTE_COOLDOWN_MS: 15_000,
};

/**
 * Calculate Haversine distance in meters between two lat/lng points.
 */
export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
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
 * Calculate minimum distance in meters from a point to a line segment defined by start and end.
 */
export function distanceToLineSegmentMeters(
  point: LatLng,
  start: LatLng,
  end: LatLng,
): number {
  const lat = point.latitude;
  const lon = point.longitude;
  const lat1 = start.latitude;
  const lon1 = start.longitude;
  const lat2 = end.latitude;
  const lon2 = end.longitude;

  const cosMidLat = Math.cos(((lat1 + lat) / 2) * (Math.PI / 180));
  const x = (lon - lon1) * cosMidLat;
  const y = lat - lat1;

  const cosMidSeg = Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  const dx = (lon2 - lon1) * cosMidSeg;
  const dy = lat2 - lat1;

  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return haversineDistanceMeters(lat, lon, lat1, lon1);
  }

  const t = Math.max(0, Math.min(1, (x * dx + y * dy) / lenSq));
  const projLat = lat1 + t * (lat2 - lat1);
  const projLng = lon1 + t * (lon2 - lon1);

  return haversineDistanceMeters(lat, lon, projLat, projLng);
}

/**
 * Calculate minimum distance in meters from a point to an ordered route polyline.
 */
export function distanceToPolylineMeters(
  point: LatLng,
  polyline: LatLng[],
): number {
  if (!polyline || polyline.length === 0) return Infinity;
  if (polyline.length === 1) {
    return haversineDistanceMeters(
      point.latitude,
      point.longitude,
      polyline[0].latitude,
      polyline[0].longitude,
    );
  }

  let minDistance = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const dist = distanceToLineSegmentMeters(point, polyline[i], polyline[i + 1]);
    if (dist < minDistance) {
      minDistance = dist;
    }
  }

  return minDistance;
}

/**
 * Evaluates whether a location reading represents a route deviation.
 */
export function checkRouteDeviation(
  currentLocation: { latitude: number; longitude: number; accuracy?: number } | null,
  routePolyline: LatLng[] | undefined,
  config = DEVIATION_CONFIG,
): { isDeviated: boolean; distanceMeters: number; ignoredDueToAccuracy: boolean } {
  if (!currentLocation || !routePolyline || routePolyline.length < 2) {
    return { isDeviated: false, distanceMeters: 0, ignoredDueToAccuracy: false };
  }

  if (
    typeof currentLocation.accuracy === 'number' &&
    currentLocation.accuracy > config.MAX_GPS_ACCURACY_THRESHOLD_METERS
  ) {
    return { isDeviated: false, distanceMeters: 0, ignoredDueToAccuracy: true };
  }

  const distanceMeters = distanceToPolylineMeters(currentLocation, routePolyline);
  const isDeviated = distanceMeters > config.DEVIATION_THRESHOLD_METERS;

  return { isDeviated, distanceMeters, ignoredDueToAccuracy: false };
}
