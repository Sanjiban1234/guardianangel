import { QueryRunner } from '../src/db/QueryRunner';
import { RoomService } from '../src/services/RoomService';
import { PresenceService } from '../src/services/PresenceService';
import { GroupCoherenceService } from '../src/services/GroupCoherenceService';
import { RidePauseHandler } from '../src/handlers/RidePauseHandler';

describe('Temporary Pause Feature Backend Tests', () => {
  const groupCode = 'PAUSE1234567';
  const riderId = 'user-rider-1';
  const riderName = 'Test Rider';

  describe('RoomService pauseRider and resumeRider', () => {
    it('allows an active rider to pause after ride has started', async () => {
      const mockQuery = jest
        .fn()
        // 1. SELECT check: active room and ride_started_at present
        .mockResolvedValueOnce({ rows: [{ id: 'room-1', ride_started_at: '2026-09-01T00:00:00Z' }] })
        // 2. UPDATE room_members SET ride_state = 'paused'
        .mockResolvedValueOnce({ rows: [{ user_id: riderId }] });

      const roomService = new RoomService(new QueryRunner(mockQuery));
      const result = await roomService.pauseRider(groupCode, riderId);
      expect(result).toBe(true);
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery.mock.calls[1][0]).toContain("SET ride_state = 'paused'");
    });

    it('rejects pause if the ride has not started yet', async () => {
      const mockQuery = jest
        .fn()
        // SELECT check: ride_started_at is NULL
        .mockResolvedValueOnce({ rows: [{ id: 'room-1', ride_started_at: null }] });

      const roomService = new RoomService(new QueryRunner(mockQuery));
      const result = await roomService.pauseRider(groupCode, riderId);
      expect(result).toBe(false);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('allows a paused rider to resume', async () => {
      const mockQuery = jest
        .fn()
        // UPDATE room_members SET ride_state = 'active'
        .mockResolvedValueOnce({ rows: [{ user_id: riderId }] });

      const roomService = new RoomService(new QueryRunner(mockQuery));
      const result = await roomService.resumeRider(groupCode, riderId);
      expect(result).toBe(true);
      expect(mockQuery.mock.calls[0][0]).toContain("SET ride_state = 'active'");
    });
  });

  describe('PresenceService ride_state integration', () => {
    it('returns ride_state from database in getRiderPresence', async () => {
      const mockQuery = jest.fn().mockResolvedValue({
        rows: [
          {
            user_id: riderId,
            name: riderName,
            role: 'member',
            vehicle_model: 'Ninja 400',
            plate_number: 'BA-1234',
            ride_state: 'paused',
            latitude: 28.2,
            longitude: 83.9,
            accuracy: 10,
            speed: 0,
            device_timestamp: 1720000000000,
            last_updated_at: Date.now(),
            has_active_breakdown: false,
          },
        ],
      });

      const presenceService = new PresenceService(new QueryRunner(mockQuery));
      const presence = await presenceService.getRiderPresence(groupCode);
      expect(presence).toHaveLength(1);
      expect(presence[0].ride_state).toBe('paused');
    });
  });

  describe('GroupCoherenceService exclusion of paused riders', () => {
    it('excludes paused riders from group separation calculation', async () => {
      const now = Date.now();
      const mockPresenceService = {
        getRiderPresence: jest.fn().mockResolvedValue([
          {
            user_id: 'rider-1',
            name: 'Active Rider 1',
            connection_state: 'CONNECTED',
            location_freshness: 'FRESH',
            ride_state: 'active',
            latitude: 28.2,
            longitude: 83.9,
            speed: 15,
            last_updated_at: now,
          },
          {
            user_id: 'rider-2',
            name: 'Paused Rider 2',
            connection_state: 'CONNECTED',
            location_freshness: 'FRESH',
            ride_state: 'paused', // PAUSED
            latitude: 28.3, // Far away (10+ km)
            longitude: 84.0,
            speed: 0,
            last_updated_at: now,
          },
        ]),
      } as any;

      const coherenceService = new GroupCoherenceService(mockPresenceService);
      const result = await coherenceService.evaluateRoomCoherence(groupCode, now);
      // Because rider-2 is paused, riders length evaluated is 1 (< 2), so no separation alert is generated
      expect(result.alerts).toHaveLength(0);
    });

    it('resets coherence state when rider resumes', () => {
      const mockPresenceService = {} as any;
      const coherenceService = new GroupCoherenceService(mockPresenceService);
      expect(() => coherenceService.resetRiderState(groupCode, riderId)).not.toThrow();
    });
  });

  describe('RidePauseHandler socket interactions', () => {
    let mockIo: any;
    let mockSocket: any;
    let mockRoomState: any;
    let mockRoomService: any;
    let mockCoherenceService: any;

    beforeEach(() => {
      mockIo = {
        to: jest.fn().mockReturnValue({
          emit: jest.fn(),
        }),
      };
      mockSocket = {
        user: { id: riderId, name: riderName },
        on: jest.fn(),
      };
      mockRoomState = { currentGroupCode: groupCode };
      mockRoomService = {
        pauseRider: jest.fn(),
        resumeRider: jest.fn(),
      };
      mockCoherenceService = {
        resetRiderState: jest.fn(),
      };
    });

    it('handles ride:pause successfully', async () => {
      mockRoomService.pauseRider.mockResolvedValue(true);
      const handler = new RidePauseHandler(mockIo, mockSocket, mockRoomState, mockRoomService, mockCoherenceService);

      handler.register();
      const pauseCallback = mockSocket.on.mock.calls.find((c: any) => c[0] === 'ride:pause')[1];

      const ack = jest.fn();
      await pauseCallback({ group_code: groupCode }, ack);

      expect(mockRoomService.pauseRider).toHaveBeenCalledWith(groupCode, riderId);
      expect(mockIo.to).toHaveBeenCalledWith(`group:${groupCode}`);
      expect(ack).toHaveBeenCalledWith(expect.objectContaining({ success: true, user_id: riderId }));
    });

    it('handles ride:resume successfully and resets coherence', async () => {
      mockRoomService.resumeRider.mockResolvedValue(true);
      const handler = new RidePauseHandler(mockIo, mockSocket, mockRoomState, mockRoomService, mockCoherenceService);

      handler.register();
      const resumeCallback = mockSocket.on.mock.calls.find((c: any) => c[0] === 'ride:resume')[1];

      const ack = jest.fn();
      await resumeCallback({ group_code: groupCode }, ack);

      expect(mockRoomService.resumeRider).toHaveBeenCalledWith(groupCode, riderId);
      expect(mockCoherenceService.resetRiderState).toHaveBeenCalledWith(groupCode, riderId);
      expect(mockIo.to).toHaveBeenCalledWith(`group:${groupCode}`);
      expect(ack).toHaveBeenCalledWith(expect.objectContaining({ success: true, user_id: riderId }));
    });
  });
});
