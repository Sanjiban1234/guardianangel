import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../src/index';
import * as db from '../src/db';
import { CrashHandler } from '../src/handlers/CrashHandler';

jest.mock('../src/db', () => ({
  query: jest.fn(),
  pool: {
    connect: jest.fn(),
  },
  initDb: jest.fn().mockResolvedValue(true)
}));

const mockedQuery = db.query as jest.MockedFunction<typeof db.query>;
const JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_value_for_unit_tests_only';

describe('Safety Endpoints & Crash Rate Limiting', () => {
  let userToken: string;

  beforeAll(() => {
    userToken = jwt.sign({ id: 'user-uuid-999', name: 'safety_tester' }, JWT_SECRET);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    CrashHandler.resetRateLimits();
  });

  describe('GET /api/safety/config', () => {
    it('should return 401 when unauthorized', async () => {
      const response = await request(app).get('/api/safety/config');
      expect(response.status).toBe(401);
    });

    it('should return safety configuration for authenticated user', async () => {
      const response = await request(app)
        .get('/api/safety/config')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        impactThreshold: 4.0,
        stillnessThreshold: 0.5,
        confirmWindowMs: 15000,
        telemetrySampleRateMs: 1000,
        maxBulkBatch: 500
      });
    });
  });

  describe('GET /api/safety/stats', () => {
    it('should return 401 when unauthorized', async () => {
      const response = await request(app).get('/api/safety/stats');
      expect(response.status).toBe(401);
    });

    it('should return crash outcome analytics', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [
          { total_crashes: 10, confirmed: 2, false_alarms: 8 }
        ]
      } as any);

      const response = await request(app)
        .get('/api/safety/stats')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        totalCrashes: 10,
        confirmed: 2,
        falseAlarms: 8,
        falsePositiveRate: 0.8,
        avgConfirmationTime: 15.0
      });
    });
  });
});
