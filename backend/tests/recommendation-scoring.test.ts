import { scoreCandidate } from '../src/services/RecommendationScoring';
import { PlaceCandidate } from '../src/services/PlaceDiscoveryService';

const candidate = (overrides: Partial<PlaceCandidate> = {}): PlaceCandidate => ({ placeId: 'p', name: 'Place', latitude: 27.7, longitude: 85.3, category: 'food', distanceFromRouteMeters: 500, routeProgressMeters: 1000, rating: 4, userRatingCount: 100, ...overrides });
describe('deterministic route recommendation scoring', () => {
  it('scores a closer candidate higher all else equal', () => expect(scoreCandidate(candidate({ distanceFromRouteMeters: 50 })).score).toBeGreaterThan(scoreCandidate(candidate({ distanceFromRouteMeters: 1500 })).score));
  it('scores a stronger rating higher all else equal', () => expect(scoreCandidate(candidate({ rating: 5 })).score).toBeGreaterThan(scoreCandidate(candidate({ rating: 2 })).score));
  it('uses logarithmic review confidence', () => { const tenToHundred = scoreCandidate(candidate({ userRatingCount: 100 })).score - scoreCandidate(candidate({ userRatingCount: 10 })).score; const thousandToTenThousand = scoreCandidate(candidate({ userRatingCount: 10_000 })).score - scoreCandidate(candidate({ userRatingCount: 1_000 })).score; expect(Math.abs(tenToHundred - thousandToTenThousand)).toBeLessThan(0.2); });
  it.each([{ rating: undefined }, { userRatingCount: undefined }, { rating: Number.NaN, userRatingCount: Number.POSITIVE_INFINITY }])('handles missing/invalid data without NaN', values => { const result = scoreCandidate(candidate(values)); expect(Number.isFinite(result.score)).toBe(true); expect(result.score).toBeGreaterThanOrEqual(0); expect(result.score).toBeLessThanOrEqual(100); });
});
