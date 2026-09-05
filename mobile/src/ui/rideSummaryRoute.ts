export type SpeedBand = 'stopped' | 'slow' | 'normal' | 'fast' | 'very_fast';

export interface SummaryRoutePoint {
  gap_before?: boolean;
  latitude: number;
  longitude: number;
  recorded_at_ms: number;
  speed_kmh: number | null;
  accuracy: number | null;
}

export const SPEED_BANDS: Record<SpeedBand, { label: string; color: string }> = {
  stopped: { label: 'Stopped', color: '#94A3B8' },
  slow: { label: 'Slow', color: '#38BDF8' },
  normal: { label: 'Normal', color: '#5EF58C' },
  fast: { label: 'Fast', color: '#F5B942' },
  very_fast: { label: 'Very Fast', color: '#F87171' },
};

export function getSpeedBand(speedKmh: number | null): SpeedBand {
  if (speedKmh == null || speedKmh < 3) return 'stopped';
  if (speedKmh < 20) return 'slow';
  if (speedKmh < 50) return 'normal';
  if (speedKmh < 80) return 'fast';
  return 'very_fast';
}

export interface RouteSegment { band: SpeedBand; coordinates: Array<{ latitude: number; longitude: number }>; }

/** Coalesces adjacent intervals of the same band, retaining shared join points. */
export function groupRouteSegments(points: SummaryRoutePoint[]): RouteSegment[] {
  const result: RouteSegment[] = [];
  let interrupted = false;
  for (let index = 1; index < points.length; index++) {
    if (points[index].gap_before) { interrupted = true; continue; }
    const band = getSpeedBand(points[index].speed_kmh);
    const start = { latitude: points[index - 1].latitude, longitude: points[index - 1].longitude };
    const end = { latitude: points[index].latitude, longitude: points[index].longitude };
    const current = result[result.length - 1];
    if (!interrupted && current?.band === band) current.coordinates.push(end);
    else result.push({ band, coordinates: [start, end] });
    interrupted = false;
  }
  return result;
}
