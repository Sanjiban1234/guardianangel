import request from 'supertest';
import { app } from '../src/index';
import * as db from '../src/db';
import jwt from 'jsonwebtoken';

jest.mock('../src/db', () => ({
  query: jest.fn(),
  pool: {
    connect: jest.fn(),
  },
  initDb: jest.fn().mockResolvedValue(true)
}));

const mockedQuery = db.query as jest.MockedFunction<typeof db.query>;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_change_me_in_production';

describe('Ride Room REST Endpoints & Access Control', () => {
  let userToken: string;
  let nonMemberToken: string;
  const mockUser = { id: 'user-uuid-123', name: 'testrider' };
  const mockNonMemberUser = { id: 'user-uuid-999', name: 'intruder' };
  const mockRoomId = 'room-uuid-456';
  const mockGroupCode = 'RIDE99ABCDEF1234';

  beforeAll(() => {
    userToken = jwt.sign(mockUser, JWT_SECRET);
    nonMemberToken = jwt.sign(mockNonMemberUser, JWT_SECRET);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/rooms (Create Room)', () => {
    it('should block unauthorized requests', async () => {
      const response = await request(app).post('/api/rooms').send({});
      expect(response.status).toBe(401);
    });

    it('should create room and auto-join the creator', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [{ id: mockRoomId }]
      } as any);
      mockedQuery.mockResolvedValueOnce({ rows: [] } as any);

      const response = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${userToken}`)
        .send({});

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('room_id', mockRoomId);
      expect(response.body).toHaveProperty('group_code');
      expect(response.body).toHaveProperty('creator_id', mockUser.id);
      expect(mockedQuery).toHaveBeenCalledTimes(2);
    });
  });

  describe('POST /api/rooms/join (Join Room)', () => {
    it('should join an active room successfully', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [{ id: mockRoomId, status: 'active' }]
      } as any);
      mockedQuery.mockResolvedValueOnce({ rows: [] } as any);

      const response = await request(app)
        .post('/api/rooms/join')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ group_code: mockGroupCode });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message', 'Successfully joined ride group');
      expect(response.body).toHaveProperty('room_id', mockRoomId);
    });

    it('should block joining ended rooms', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [{ id: mockRoomId, status: 'ended' }]
      } as any);

      const response = await request(app)
        .post('/api/rooms/join')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ group_code: mockGroupCode });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'This ride group has already ended');
    });

    it('should return 404 for invalid token', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [] } as any);

      const response = await request(app)
        .post('/api/rooms/join')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ group_code: 'INVALID' });

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'Ride group not found');
    });
  });

  describe('GET /api/rooms/:groupCode/history (Room Access Isolation)', () => {
    const telemetryHistory = [
      { user_id: mockUser.id, name: mockUser.name, device_timestamp: 1234567, latitude: 12, longitude: 34, accuracy: 5, speed: 10 }
    ];

    it('should allow room history access for active room members', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [{ 1: 1 }] } as any);
      mockedQuery.mockResolvedValueOnce({ rows: telemetryHistory } as any);

      const response = await request(app)
        .get(`/api/rooms/${mockGroupCode}/history`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(telemetryHistory);
      expect(mockedQuery).toHaveBeenCalledTimes(2);
    });

    it('should forbid history access for non-members of the room', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [] } as any);

      const response = await request(app)
        .get(`/api/rooms/${mockGroupCode}/history`)
        .set('Authorization', `Bearer ${nonMemberToken}`);

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Forbidden: You are not a member of this ride group');
      expect(mockedQuery).toHaveBeenCalledTimes(1);
    });
  });
});
