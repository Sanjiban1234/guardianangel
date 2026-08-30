import { PlaceDiscoveryService } from '../src/services/PlaceDiscoveryService';
import { routeWithProgress } from '../src/services/RouteGeometry';
const route = routeWithProgress([{ latitude: 27.7, longitude: 85.3 }, { latitude: 27.71, longitude: 85.31 }]);
describe('Google Places route discovery', () => {
  it('maps categories, searches corridor points, and deduplicates place IDs', async () => { const fetcher = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'OK', results: [{ place_id: 'same', name: 'Cafe', rating: 4.5, user_ratings_total: 20, vicinity: 'Road', opening_hours: { open_now: true }, geometry: { location: { lat: 27.705, lng: 85.305 } } }] }) }); const result = await new PlaceDiscoveryService('key', fetcher as any).discover(route, 'food'); expect(fetcher).toHaveBeenCalledTimes(2); expect(result).toHaveLength(1); expect(result[0]).toMatchObject({ placeId: 'same', category: 'food', rating: 4.5, userRatingCount: 20, openNow: true }); expect(String(fetcher.mock.calls[0][0])).toContain('radius=2000'); });
  it('returns no candidates when provider fails', async () => { const result = await new PlaceDiscoveryService('key', jest.fn().mockRejectedValue(new Error('down')) as any).discover(route, 'fuel'); expect(result).toEqual([]); });
  it('returns no candidates without a backend key', async () => expect(new PlaceDiscoveryService('', jest.fn() as any).discover(route, 'workshops')).resolves.toEqual([]));
});
