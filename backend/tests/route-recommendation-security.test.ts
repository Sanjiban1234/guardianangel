import express from 'express';
import request from 'supertest';
import { RouteRecommendationRouter } from '../src/routes/RouteRecommendationRouter';
import { createAuthenticatedTestSession, installTestSessionValidator } from './helpers/auth';

const validPayload = { origin: { latitude: 0, longitude: 0 }, destination: { latitude: 0, longitude: .01 }, routePolyline: '???o}@', routeDistanceMeters: 1000 };
describe('POST /api/routes/recommendations security', () => {
  const recommend = jest.fn().mockResolvedValue({ fuel: [], food: [], workshops: [] });
  const app = express().use(express.json()).use('/api', new RouteRecommendationRouter({ recommend } as any).router);
  let token: string;
  beforeAll(() => { installTestSessionValidator(); token = createAuthenticatedTestSession({ id: 'route-user', name: 'Rider', role: 'rider' }).token; });
  beforeEach(() => recommend.mockClear());
  it('rejects unauthenticated requests', async () => expect((await request(app).post('/api/routes/recommendations').send(validPayload)).status).toBe(401));
  it.each([
    { ...validPayload, origin: { latitude: 91, longitude: 0 } },
    { ...validPayload, destination: { latitude: 0, longitude: 181 } },
    { ...validPayload, routeDistanceMeters: 1_000_001 },
    { ...validPayload, routePolyline: 'x'.repeat(20_001) },
  ])('rejects invalid coordinates and oversized routes', async payload => expect((await request(app).post('/api/routes/recommendations').set('Authorization', `Bearer ${token}`).send(payload)).status).toBe(400));
  it('does not expose provider keys in successful responses', async () => { const response = await request(app).post('/api/routes/recommendations').set('Authorization', `Bearer ${token}`).send(validPayload); expect(response.status).toBe(200); expect(JSON.stringify(response.body)).not.toMatch(/DEEPSEEK|GOOGLE_MAPS|API_KEY/i); });
});
