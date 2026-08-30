import { routeWithProgress, sampleRoute } from '../src/services/RouteGeometry';
import { AiRouteRecommendationService } from '../src/services/AiRouteRecommendationService';
import { PlaceCandidate } from '../src/services/PlaceDiscoveryService';

const route = routeWithProgress([{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.18 }]);
describe('route corridor and fuel checkpoints', () => {
  it('samples a long route at bounded corridor intervals', () => { const points = sampleRoute(route, 5000, 20); expect(points.length).toBe(6); expect(points[1].progressMeters).toBe(5000); });
  it('returns no artificial fuel or fuel provider call for routes up to 5 km', async () => { const places = { discover: jest.fn().mockResolvedValue([]) }; const result = await new AiRouteRecommendationService(places as any, { rank: jest.fn().mockResolvedValue(null) } as any).recommend(route, 5000, 'short'); expect(result.fuel).toEqual([]); expect(places.discover).not.toHaveBeenCalledWith(expect.anything(), 'fuel'); });
  it('does not fabricate unavailable checkpoint stations or repeat a station', async () => { const real = { placeId: 'real', name: 'Real Fuel', latitude: 0, longitude: .045, category: 'fuel', distanceFromRouteMeters: 100, routeProgressMeters: 5000 } as PlaceCandidate; const places = { discover: jest.fn().mockImplementation((_route: any, category: string) => Promise.resolve(category === 'fuel' ? [real] : [])) }; const result = await new AiRouteRecommendationService(places as any, { rank: jest.fn().mockResolvedValue(null) } as any).recommend(route, 20_000, 'long'); expect(result.fuel.map(item => item.placeId)).toEqual(['real']); });
});
