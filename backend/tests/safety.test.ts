import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createAuthenticatedTestSession, installTestSessionValidator } from './helpers/auth';
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
  let riderToken: string;
  let adminToken: string;

  beforeAll(() => {
    installTestSessionValidator();
    riderToken = createAuthenticatedTestSession({ id: 'user-uuid-999', name: 'safety_tester', role: 'rider' }).token;
    adminToken = createAuthenticatedTestSession({ id: 'admin-uuid-888', name: 'safety_admin', role: 'admin' }).token;
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
        .set('Authorization', `Bearer ${riderToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        speedGateKmh: 15,
        jerkThreshold: 150,
        magnitudeThresholdG: 4.0,
        gyroRotationThresholdDegPerSec: 250,
        postEventWindowMs: 4000,
        roughnessRatioThreshold: 2.5,
        speedCrossCheckToleranceKmh: 10,
        gravity: 9.8,
        expectedSampleIntervalMs: 20,
        sampleIntervalMinMs: 10,
        sampleIntervalMaxMs: 50,
        sampleHealthWindowSize: 20,
        sampleHealthThreshold: 0.6,
      });
    });

    it('should include gravity field in config response', async () => {
      const response = await request(app)
        .get('/api/safety/config')
        .set('Authorization', `Bearer ${riderToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('gravity', 9.8);
    });
  });

  describe('GET /api/safety/stats', () => {
    it('should return 401 when unauthorized', async () => {
      const response = await request(app).get('/api/safety/stats');
      expect(response.status).toBe(401);
    });

    it('should reject riders from viewing aggregate crash statistics', async () => {
      const response = await request(app)
        .get('/api/safety/stats')
        .set('Authorization', `Bearer ${riderToken}`);

      expect(response.status).toBe(403);
      expect(mockedQuery).not.toHaveBeenCalled();
    });

    it('should allow admins to view crash outcome analytics', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [
          { total_crashes: 10, confirmed: 2, false_alarms: 8 }
        ]
      } as any);

      const response = await request(app)
        .get('/api/safety/stats')
        .set('Authorization', `Bearer ${adminToken}`);

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
