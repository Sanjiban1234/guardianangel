import request from 'supertest';
import { app } from '../src/index';
import * as db from '../src/db';
import jwt from 'jsonwebtoken';

jest.mock('../src/db', () => ({
  query: jest.fn(),
  pool: {
    connect: jest.fn(),
    query: jest.fn(),
  },
  initDb: jest.fn().mockResolvedValue(true)
}));

const mockedQuery = db.query as jest.MockedFunction<typeof db.query>;
const mockedPoolQuery = (db.pool as any).query as jest.MockedFunction<any>;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_change_me_in_production';

describe('GET /api/rooms/:groupCode/summary', () => {
  let memberToken: string;
  let nonMemberToken: string;
  const member = { id: 'user-uuid-member', name: 'rider_member' };
  const nonMember = { id: 'user-uuid-outsider', name: 'outsider' };
  const mockGroupCode = 'SUMM99ABCDEF1234';
  const mockRoomId = 'room-uuid-summary';

  beforeAll(() => {
    memberToken = jwt.sign(member, JWT_SECRET);
    nonMemberToken = jwt.sign(nonMember, JWT_SECRET);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return ride summary for an authenticated room member', async () => {
    mockedQuery.mockImplementation(async (text: string, params?: any[]): Promise<any> => {
      if (text.includes('ride_rooms') && text.includes('room_members')) {
        return { rows: [{ id: mockRoomId, status: 'active' }] };
      }
      return { rows: [] };
    });

    mockedPoolQuery
      .mockResolvedValueOnce({ rows: [{ distance_meters: 5432.1 }] })
      .mockResolvedValueOnce({ rows: [{ duration_ms: '120000' }] });

    const response = await request(app)
      .get(`/api/rooms/${mockGroupCode}/summary`)
      .set('Authorization', `Bearer ${memberToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('room_id', mockRoomId);
    expect(response.body).toHaveProperty('user_id', member.id);
    expect(response.body).toHaveProperty('total_distance_meters');
    expect(typeof response.body.total_distance_meters).toBe('number');
    expect(response.body).toHaveProperty('duration_ms');
    expect(typeof response.body.duration_ms).toBe('number');
  });

  it('should reject non-members with 403', async () => {
    mockedQuery.mockImplementation(async (text: string, params?: any[]): Promise<any> => {
      if (text.includes('ride_rooms') && text.includes('room_members')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const response = await request(app)
      .get(`/api/rooms/${mockGroupCode}/summary`)
      .set('Authorization', `Bearer ${nonMemberToken}`);

    expect(response.status).toBe(403);
    expect(response.body).toHaveProperty('error', 'Forbidden: You are not a member of this ride group');
  });

  it('should reject unauthenticated requests with 401', async () => {
    const response = await request(app)
      .get(`/api/rooms/${mockGroupCode}/summary`);

    expect(response.status).toBe(401);
  });
});
