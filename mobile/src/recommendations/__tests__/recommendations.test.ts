import { formatRecommendationMeta } from '../RecommendationMarker';
import { filterRecommendations, fetchRouteRecommendations } from '../../ui/MapScreen';
import { RouteRecommendation, RouteRecommendations } from '../types';

const item = (category: RouteRecommendation['category'], id: string): RouteRecommendation => ({ placeId: id, name: id, category, latitude: 1, longitude: 1, distanceFromRouteMeters: 100, routeProgressMeters: 500, score: 80, aiReason: 'Nearby.', aiRank: 1 });
const values: RouteRecommendations = { fuel: [item('fuel', 'f')], food: [item('food', 'e')], workshops: [item('workshops', 'w')] };
describe('route recommendation mobile behavior', () => {
  afterEach(() => jest.restoreAllMocks());
  it('filters marker data by category', () => expect(filterRecommendations(values, { fuel: true, food: false, workshops: true }).map(value => value.placeId)).toEqual(['f', 'w']));
  it('handles missing rating and review metadata', () => expect(formatRecommendationMeta(item('fuel', 'f'))).toBe('Rating unavailable • reviews unavailable'));
  it('formats supported rating and review metadata', () => expect(formatRecommendationMeta({ ...item('food', 'e'), rating: 4.5, userRatingCount: 326 })).toBe('4.5 ★ • 326 reviews'));
  it('returns null rather than crashing when the API fails', async () => { global.fetch = jest.fn().mockRejectedValue(new Error('offline')); await expect(fetchRouteRecommendations('https://api', 'token', {})).resolves.toBeNull(); });
});
