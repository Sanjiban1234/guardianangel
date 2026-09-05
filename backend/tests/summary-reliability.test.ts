import { calculateSummaryMetrics, normalizeTelemetry, splitRoute, downsample } from '../src/services/RideSummaryTelemetry';
const point = (timestamp_ms: number, longitude = 85, speed_mps: number | null = 10, accuracy = 5) => ({ timestamp_ms, latitude: 27, longitude, speed_mps, accuracy });
describe('summary telemetry reliability', () => {
  it('normal dense trace uses a bounded time-weighted mean', () => {
    const result = calculateSummaryMetrics(normalizeTelemetry([point(0), point(5000, 85.0001, 5), point(10000, 85.0002, 10)]));
    expect(result.average_moving_speed_kmh).toBe(27);
    expect(result.max_filtered_speed_kmh).toBe(36);
    expect(result.unknown_time_ms).toBe(0);
  });
  it('regression: 27 minutes, low native speed and a large positional gap', () => {
    const route = normalizeTelemetry([point(0, 85, 0), point(1600000, 85.05, 0), point(1620000, 85.0501, 3.2 / 3.6)]);
    const r = calculateSummaryMetrics(route);
    expect(r.average_moving_speed_kmh).toBeCloseTo(3.2);
    expect(r.max_filtered_speed_kmh).toBeCloseTo(3.2);
    expect(r.stopped_time_ms).toBe(0);
    expect(r.unknown_time_ms).toBe(1600000);
    expect(r.total_distance_meters).toBeLessThan(20);
    expect(splitRoute(route)).toHaveLength(2);
  });
  it.each([[1000, 86], [100000, 85.001]])('splits impossible jumps and long intervals (%s)', (time, lon) => {
    const route = normalizeTelemetry([point(0), point(time, lon)]);
    expect(route[1].gap_before).toBe(true);
    expect(calculateSummaryMetrics(route).average_moving_speed_kmh).toBeNull();
    expect(calculateSummaryMetrics(route).stopped_time_ms).toBe(0);
  });
  it('sorts timestamps and removes duplicate times safely', () => {
    expect(normalizeTelemetry([point(10000), point(0), point(0), point(5000)]).map(p => p.recorded_at_ms)).toEqual([0, 5000, 10000]);
  });
  it('poor accuracy interrupts the path even within the time threshold', () => {
    const route = normalizeTelemetry([point(0), point(5000, 85, 10, 200), point(10000)]);
    expect(route).toHaveLength(2);
    expect(route[1].gap_before).toBe(true);
  });
  it('legacy missing speed falls back only within valid adjacent intervals', () => {
    const route = normalizeTelemetry([point(0, 85, null), point(5000, 85.0001, null), point(100000, 85.001, null)]);
    expect(route[1].speed_kmh).toBeGreaterThan(0);
    expect(route[2].speed_kmh).toBeNull();
  });
  it('accumulates evidence from multiple dense stopped fixes', () => {
    const r = calculateSummaryMetrics(normalizeTelemetry([point(0, 85, 0), point(5000, 85, 0), point(10000, 85, 0)]), 20000);
    expect(r.stopped_time_ms).toBe(10000);
    expect(r.unknown_time_ms).toBe(10000);
    expect(r.max_filtered_speed_kmh).toBe(0);
  });
  it('returns unknown and unavailable for absent telemetry', () => {
    expect(calculateSummaryMetrics([], 60000)).toMatchObject({ average_moving_speed_kmh: null, max_filtered_speed_kmh: null, unknown_time_ms: 60000, stopped_time_ms: 0 });
  });
  it('preserves all duration and speed invariants over deterministic mixed traces', () => {
    for (let n = 1; n < 100; n++) {
      const route = normalizeTelemetry(Array.from({ length: n }, (_, i) => point(i * (n % 2 ? 5000 : 90000), 85 + i * .0001, i % 4 ? i % 20 : null)));
      const r = calculateSummaryMetrics(route);
      if (r.average_moving_speed_kmh != null) expect(r.average_moving_speed_kmh).toBeLessThanOrEqual(r.max_filtered_speed_kmh! + 1e-9);
      expect(r.moving_time_ms + r.stopped_time_ms + r.unknown_time_ms).toBe(r.duration_ms);
    }
  });
  it('downsampling preserves gaps even when their endpoints are omitted', () => {
    const route = normalizeTelemetry(Array.from({ length: 1000 }, (_, i) => point(i * 5000 + (i >= 503 ? 120000 : 0))));
    expect(downsample(route)).toHaveLength(500);
    expect(splitRoute(downsample(route))).toHaveLength(2);
  });
});
