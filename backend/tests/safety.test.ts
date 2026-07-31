import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../src/index';
import * as db from '../src/db';

jest.mock('../src/db', () => ({
  query: jest.fn(),
  pool: { connect: jest.fn() },
  initDb: jest.fn().mockResolvedValue(true),
}));

const mockedQuery = db.query as jest.MockedFunction<typeof db.query>;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_change_me_in_production';

describe('Safety stats authorization', () => {
  const riderToken = jwt.sign({ id: 'rider-1', name: 'rider', role: 'rider' }, JWT_SECRET);
  const adminToken = jwt.sign({ id: 'admin-1', name: 'admin', role: 'admin' }, JWT_SECRET);

  beforeEach(() => jest.clearAllMocks());

  it('rejects riders from viewing aggregate crash statistics', async () => {
    const response = await request(app)
      .get('/api/safety/stats')
      .set('Authorization', `Bearer ${riderToken}`);

    expect(response.status).toBe(403);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('allows admins to view aggregate crash statistics', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ total_crashes: 4, confirmed: 1, false_alarms: 3 }],
    });

    const response = await request(app)
      .get('/api/safety/stats')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ totalCrashes: 4, confirmed: 1, falseAlarms: 3 });
  });
});
