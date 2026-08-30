import { calculateSummaryMetrics, normalizeTelemetry } from '../src/services/RideSummaryTelemetry';
describe('ride summary telemetry normalization', () => {
  const origin = { latitude: 27.7172, longitude: 85.324, accuracy: 5 };
  it('uses native speed when available and geographical fallback otherwise', () => {
    const route = normalizeTelemetry([{ ...origin, timestamp_ms: 1_000, speed_mps: null }, { ...origin, longitude: 85.325, timestamp_ms: 11_000, speed_mps: null }, { ...origin, longitude: 85.326, timestamp_ms: 21_000, speed_mps: 10 }]);
    expect(route).toHaveLength(3); expect(route[1].speed_kmh).toBeGreaterThan(0); expect(route[2].speed_kmh).toBe(36);
  });
  it('excludes duplicate timestamps, poor accuracy, and impossible jumps', () => {
    const route = normalizeTelemetry([{ ...origin, timestamp_ms: 1_000, speed_mps: 1 }, { ...origin, longitude: 85.325, timestamp_ms: 1_000, speed_mps: 1 }, { ...origin, longitude: 86, timestamp_ms: 2_000, speed_mps: 1 }, { ...origin, longitude: 85.325, timestamp_ms: 11_000, speed_mps: 1, accuracy: 200 }]);
    expect(route).toHaveLength(1);
  });
  it('only counts sustained low-speed intervals as stopped time', () => {
    const route = normalizeTelemetry([{ ...origin, timestamp_ms: 1_000, speed_mps: 0 }, { ...origin, timestamp_ms: 12_000, speed_mps: 0 }]);
    expect(calculateSummaryMetrics(route).stopped_time_ms).toBe(11_000);
  });
});
