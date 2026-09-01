import {
  haversineDistanceMeters,
  distanceToPolylineMeters,
  checkRouteDeviation,
  DEVIATION_CONFIG,
} from '../routeUtils';

describe('Route Deviation Utilities Tests', () => {
  const samplePolyline = [
    { latitude: 28.2000, longitude: 83.9800 },
    { latitude: 28.2100, longitude: 83.9800 },
    { latitude: 28.2200, longitude: 83.9800 },
  ];

  it('calculates Haversine distance accurately', () => {
    const dist = haversineDistanceMeters(28.2000, 83.9800, 28.2000, 83.9810);
    expect(dist).toBeGreaterThan(90);
    expect(dist).toBeLessThan(110);
  });

  it('detects when point is on route corridor', () => {
    const pointOnRoute = { latitude: 28.2050, longitude: 83.9800, accuracy: 5 };
    const res = checkRouteDeviation(pointOnRoute, samplePolyline);
    expect(res.isDeviated).toBe(false);
    expect(res.distanceMeters).toBeLessThan(DEVIATION_CONFIG.DEVIATION_THRESHOLD_METERS);
  });

  it('detects when point deviates outside route corridor', () => {
    // ~200m east of line
    const pointDeviated = { latitude: 28.2050, longitude: 83.9820, accuracy: 5 };
    const res = checkRouteDeviation(pointDeviated, samplePolyline);
    expect(res.isDeviated).toBe(true);
    expect(res.distanceMeters).toBeGreaterThan(DEVIATION_CONFIG.DEVIATION_THRESHOLD_METERS);
  });

  it('ignores deviation when GPS accuracy is poor (>30m)', () => {
    const pointDeviatedNoisy = { latitude: 28.2050, longitude: 83.9820, accuracy: 50 };
    const res = checkRouteDeviation(pointDeviatedNoisy, samplePolyline);
    expect(res.isDeviated).toBe(false);
    expect(res.ignoredDueToAccuracy).toBe(true);
  });
});
