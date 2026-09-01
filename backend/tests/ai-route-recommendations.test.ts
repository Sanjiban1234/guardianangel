import { DeepSeekClient } from '../src/services/DeepSeekClient';
import { scoreCandidate } from '../src/services/RecommendationScoring';
import { PlaceDiscoveryService } from '../src/services/PlaceDiscoveryService';
import { routeWithProgress } from '../src/services/RouteGeometry';

const candidate = { placeId:'known',name:'Known',category:'food' as const,latitude:1,longitude:1,distanceFromRouteMeters:100,routeProgressMeters:200,rating:4.5,userRatingCount:20 };
describe('AI route recommendation boundaries', () => {
  it('uses deterministic scoring for real-place metadata', () => expect(scoreCandidate(candidate).score).toBeGreaterThan(scoreCandidate({...candidate,distanceFromRouteMeters:1900,rating:1}).score));
  it('allows only supplied unique ids and safe structured rationale', async () => { const fetcher=jest.fn().mockResolvedValue({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({recommendations:[{placeId:'unknown',reason:'No',aiRank:1},{placeId:'known',reason:'Near the route.',aiRank:2},{placeId:'known',reason:'Duplicate',aiRank:3}]})}}]})}); const result=await new DeepSeekClient('secret',fetcher as any).rank('food',[candidate]); expect(result).toEqual([{placeId:'known',reason:'Near the route.',aiRank:2,classification:undefined}]); expect(fetcher.mock.calls[0][1].body).not.toMatch(/secret|email|phone|JWT|room/i); });
  it('falls back when the provider returns malformed output', async () => expect(new DeepSeekClient('secret',jest.fn().mockResolvedValue({ok:true,json:async()=>({choices:[{message:{content:'bad'}}]})}) as any).rank('food',[candidate])).resolves.toBeNull());
  it('uses its backend Places credential explicitly and fails soft without one', async () => { const route=routeWithProgress([{latitude:1,longitude:1},{latitude:1.01,longitude:1.01}]); const fetcher=jest.fn().mockResolvedValue({ok:true,json:async()=>({status:'ZERO_RESULTS',results:[]})}); await new PlaceDiscoveryService('backend-places-key',fetcher as any).discover(route,'fuel'); expect(String(fetcher.mock.calls[0][0])).toContain('key=backend-places-key'); await expect(new PlaceDiscoveryService('',fetcher as any).discover(route,'fuel')).resolves.toEqual([]); });
});
