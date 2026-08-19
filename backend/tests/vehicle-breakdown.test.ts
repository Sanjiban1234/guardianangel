import request from 'supertest';
import { app } from '../src/index';
import * as db from '../src/db';
import jwt from 'jsonwebtoken';
import { QueryRunner } from '../src/db/QueryRunner';
import { FcmPushService } from '../src/services/FcmPushService';
import { VehicleBreakdownService } from '../src/services/VehicleBreakdownService';
import { VehicleBreakdownHandler } from '../src/handlers/VehicleBreakdownHandler';
import { GroupCoherenceService } from '../src/services/GroupCoherenceService';
import { PresenceService } from '../src/services/PresenceService';
import { Server } from 'socket.io';
import crypto from 'crypto';

jest.mock('../src/db', () => ({
  query: jest.fn(),
  pool: {
    connect: jest.fn(),
  },
  initDb: jest.fn().mockResolvedValue(true),
}));

const mockedQuery = db.query as jest.MockedFunction<typeof db.query>;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_change_me_in_production';

describe('Vehicle Breakdown Module Tests', () => {
  const userId = '11111111-1111-1111-1111-111111111111';
  const userName = 'Rider Alpha';
  const groupCode = 'BREAKDOWN1234';
  const roomId = 'room-uuid-999';
  let userToken: string;

  beforeAll(() => {
    userToken = jwt.sign({ id: userId, name: userName }, JWT_SECRET);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('REST Endpoint: POST /api/devices/register', () => {
    it('should reject unauthenticated requests (401)', async () => {
      const res = await request(app)
        .post('/api/devices/register')
        .send({ token: 'fcm_token_123', platform: 'android' });

      expect(res.status).toBe(401);
    });

    it('should reject invalid payload (400)', async () => {
      const res1 = await request(app)
        .post('/api/devices/register')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ token: '', platform: 'android' });

      expect(res1.status).toBe(400);

      const res2 = await request(app)
        .post('/api/devices/register')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ token: 'valid_token', platform: 'windows_phone' });

      expect(res2.status).toBe(400);
    });

    it('should successfully register a device token (200)', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/api/devices/register')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ token: 'fcm_token_12345', platform: 'android' });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('registered successfully');
      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO device_tokens'),
        [userId, 'fcm_token_12345', 'android']
      );
    });
  });

  describe('FcmPushService & Isolated Failure', () => {
    it('should upsert device token', async () => {
      const mockQueryFn = jest.fn().mockResolvedValue({ rows: [] });
      const queryRunner = new QueryRunner(mockQueryFn);
      const fcmService = new FcmPushService(queryRunner);

      await fcmService.registerDeviceToken(userId, 'token123', 'ios');
      expect(mockQueryFn).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO device_tokens'),
        [userId, 'token123', 'ios']
      );
    });

    it('should isolate FCM push failures without throwing errors', async () => {
      const mockQueryFn = jest.fn().mockResolvedValue({
        rows: [{ token: 'bad_token_1' }, { token: 'bad_token_2' }],
      });
      const mockFcmSender = {
        sendMulticast: jest.fn().mockRejectedValue(new Error('FCM Network Timeout')),
      };

      const queryRunner = new QueryRunner(mockQueryFn);
      const fcmService = new FcmPushService(queryRunner, mockFcmSender);

      // Must resolve cleanly without throwing
      await expect(
        fcmService.sendBreakdownPush(['user-2', 'user-3'], {
          breakdown_id: 'bd-1',
          user_id: userId,
          name: userName,
          reason: 'flat_tire',
          latitude: 28.2,
          longitude: 83.9,
          reported_at: Date.now(),
        })
      ).resolves.not.toThrow();

      expect(mockFcmSender.sendMulticast).toHaveBeenCalled();
    });
  });

  describe('VehicleBreakdownService', () => {
    let mockQueryFn: jest.Mock;
    let breakdownService: VehicleBreakdownService;
    let mockFcmService: any;

    beforeEach(() => {
      mockQueryFn = jest.fn();
      const queryRunner = new QueryRunner(mockQueryFn);
      mockFcmService = {
        sendBreakdownPush: jest.fn().mockResolvedValue(undefined),
      };
      breakdownService = new VehicleBreakdownService(queryRunner, mockFcmService);
    });

    it('should report a breakdown successfully with location & identity', async () => {
      // 1. room resolution
      mockQueryFn.mockResolvedValueOnce({ rows: [{ id: roomId }] });
      // 2. rider_current_locations lookup
      mockQueryFn.mockResolvedValueOnce({
        rows: [{ latitude: 28.2096, longitude: 83.9856 }],
      });
      // 3. vehicle_breakdowns insert
      mockQueryFn.mockResolvedValueOnce({
        rows: [
          {
            id: 'breakdown-uuid-1',
            room_id: roomId,
            user_id: userId,
            reason: 'flat_tire',
            note: 'Nail in tire',
            latitude: 28.2096,
            longitude: 83.9856,
            reported_at: '2026-07-31T12:00:00Z',
          },
        ],
      });
      // 4. room_members lookup for FCM push
      mockQueryFn.mockResolvedValueOnce({
        rows: [{ user_id: 'user-member-2' }],
      });

      const result = await breakdownService.reportBreakdown(
        groupCode,
        userId,
        userName,
        'flat_tire',
        'Nail in tire'
      );

      expect(result.id).toBe('breakdown-uuid-1');
      expect(result.reason).toBe('flat_tire');
      expect(result.latitude).toBe(28.2096);
      expect(result.longitude).toBe(83.9856);
      expect(mockFcmService.sendBreakdownPush).toHaveBeenCalledWith(
        ['user-member-2'],
        expect.objectContaining({
          breakdown_id: 'breakdown-uuid-1',
          reason: 'flat_tire',
        })
      );
    });

    it('should reject invalid breakdown reasons', async () => {
      // room resolution
      mockQueryFn.mockResolvedValueOnce({ rows: [{ id: roomId }] });

      await expect(
        breakdownService.reportBreakdown(
          groupCode,
          userId,
          userName,
          'engine_explosion' as any
        )
      ).rejects.toThrow('Invalid breakdown reason');
    });

    it('should resolve breakdown and set resolved_at', async () => {
      // 1. room resolution
      mockQueryFn.mockResolvedValueOnce({ rows: [{ id: roomId }] });
      // 2. update query returning resolved row
      const resolvedTime = '2026-07-31T12:05:00Z';
      mockQueryFn.mockResolvedValueOnce({
        rows: [
          {
            id: 'breakdown-uuid-1',
            user_id: userId,
            resolved_at: resolvedTime,
          },
        ],
      });

      const result = await breakdownService.resolveBreakdown(groupCode, userId);

      expect(result.breakdown_id).toBe('breakdown-uuid-1');
      expect(result.user_id).toBe(userId);
      expect(result.resolved_at).toBe(new Date(resolvedTime).getTime());
    });
  });

  describe('VehicleBreakdownHandler (Socket.io Event Handler)', () => {
    let mockIo: any;
    let mockSocket: any;
    let mockRoomState: any;
    let mockBreakdownService: any;
    let handler: VehicleBreakdownHandler;

    beforeEach(() => {
      mockIo = {
        to: jest.fn().mockReturnValue({
          emit: jest.fn(),
        }),
      };
      mockSocket = {
        user: { id: userId, name: userName },
        on: jest.fn(),
        emit: jest.fn(),
      };
      mockRoomState = { currentGroupCode: groupCode };
      mockBreakdownService = {
        reportBreakdown: jest.fn(),
        resolveBreakdown: jest.fn(),
      };

      handler = new VehicleBreakdownHandler(
        mockIo as unknown as Server,
        mockSocket,
        mockRoomState,
        mockBreakdownService
      );
      handler.register();
    });

    it('should process vehicle:breakdown event and broadcast vehicle:breakdownReported', async () => {
      const breakdownPayload = {
        id: 'bd-uuid-10',
        room_id: roomId,
        user_id: userId,
        reason: 'mechanical_failure' as const,
        note: 'Broken chain',
        latitude: 28.209,
        longitude: 83.985,
        reported_at: 1720958400000,
        resolved_at: null,
      };

      mockBreakdownService.reportBreakdown.mockResolvedValueOnce(breakdownPayload);

      // Extract the event listener for vehicle:breakdown
      const breakdownListener = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'vehicle:breakdown'
      )[1];

      await breakdownListener({ reason: 'mechanical_failure', note: 'Broken chain' });

      expect(mockBreakdownService.reportBreakdown).toHaveBeenCalledWith(
        groupCode,
        userId,
        userName,
        'mechanical_failure',
        'Broken chain'
      );
      expect(mockIo.to).toHaveBeenCalledWith(`group:${groupCode}`);
      expect(mockIo.to(`group:${groupCode}`).emit).toHaveBeenCalledWith(
        'vehicle:breakdownReported',
        expect.objectContaining({
          breakdown_id: 'bd-uuid-10',
          user_id: userId,
          name: userName,
          reason: 'mechanical_failure',
          note: 'Broken chain',
        })
      );
    });

    it('should process vehicle:breakdownResolved event and broadcast vehicle:breakdownResolved', async () => {
      mockBreakdownService.resolveBreakdown.mockResolvedValueOnce({
        breakdown_id: 'bd-uuid-10',
        user_id: userId,
        resolved_at: 1720958500000,
      });

      const resolvedListener = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'vehicle:breakdownResolved'
      )[1];

      await resolvedListener();

      expect(mockBreakdownService.resolveBreakdown).toHaveBeenCalledWith(
        groupCode,
        userId
      );
      expect(mockIo.to).toHaveBeenCalledWith(`group:${groupCode}`);
      expect(mockIo.to(`group:${groupCode}`).emit).toHaveBeenCalledWith(
        'vehicle:breakdownResolved',
        {
          breakdown_id: 'bd-uuid-10',
          user_id: userId,
          name: userName,
          resolved_at: 1720958500000,
        }
      );
    });
  });

  describe('GroupCoherenceService Breakdown Interaction', () => {
    it('should suppress generic separation alert when separated rider has an active breakdown', async () => {
      const mockQueryFn = jest.fn();
      const queryRunner = new QueryRunner(mockQueryFn);
      const coherenceService = new GroupCoherenceService(new PresenceService(queryRunner));

      const tokenHash = crypto
        .createHash('sha256')
        .update(groupCode.toUpperCase())
        .digest('hex');

      // Rider 1 (separated, but has breakdown) and Rider 2
      mockQueryFn.mockResolvedValueOnce({
        rows: [
          {
            user_id: 'user-separated',
            name: 'Broken Rider',
            latitude: '28.2000',
            longitude: '83.9000',
            speed: '0.0',
            timestamp: '1720958400000',
            has_active_breakdown: true,
          },
          {
            user_id: 'user-group',
            name: 'Group Rider',
            latitude: '28.2100',
            longitude: '83.9900',
            speed: '15.0',
            timestamp: '1720958400000',
            has_active_breakdown: false,
          },
        ],
      });

      const now = Date.now();
      // First evaluation to initialize separation tracking
      await coherenceService.evaluateRoomCoherence(groupCode, now - 35000);

      // Second evaluation after duration elapsed
      mockQueryFn.mockResolvedValueOnce({
        rows: [
          {
            user_id: 'user-separated',
            name: 'Broken Rider',
            latitude: '28.2000',
            longitude: '83.9000',
            speed: '0.0',
            timestamp: String(now),
            has_active_breakdown: true,
          },
          {
            user_id: 'user-group',
            name: 'Group Rider',
            latitude: '28.2100',
            longitude: '83.9900',
            speed: '15.0',
            timestamp: String(now),
            has_active_breakdown: false,
          },
        ],
      });

      const result = await coherenceService.evaluateRoomCoherence(groupCode, now);

      // Generic separation alert should be suppressed for user-separated
      expect(result.alerts).toHaveLength(0);
    });
  });
});
