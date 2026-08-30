export interface StoredTelemetryPoint {
  latitude: number;
  longitude: number;
  timestamp_ms: number;
  speed_mps: number | null;
  accuracy: number | null;
}

export interface SummaryRoutePoint {
  latitude: number;
  longitude: number;
  recorded_at_ms: number;
  speed_kmh: number | null;
  accuracy: number | null;
}

export const SUMMARY_TELEMETRY = {
  maxAccuracyMeters: 100,
  maxPlausibleSpeedKmh: 180,
  stoppedSpeedKmh: 3,
  sustainedStopMs: 10_000,
  maxRoutePoints: 500,
} as const;

export function haversineMeters(a: Pick<SummaryRoutePoint, 'latitude' | 'longitude'>, b: Pick<SummaryRoutePoint, 'latitude' | 'longitude'>): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** Produces a chronological, GPS-quality filtered trace. Native speed is preferred;
 * a geographic elapsed-time fallback is used only for a valid adjacent interval. */
export function normalizeTelemetry(points: StoredTelemetryPoint[]): SummaryRoutePoint[] {
  const accepted: SummaryRoutePoint[] = [];
  for (const raw of [...points].sort((a, b) => a.timestamp_ms - b.timestamp_ms)) {
    if (!Number.isFinite(raw.latitude) || !Number.isFinite(raw.longitude) || !Number.isFinite(raw.timestamp_ms) ||
      raw.latitude < -90 || raw.latitude > 90 || raw.longitude < -180 || raw.longitude > 180 ||
      (raw.accuracy != null && (!Number.isFinite(raw.accuracy) || raw.accuracy > SUMMARY_TELEMETRY.maxAccuracyMeters))) continue;
    const previous = accepted[accepted.length - 1];
    if (previous && raw.timestamp_ms <= previous.recorded_at_ms) continue;
    const point: SummaryRoutePoint = { latitude: raw.latitude, longitude: raw.longitude, recorded_at_ms: raw.timestamp_ms, speed_kmh: null, accuracy: raw.accuracy };
    if (previous) {
      const elapsedMs = point.recorded_at_ms - previous.recorded_at_ms;
      const intervalSpeed = haversineMeters(previous, point) / (elapsedMs / 1000) * 3.6;
      if (!Number.isFinite(intervalSpeed) || intervalSpeed > SUMMARY_TELEMETRY.maxPlausibleSpeedKmh) continue;
      // Older mobile builds encoded unavailable native speed as 0. Treat that
      // as a real stop only when the matching GPS interval is also stationary.
      const nativeKmh = raw.speed_mps != null && Number.isFinite(raw.speed_mps) && raw.speed_mps >= 0 &&
        (raw.speed_mps > 0 || intervalSpeed < SUMMARY_TELEMETRY.stoppedSpeedKmh)
        ? raw.speed_mps * 3.6 : null;
      point.speed_kmh = nativeKmh != null && nativeKmh <= SUMMARY_TELEMETRY.maxPlausibleSpeedKmh ? nativeKmh : intervalSpeed;
    }
    accepted.push(point);
  }
  return accepted;
}

export function downsample(points: SummaryRoutePoint[]): SummaryRoutePoint[] {
  if (points.length <= SUMMARY_TELEMETRY.maxRoutePoints) return points;
  const result: SummaryRoutePoint[] = [points[0]];
  const stride = (points.length - 1) / (SUMMARY_TELEMETRY.maxRoutePoints - 1);
  for (let index = 1; index < SUMMARY_TELEMETRY.maxRoutePoints - 1; index++) result.push(points[Math.round(index * stride)]);
  result.push(points[points.length - 1]);
  return result;
}

export function calculateSummaryMetrics(route: SummaryRoutePoint[]) {
  let distanceMeters = 0, movingMs = 0, stoppedMs = 0, maxSpeedKmh = 0;
  for (let i = 1; i < route.length; i++) {
    const previous = route[i - 1], point = route[i];
    const elapsedMs = point.recorded_at_ms - previous.recorded_at_ms;
    const speed = point.speed_kmh;
    distanceMeters += haversineMeters(previous, point);
    if (speed != null) {
      maxSpeedKmh = Math.max(maxSpeedKmh, speed);
      if (speed < SUMMARY_TELEMETRY.stoppedSpeedKmh && elapsedMs >= SUMMARY_TELEMETRY.sustainedStopMs) stoppedMs += elapsedMs;
      else if (speed >= SUMMARY_TELEMETRY.stoppedSpeedKmh) movingMs += elapsedMs;
    }
  }
  const durationMs = route.length > 1 ? route[route.length - 1].recorded_at_ms - route[0].recorded_at_ms : 0;
  return { total_distance_meters: distanceMeters, duration_ms: durationMs, average_moving_speed_kmh: movingMs > 0 ? (distanceMeters / movingMs) * 3600 : null, max_filtered_speed_kmh: maxSpeedKmh || null, stopped_time_ms: stoppedMs };
}
