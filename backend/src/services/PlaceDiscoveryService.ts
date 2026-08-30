import { GOOGLE_MAPS_API_KEY, ROUTE_RECOMMENDATION } from '../config';
import { Coordinate, RoutePoint, nearestRouteMetric, sampleRoute } from './RouteGeometry';

export type RecommendationCategory = 'fuel' | 'food' | 'workshops';
export interface PlaceCandidate {
  placeId: string; name: string; latitude: number; longitude: number;
  category: RecommendationCategory; rating?: number; userRatingCount?: number;
  address?: string; openNow?: boolean; distanceFromRouteMeters: number; routeProgressMeters: number;
}

const SEARCHES: Record<RecommendationCategory, Array<{ type?: string; keyword?: string }>> = {
  fuel: [{ type: 'gas_station' }],
  food: [{ keyword: 'food restaurant cafe' }],
  workshops: [{ type: 'car_repair', keyword: 'motorcycle repair mechanic workshop' }],
};

export class PlaceDiscoveryService {
  constructor(private readonly apiKey = GOOGLE_MAPS_API_KEY, private readonly fetcher = globalThis.fetch) {}

  async discover(route: RoutePoint[], category: RecommendationCategory): Promise<PlaceCandidate[]> {
    if (!this.apiKey) return [];
    const interval = category === 'fuel' ? ROUTE_RECOMMENDATION.fuelIntervalMeters : ROUTE_RECOMMENDATION.searchPointIntervalMeters;
    const points = sampleRoute(route, interval, ROUTE_RECOMMENDATION.maximumSearchPoints);
    const deduplicated = new Map<string, PlaceCandidate>();
    for (const point of points) {
      for (const search of SEARCHES[category]) {
        const params = new URLSearchParams({
          location: `${point.latitude},${point.longitude}`,
          radius: String(ROUTE_RECOMMENDATION.corridorMeters), key: this.apiKey,
        });
        if (search.type) params.set('type', search.type);
        if (search.keyword) params.set('keyword', search.keyword);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), ROUTE_RECOMMENDATION.providerTimeoutMs);
        try {
          const response = await this.fetcher(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params}`, { signal: controller.signal });
          if (!response.ok) continue;
          const payload = await response.json() as any;
          if (!['OK', 'ZERO_RESULTS'].includes(payload.status)) continue;
          for (const place of payload.results || []) {
            const location = place.geometry?.location;
            if (!place.place_id || !place.name || !location) continue;
            const metric = nearestRouteMetric({ latitude: location.lat, longitude: location.lng }, route);
            if (metric.distanceFromRouteMeters > ROUTE_RECOMMENDATION.corridorMeters) continue;
            deduplicated.set(place.place_id, {
              placeId: place.place_id, name: place.name, latitude: location.lat, longitude: location.lng,
              category, rating: typeof place.rating === 'number' ? place.rating : undefined,
              userRatingCount: typeof place.user_ratings_total === 'number' ? place.user_ratings_total : undefined,
              address: place.vicinity || undefined, openNow: typeof place.opening_hours?.open_now === 'boolean' ? place.opening_hours.open_now : undefined,
              ...metric,
            });
          }
        } catch { /* provider failure produces no fabricated candidates */ } finally { clearTimeout(timeout); }
      }
    }
    return [...deduplicated.values()];
  }
}
