export type RecommendationCategory = 'fuel' | 'food' | 'workshops';
export interface RouteRecommendation {
  placeId: string; name: string; category: RecommendationCategory;
  latitude: number; longitude: number; rating?: number; userRatingCount?: number;
  address?: string; openNow?: boolean; distanceFromRouteMeters: number; routeProgressMeters: number;
  score: number; aiReason: string; aiRank: number;
}
export type RouteRecommendations = Record<RecommendationCategory, RouteRecommendation[]>;
export const EMPTY_RECOMMENDATIONS: RouteRecommendations = { fuel: [], food: [], workshops: [] };
