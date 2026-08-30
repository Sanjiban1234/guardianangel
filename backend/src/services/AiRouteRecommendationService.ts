import { createHash } from 'crypto';
import { ROUTE_RECOMMENDATION } from '../config';
import { DeepSeekClient } from './DeepSeekClient';
import { PlaceCandidate, PlaceDiscoveryService, RecommendationCategory } from './PlaceDiscoveryService';
import { RoutePoint, haversineMeters, pointAtProgress } from './RouteGeometry';
import { ScoredCandidate, scoreCandidate } from './RecommendationScoring';

export interface RouteRecommendation extends Omit<ScoredCandidate, 'scoreComponents'> { aiReason: string; aiRank: number; classification?: string }
interface CacheEntry { expiresAt: number; value: Record<RecommendationCategory, RouteRecommendation[]> }

export class AiRouteRecommendationService {
  private readonly cache = new Map<string, CacheEntry>();
  constructor(private readonly places = new PlaceDiscoveryService(), private readonly deepSeek = new DeepSeekClient()) {}

  async recommend(route: RoutePoint[], routeDistanceMeters: number, fingerprintSource: string): Promise<Record<RecommendationCategory, RouteRecommendation[]>> {
    this.pruneCache();
    const key = createHash('sha256').update(fingerprintSource).digest('hex');
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const categories: RecommendationCategory[] = ['fuel', 'food', 'workshops'];
    const entries = await Promise.all(categories.map(async category => [category, await this.forCategory(route, routeDistanceMeters, category)] as const));
    const value = Object.fromEntries(entries) as Record<RecommendationCategory, RouteRecommendation[]>;
    if (this.cache.size >= ROUTE_RECOMMENDATION.maximumCacheEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(key, { expiresAt: Date.now() + ROUTE_RECOMMENDATION.cacheTtlMs, value });
    return value;
  }

  private async forCategory(route: RoutePoint[], distance: number, category: RecommendationCategory): Promise<RouteRecommendation[]> {
    if (category === 'fuel' && distance <= ROUTE_RECOMMENDATION.fuelIntervalMeters) return [];
    let candidates = (await this.places.discover(route, category)).map(scoreCandidate).sort((a, b) => b.score - a.score);
    if (category === 'fuel') candidates = this.selectFuelCheckpoints(route, distance, candidates);
    const shortlist = candidates.slice(0, ROUTE_RECOMMENDATION.maximumCandidatesPerCategory);
    const safeAiInput = shortlist.map(item => ({ placeId: item.placeId, name: item.name, category: item.category, rating: item.rating, reviewCount: item.userRatingCount, distanceFromRouteMeters: Math.round(item.distanceFromRouteMeters), deterministicScore: item.score, openNow: item.openNow }));
    const ai = await this.deepSeek.rank(category, distance, safeAiInput);
    const ranks = new Map((ai || []).map(item => [item.placeId, item]));
    return shortlist.map((item, index) => {
      const rank = ranks.get(item.placeId);
      const { scoreComponents: _internal, ...publicItem } = item;
      return { ...publicItem, aiReason: rank?.reason || this.fallbackReason(item), aiRank: rank?.aiRank || index + 1, classification: rank?.classification };
    }).sort((a, b) => a.aiRank - b.aiRank).slice(0, ROUTE_RECOMMENDATION.maximumResultsPerCategory);
  }

  private selectFuelCheckpoints(route: RoutePoint[], distance: number, candidates: ScoredCandidate[]): ScoredCandidate[] {
    if (distance < ROUTE_RECOMMENDATION.fuelIntervalMeters) return [];
    const selected: ScoredCandidate[] = [], used = new Set<string>();
    for (let checkpoint = ROUTE_RECOMMENDATION.fuelIntervalMeters; checkpoint < distance; checkpoint += ROUTE_RECOMMENDATION.fuelIntervalMeters) {
      const checkpointPoint = pointAtProgress(route, checkpoint);
      const best = candidates.filter(item => !used.has(item.placeId) && Math.abs(item.routeProgressMeters - checkpoint) <= ROUTE_RECOMMENDATION.maximumCorridorMeters)
        .sort((a, b) => (haversineMeters(a, checkpointPoint) - haversineMeters(b, checkpointPoint)) || b.score - a.score)[0];
      if (best) { selected.push(best); used.add(best.placeId); }
    }
    return selected;
  }

  private fallbackReason(candidate: PlaceCandidate): string {
    if (candidate.rating != null && candidate.userRatingCount != null) return 'Strong real-world reviews and close to the planned route.';
    return 'A real place located close to the planned route.';
  }

  private pruneCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) if (entry.expiresAt <= now) this.cache.delete(key);
  }
}
