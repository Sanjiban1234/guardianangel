export interface StoredTelemetryPoint {
  latitude: number;
  longitude: number;
  timestamp_ms: number;
  speed_mps: number | null;
  accuracy: number | null;
}

export interface SummaryRoutePoint {
  gap_before?: boolean;
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
  // Twelve missed nominal 5-second fixes: no route/speed inference beyond this.
  maxIntervalMs: 60_000,
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
  let interrupted = false;
  for (const raw of [...points].sort((a, b) => a.timestamp_ms - b.timestamp_ms)) {
    if (!Number.isFinite(raw.latitude) || !Number.isFinite(raw.longitude) || !Number.isFinite(raw.timestamp_ms) ||
      raw.latitude < -90 || raw.latitude > 90 || raw.longitude < -180 || raw.longitude > 180 ||
      (raw.accuracy != null && (!Number.isFinite(raw.accuracy) || raw.accuracy < 0 || raw.accuracy > SUMMARY_TELEMETRY.maxAccuracyMeters))) {
      interrupted = true; continue;
    }
    const previous = accepted[accepted.length - 1];
    if (previous && raw.timestamp_ms <= previous.recorded_at_ms) continue;
    const point: SummaryRoutePoint = { latitude: raw.latitude, longitude: raw.longitude, recorded_at_ms: raw.timestamp_ms, speed_kmh: null, accuracy: raw.accuracy };
    const native = raw.speed_mps != null && Number.isFinite(raw.speed_mps) && raw.speed_mps >= 0 && raw.speed_mps * 3.6 <= SUMMARY_TELEMETRY.maxPlausibleSpeedKmh ? raw.speed_mps * 3.6 : null;
    point.speed_kmh = native;
    if (previous) {
      const elapsedMs = point.recorded_at_ms - previous.recorded_at_ms;
      const intervalSpeed = haversineMeters(previous, point) / elapsedMs * 3600;
      point.gap_before = interrupted || elapsedMs > SUMMARY_TELEMETRY.maxIntervalMs || intervalSpeed > SUMMARY_TELEMETRY.maxPlausibleSpeedKmh;
      // Keep real endpoints, but never derive speed or draw a line across a gap.
      if (!point.gap_before) point.speed_kmh = native != null && (native > 0 || intervalSpeed < SUMMARY_TELEMETRY.stoppedSpeedKmh) ? native : intervalSpeed;
    }
    accepted.push(point);
    interrupted = false;
  }
  return accepted;
}

export function splitRoute(route: SummaryRoutePoint[]): SummaryRoutePoint[][] {
  const segments: SummaryRoutePoint[][] = [];
  for (const point of route) {
    if (!segments.length || point.gap_before) segments.push([]);
    segments[segments.length - 1].push(point);
  }
  return segments;
}

export function downsample(points: SummaryRoutePoint[]): SummaryRoutePoint[] {
  if (points.length <= SUMMARY_TELEMETRY.maxRoutePoints) return points;
  const result: SummaryRoutePoint[] = [points[0]];
  const stride = (points.length - 1) / (SUMMARY_TELEMETRY.maxRoutePoints - 1);
  for (let index = 1; index < SUMMARY_TELEMETRY.maxRoutePoints - 1; index++) {
    const selected = Math.round(index * stride);
    const prior = Math.round((index - 1) * stride);
    result.push({ ...points[selected], gap_before: points.slice(prior + 1, selected + 1).some(p => p.gap_before) });
  }
  result.push({ ...points[points.length - 1], gap_before: points.slice(Math.round((SUMMARY_TELEMETRY.maxRoutePoints - 2) * stride) + 1).some(p => p.gap_before) });
  return result;
}

export function calculateSummaryMetrics(route: SummaryRoutePoint[], rideDurationMs?: number) {
  let distanceMeters = 0, movingMs = 0, stoppedMs = 0, weightedSpeed = 0;
  let maxSpeedKmh: number | null = null;
  let stopRunMs = 0;
  const finishStop = () => { if (stopRunMs >= SUMMARY_TELEMETRY.sustainedStopMs) stoppedMs += stopRunMs; stopRunMs = 0; };
  for (const point of route) {
    if (point.speed_kmh != null && Number.isFinite(point.speed_kmh) && point.speed_kmh >= 0 && point.speed_kmh <= SUMMARY_TELEMETRY.maxPlausibleSpeedKmh) maxSpeedKmh = Math.max(maxSpeedKmh ?? 0, point.speed_kmh);
  }
  for (let i = 1; i < route.length; i++) {
    const previous = route[i - 1], point = route[i];
    const elapsedMs = point.recorded_at_ms - previous.recorded_at_ms;
    const distance = haversineMeters(previous, point);
    const speed = point.speed_kmh;
    if (point.gap_before || elapsedMs <= 0 || elapsedMs > SUMMARY_TELEMETRY.maxIntervalMs || distance / elapsedMs * 3600 > SUMMARY_TELEMETRY.maxPlausibleSpeedKmh || speed == null || !Number.isFinite(speed) || speed < 0 || speed > SUMMARY_TELEMETRY.maxPlausibleSpeedKmh) { finishStop(); continue; }
    distanceMeters += distance;
    if (speed < SUMMARY_TELEMETRY.stoppedSpeedKmh) stopRunMs += elapsedMs;
    else { finishStop(); movingMs += elapsedMs; weightedSpeed += speed * elapsedMs; }
  }
  finishStop();
  const span = route.length > 1 ? Math.max(0, route[route.length - 1].recorded_at_ms - route[0].recorded_at_ms) : 0;
  const durationMs = Math.max(span, rideDurationMs ?? 0);
  const unknownMs = Math.max(0, durationMs - movingMs - stoppedMs);
  return { total_distance_meters: distanceMeters, duration_ms: durationMs,
    average_moving_speed_kmh: movingMs > 0 ? weightedSpeed / movingMs : null,
    max_filtered_speed_kmh: maxSpeedKmh, stopped_time_ms: stoppedMs, moving_time_ms: movingMs,
    unknown_time_ms: unknownMs, telemetry_gap_count: route.filter(p => p.gap_before).length,
    has_low_data: unknownMs > 0 || route.length < 2 };
}
