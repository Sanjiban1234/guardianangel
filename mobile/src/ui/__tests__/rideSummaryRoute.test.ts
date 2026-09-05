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


it('never coalesces same-speed lines across a telemetry gap', () => {
  const points = [0, 1, 2, 3].map(i => ({ latitude: 27, longitude: 85 + i * .001, recorded_at_ms: i * 5000, speed_kmh: 20, accuracy: 5, gap_before: i === 2 }));
  const segments = groupRouteSegments(points);
  expect(segments).toHaveLength(2);
  expect(segments[0].coordinates).toEqual(points.slice(0, 2).map(({ latitude, longitude }) => ({ latitude, longitude })));
  expect(segments[1].coordinates).toEqual(points.slice(2).map(({ latitude, longitude }) => ({ latitude, longitude })));
});
