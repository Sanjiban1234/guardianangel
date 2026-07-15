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
  const mockUser = { id: 'user-uuid-123', username: 'testrider' };
  const mockNonMemberUser = { id: 'user-uuid-999', username: 'intruder' };
  const mockRoomId = 'room-uuid-456';
  const mockRoomToken = 'RIDE99';

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
      // 1. Mock room creation insertion
      mockedQuery.mockResolvedValueOnce({
        rows: [{ id: mockRoomId, room_token: mockRoomToken, creator_id: mockUser.id }]
      } as any);
      // 2. Mock auto-join insertion
      mockedQuery.mockResolvedValueOnce({ rows: [] } as any);

      const response = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${userToken}`)
        .send({});

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        room_id: mockRoomId,
        room_token: mockRoomToken,
        creator_id: mockUser.id
      });
      expect(mockedQuery).toHaveBeenCalledTimes(2);
    });
  });

  describe('POST /api/rooms/join (Join Room)', () => {
    it('should join an active room successfully', async () => {
      // 1. Mock room search by token - returns active room
      mockedQuery.mockResolvedValueOnce({
        rows: [{ id: mockRoomId, status: 'active' }]
      } as any);
      // 2. Mock member entry insertion
      mockedQuery.mockResolvedValueOnce({ rows: [] } as any);

      const response = await request(app)
        .post('/api/rooms/join')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ room_token: mockRoomToken });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message', 'Successfully joined room');
      expect(response.body).toHaveProperty('room_id', mockRoomId);
    });

    it('should block joining ended rooms', async () => {
      // Mock room search returns ended room
      mockedQuery.mockResolvedValueOnce({
        rows: [{ id: mockRoomId, status: 'ended' }]
      } as any);

      const response = await request(app)
        .post('/api/rooms/join')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ room_token: mockRoomToken });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'This ride room has already ended');
    });

    it('should return 404 for invalid token', async () => {
      // Mock room lookup returns empty set
      mockedQuery.mockResolvedValueOnce({ rows: [] } as any);

      const response = await request(app)
        .post('/api/rooms/join')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ room_token: 'INVALID' });

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'Ride room not found');
    });
  });

  describe('GET /api/rooms/:roomId/history (Room Access Isolation)', () => {
    const telemetryHistory = [
      { user_id: mockUser.id, username: mockUser.username, device_timestamp: 1234567, latitude: 12, longitude: 34, accuracy: 5, speed: 10 }
    ];

    it('should allow room history access for active room members', async () => {
      // 1. Mock member authorization check succeeds
      mockedQuery.mockResolvedValueOnce({ rows: [{ 1: 1 }] } as any);
      // 2. Mock telemetry history lookup
      mockedQuery.mockResolvedValueOnce({ rows: telemetryHistory } as any);

      const response = await request(app)
        .get(`/api/rooms/${mockRoomId}/history`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(telemetryHistory);
      expect(mockedQuery).toHaveBeenCalledTimes(2);
    });

    it('MANDATORY SECURITY PROOF: should forbid history access for non-members of the room', async () => {
      // Mock member authorization check returns empty set (non-member)
      mockedQuery.mockResolvedValueOnce({ rows: [] } as any);

      const response = await request(app)
        .get(`/api/rooms/${mockRoomId}/history`)
        .set('Authorization', `Bearer ${nonMemberToken}`);

      // Expect a 403 Forbidden response to prevent cross-room data leakage
      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Forbidden: You are not a member of this ride room');
      
      // Ensure it stops checking and never queries the telemetry readings table
      expect(mockedQuery).toHaveBeenCalledTimes(1);
    });
  });
});
