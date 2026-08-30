import { ROUTE_RECOMMENDATION } from '../config';
import { PlaceCandidate } from './PlaceDiscoveryService';

export interface ScoredCandidate extends PlaceCandidate {
  score: number;
  scoreComponents: { distance: number; rating: number; reviews: number };
}

export function scoreCandidate(candidate: PlaceCandidate): ScoredCandidate {
  const clamp = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const distance = clamp(1 - candidate.distanceFromRouteMeters / ROUTE_RECOMMENDATION.distanceNormalizationMeters);
  const rating = candidate.rating == null ? 0 : clamp(candidate.rating / 5);
  const reviews = candidate.userRatingCount == null ? 0 : clamp(Math.log10(Math.max(0, candidate.userRatingCount) + 1) / ROUTE_RECOMMENDATION.reviewLogNormalizationMaximum);
  const weights = ROUTE_RECOMMENDATION.weights;
  const score = 100 * (weights.distance * distance + weights.rating * rating + weights.reviews * reviews);
  return { ...candidate, score: Math.round(clamp(score / 100) * 10_000) / 100, scoreComponents: { distance, rating, reviews } };
}
