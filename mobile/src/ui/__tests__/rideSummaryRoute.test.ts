import { getSpeedBand, groupRouteSegments } from '../rideSummaryRoute';
describe('ride summary speed bands', () => {
  it('assigns the configured descriptive bands', () => expect([0, 2.9, 3, 20, 50, 80].map(getSpeedBand)).toEqual(['stopped', 'stopped', 'slow', 'normal', 'fast', 'very_fast']));
  it('merges adjacent route intervals in the same speed band', () => {
    const points = [0, 10, 15, 60].map((speed_kmh, index) => ({ latitude: 27 + index * .001, longitude: 85, recorded_at_ms: index * 5_000, speed_kmh, accuracy: 5 }));
    const segments = groupRouteSegments(points);
    expect(segments.map(segment => segment.band)).toEqual(['slow', 'fast']);
    expect(segments[0].coordinates).toHaveLength(3);
  });
});
