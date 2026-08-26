import request from 'supertest';
import { app } from '../src/index';
import * as db from '../src/db';
import jwt from 'jsonwebtoken';
import { createAuthenticatedTestSession, installTestSessionValidator } from './helpers/auth';
import { QueryRunner } from '../src/db/QueryRunner';
import { MedicalInfoService } from '../src/services/MedicalInfoService';
import { CrashHandler } from '../src/handlers/CrashHandler';
import { VehicleBreakdownHandler } from '../src/handlers/VehicleBreakdownHandler';
import { Server } from 'socket.io';

jest.mock('../src/db', () => ({
  query: jest.fn(),
  pool: {
    connect: jest.fn(),
  },
  initDb: jest.fn().mockResolvedValue(true),
}));

const mockedQuery = db.query as jest.MockedFunction<typeof db.query>;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_change_me_in_production';

describe('Rider Medical ID Module Tests', () => {
  const userId = '22222222-2222-2222-2222-222222222222';
  const userName = 'Medical Rider';
  const groupCode = 'MEDRIDE1234';
  let userToken: string;

  beforeAll(() => {
    installTestSessionValidator();
    userToken = createAuthenticatedTestSession({ id: userId, name: userName, role: 'rider' }).token;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('MedicalInfoService', () => {
    let mockQueryFn: jest.Mock;
    let service: MedicalInfoService;

    beforeEach(() => {
      mockQueryFn = jest.fn();
      const queryRunner = new QueryRunner(mockQueryFn);
      service = new MedicalInfoService(queryRunner);
    });

    it('should upsert medical info with valid data', async () => {
      const mockRow = {
        blood_group: 'O+',
        allergies: 'Peanuts, Penicillin',
        emergency_contact_name: 'John Doe',
        emergency_contact_phone: '+1234567890',
        notes: 'Asthmatic',
        updated_at: '2026-07-31T12:00:00Z',
      };
      mockQueryFn.mockResolvedValueOnce({ rows: [mockRow] });

      const result = await service.upsertMedicalInfo(userId, {
        blood_group: 'O+',
        allergies: 'Peanuts, Penicillin',
        emergency_contact_name: 'John Doe',
        emergency_contact_phone: '+1234567890',
        notes: 'Asthmatic',
      });

      expect(result.blood_group).toBe('O+');
      expect(result.allergies).toBe('Peanuts, Penicillin');
      expect(result.emergency_contact_phone).toBe('+1234567890');
      expect(mockQueryFn).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO medical_info'),
        [userId, 'O+', 'Peanuts, Penicillin', 'John Doe', '+1234567890', 'Asthmatic', false, false]
      );
    });

    it('should reject invalid blood group', async () => {
      await expect(
        service.upsertMedicalInfo(userId, {
          blood_group: 'Z+' as any,
        })
      ).rejects.toThrow('Invalid blood group: Z+');
    });

    it('should reject invalid emergency contact phone format', async () => {
      await expect(
        service.upsertMedicalInfo(userId, {
          emergency_contact_phone: '123-456-7890', // Missing + prefix
        })
      ).rejects.toThrow('Invalid emergency contact phone number');
    });

    it('should fetch medical info for user', async () => {
      const mockRow = {
        blood_group: 'AB-',
        allergies: null,
        emergency_contact_name: 'Jane Smith',
        emergency_contact_phone: '+9876543210',
        notes: null,
        updated_at: '2026-07-31T12:00:00Z',
      };
      mockQueryFn.mockResolvedValueOnce({ rows: [mockRow] });

      const res = await service.getMedicalInfo(userId);

      expect(res).not.toBeNull();
      expect(res?.blood_group).toBe('AB-');
      expect(res?.emergency_contact_name).toBe('Jane Smith');
      expect(res?.allergies).toBeUndefined();
    });

    it('should return null when user has no medical info', async () => {
      mockQueryFn.mockResolvedValueOnce({ rows: [] });

      const res = await service.getMedicalInfo(userId);
      expect(res).toBeNull();
    });

    it('should delete medical info record for user', async () => {
      mockQueryFn.mockResolvedValueOnce({ rows: [{ user_id: userId }] });

      const deleted = await service.deleteMedicalInfo(userId);

      expect(deleted).toBe(true);
      expect(mockQueryFn).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM medical_info'),
        [userId]
      );
    });

    it('should return snapshot for alert payloads', async () => {
      const mockRow = {
        blood_group: 'A+',
        allergies: 'Latex',
        emergency_contact_name: 'Dr. House',
        emergency_contact_phone: '+1122334455',
        notes: 'Diabetic',
        share_medical_during_emergency: true,
        share_emergency_contact_during_emergency: true,
        updated_at: '2026-07-31T12:00:00Z',
      };
      mockQueryFn.mockResolvedValueOnce({ rows: [mockRow] });

      const snapshot = await service.getMedicalInfoSnapshot(userId);

      expect(snapshot).toEqual({
        blood_group: 'A+',
        allergies: 'Latex',
        emergency_contact_name: 'Dr. House',
        emergency_contact_phone: '+1122334455',
      });
    });
  });

  describe('REST Endpoints: /api/users/medical-info', () => {
    it('POST should reject unauthenticated requests (401)', async () => {
      const res = await request(app)
        .post('/api/users/medical-info')
        .send({ blood_group: 'B+' });

      expect(res.status).toBe(401);
    });

    it('POST should reject invalid blood group (400)', async () => {
      const res = await request(app)
        .post('/api/users/medical-info')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ blood_group: 'INVALID' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid blood group');
    });

    it('POST should reject invalid phone format (400)', async () => {
      const res = await request(app)
        .post('/api/users/medical-info')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ emergency_contact_phone: '0123456789' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid emergency contact phone number');
    });

    it('POST should successfully save valid medical info (200)', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [
          {
            blood_group: 'B+',
            allergies: 'Dust',
            emergency_contact_name: 'Mom',
            emergency_contact_phone: '+19998887777',
            notes: null,
            updated_at: '2026-07-31T12:00:00Z',
          },
        ],
      });

      const res = await request(app)
        .post('/api/users/medical-info')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          blood_group: 'B+',
          allergies: 'Dust',
          emergency_contact_name: 'Mom',
          emergency_contact_phone: '+19998887777',
        });

      expect(res.status).toBe(200);
      expect(res.body.medical_info.blood_group).toBe('B+');
    });

    it('GET should return rider medical info (200)', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [
          {
            blood_group: 'B+',
            allergies: 'Dust',
            emergency_contact_name: 'Mom',
            emergency_contact_phone: '+19998887777',
            notes: null,
            updated_at: '2026-07-31T12:00:00Z',
          },
        ],
      });

      const res = await request(app)
        .get('/api/users/medical-info')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.medical_info.blood_group).toBe('B+');
    });

    it('DELETE should delete rider medical info (200)', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [{ user_id: userId }] });

      const res = await request(app)
        .delete('/api/users/medical-info')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('deleted successfully');
    });
  });

  describe('Alert Payload Integration with Medical Info', () => {
    it('CrashHandler should include medical_info snapshot in sos:broadcast', async () => {
      const mockIo: any = {
        to: jest.fn().mockReturnValue({ emit: jest.fn() }),
      };
      const mockSocket: any = {
        user: { id: userId, name: userName },
        on: jest.fn(),
        emit: jest.fn(),
      };
      const mockRoomState = { currentGroupCode: groupCode };
      const mockAlertService: any = {
        createAlert: jest.fn().mockResolvedValue({ alarm_no: 'alarm-uuid-99' }),
      };
      const mockCrashRepo: any = {
        resolveRoomId: jest.fn().mockResolvedValue('room-uuid-1'),
        findLatestForUserInRoom: jest.fn().mockResolvedValue({ id: 'cand-1', outcome: null }),
        getLatestTelemetry: jest.fn().mockResolvedValue(null),
        updateOutcome: jest.fn().mockResolvedValue(undefined),
      };
      const mockMedicalService: any = {
        getMedicalInfoSnapshot: jest.fn().mockResolvedValue({
          blood_group: 'O+',
          allergies: 'Penicillin',
        }),
      };

      const handler = new CrashHandler(
        mockIo as unknown as Server,
        mockSocket,
        mockRoomState,
        mockAlertService,
        mockCrashRepo,
        mockMedicalService
      );
      handler.register();

      const countdownExpiredListener = mockSocket.on.mock.calls.find(
        (c: any) => c[0] === 'crash:countdownExpired'
      )[1];

      await countdownExpiredListener({
        timestamp: Date.now(),
        latitude: 28.2,
        longitude: 83.9,
      });

      expect(mockIo.to).toHaveBeenCalledWith(`group:${groupCode}`);
      expect(mockIo.to(`group:${groupCode}`).emit).toHaveBeenCalledWith(
        'sos:broadcast',
        expect.objectContaining({
          alarm_no: 'alarm-uuid-99',
          user_id: userId,
          medical_info: {
            blood_group: 'O+',
            allergies: 'Penicillin',
          },
        })
      );
    });

    it('VehicleBreakdownHandler should not include medical_info in normal breakdown broadcasts', async () => {
      const mockIo: any = {
        to: jest.fn().mockReturnValue({ emit: jest.fn() }),
      };
      const mockSocket: any = {
        user: { id: userId, name: userName },
        on: jest.fn(),
      };
      const mockRoomState = { currentGroupCode: groupCode };
      const mockBreakdownService: any = {
        reportBreakdown: jest.fn().mockResolvedValue({
          id: 'bd-uuid-55',
          room_id: 'room-1',
          user_id: userId,
          reason: 'flat_tire',
          latitude: 28.2,
          longitude: 83.9,
          reported_at: 1720958400000,
        }),
      };
      const mockMedicalService: any = {
        getMedicalInfoSnapshot: jest.fn().mockResolvedValue({
          blood_group: 'A-',
          emergency_contact_phone: '+1234567890',
        }),
      };

      const handler = new VehicleBreakdownHandler(
        mockIo as unknown as Server,
        mockSocket,
        mockRoomState,
        mockBreakdownService,
        mockMedicalService
      );
      handler.register();

      const breakdownListener = mockSocket.on.mock.calls.find(
        (c: any) => c[0] === 'vehicle:breakdown'
      )[1];

      await breakdownListener({ reason: 'flat_tire' });

      expect(mockIo.to).toHaveBeenCalledWith(`group:${groupCode}`);
      expect(mockIo.to(`group:${groupCode}`).emit).toHaveBeenCalledWith(
        'vehicle:breakdownReported',
        expect.objectContaining({
          breakdown_id: 'bd-uuid-55',
        })
      );
      const payload = mockIo.to(`group:${groupCode}`).emit.mock.calls[0][1];
      expect(payload).not.toHaveProperty('medical_info');
    });
  });
});
