import { Server } from 'socket.io';
import { CrashHandler } from '../src/handlers/CrashHandler';
import { EmergencyAlertService } from '../src/services/EmergencyAlertService';
import { CrashCandidateRepository } from '../src/repositories/CrashCandidateRepository';
import { QueryRunner } from '../src/db/QueryRunner';
import { RoomState } from '../src/handlers/SessionHandler';

describe('CrashHandler race condition: room ended mid-countdown', () => {
  let mockQueryFn: jest.Mock;
  let crashRepo: CrashCandidateRepository;
  let alertService: EmergencyAlertService;
  let handler: CrashHandler;
  let mockSocket: any;
  let mockIo: any;
  let roomState: RoomState;
  let emittedEvents: Array<{ event: string; data: any }>;

  const userId = 'user-uuid-race-1';
  const userName = 'rider_race';
  const groupCode = 'RACEGROUP1234ABCD';
  const roomId = 'room-uuid-race-1';
  const candidateId = 'candidate-uuid-race-1';

  beforeEach(() => {
    mockQueryFn = jest.fn();
    const queryRunner = new QueryRunner(mockQueryFn);
    crashRepo = new CrashCandidateRepository(queryRunner);
    alertService = new EmergencyAlertService(queryRunner);

    emittedEvents = [];

    const mockRoomEmitter = {
      emit: (event: string, data: any) => {
        emittedEvents.push({ event, data });
      },
    };

    mockIo = {
      to: jest.fn().mockReturnValue(mockRoomEmitter),
    };

    mockSocket = {
      user: { id: userId, name: userName },
      on: jest.fn(),
    };

    roomState = { currentGroupCode: groupCode };

    handler = new CrashHandler(
      mockIo as unknown as Server,
      mockSocket,
      roomState,
      alertService,
      crashRepo
    );
  });

  it('should mark outcome confirmed AND broadcast SOS even when room status flipped to ended', async () => {
    // Scenario:
    // 1. crash:candidate was received when room was active (candidate inserted with room_id)
    // 2. Between candidate and countdownExpired, someone ends the room
    // 3. resolveRoomId now returns null (status = 'ended')
    // 4. Despite that, outcome MUST still be set to 'confirmed' and SOS MUST broadcast

    // Register handlers to capture the callback
    handler.register();
    const countdownExpiredHandler = mockSocket.on.mock.calls.find(
      (call: any[]) => call[0] === 'crash:countdownExpired'
    )[1];

    // Mock sequence for handleCountdownExpired:
    // 1. resolveRoomId → returns null (room is now 'ended')
    mockQueryFn.mockResolvedValueOnce({ rows: [] });

    // 2. findLatestForUserByGroupCode (fallback path) → finds the candidate
    //    that was inserted when room was still active
    mockQueryFn.mockResolvedValueOnce({
      rows: [{
        id: candidateId,
        room_id: roomId,
        user_id: userId,
        device_timestamp_ms: 1720958400000,
        latitude: 28.2096,
        longitude: 83.9856,
        speed: 18.5,
        speed_reading_timestamp_ms: 1720958399000,
        outcome: null,
        created_at: '2026-07-17T00:00:00Z',
      }],
    });

    // 3. updateOutcome (set confirmed)
    mockQueryFn.mockResolvedValueOnce({ rows: [] });

    // 4. createAlert — roomId param is null, so it does its own lookup (also returns empty)
    //    then inserts with room_id = null
    mockQueryFn.mockResolvedValueOnce({
      rows: [{
        alarm_no: 'alarm-uuid-race-1',
        correlation_id: 'corr-uuid-race-1',
        join_check_timestamp: '2026-07-17T00:00:00Z',
        status: 'active',
      }],
    });

    // Fire the event
    await countdownExpiredHandler({
      timestamp: 1720958415000,
      latitude: 28.2096,
      longitude: 83.9856,
    });

    // Verify outcome was updated to 'confirmed'
    const updateCall = mockQueryFn.mock.calls[2];
    expect(updateCall[0]).toContain('UPDATE crash_candidates SET outcome');
    expect(updateCall[1]).toEqual(['confirmed', candidateId]);

    // Verify SOS broadcast fired to the correct Socket.IO room
    expect(mockIo.to).toHaveBeenCalledWith(`group:${groupCode}`);
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].event).toBe('sos:broadcast');
    expect(emittedEvents[0].data).toMatchObject({
      alarm_no: 'alarm-uuid-race-1',
      user_id: userId,
      name: userName,
      latitude: 28.2096,
      longitude: 83.9856,
    });

    // Verify createAlert received roomId=null (passed through from handler)
    // The alert INSERT is call index 3
    const alertInsertCall = mockQueryFn.mock.calls[3];
    expect(alertInsertCall[0]).toContain('INSERT INTO emergency_alarms');
    expect(alertInsertCall[1][1]).toBeNull(); // room_id param is null
  });

  it('should mark outcome false_alarm via fallback when room ended before cancel', async () => {
    handler.register();
    const cancelledHandler = mockSocket.on.mock.calls.find(
      (call: any[]) => call[0] === 'crash:cancelled'
    )[1];

    // resolveRoomId → null (room ended)
    mockQueryFn.mockResolvedValueOnce({ rows: [] });

    // findLatestForUserByGroupCode → finds candidate
    mockQueryFn.mockResolvedValueOnce({
      rows: [{
        id: candidateId,
        room_id: roomId,
        user_id: userId,
        device_timestamp_ms: 1720958400000,
        latitude: 28.2096,
        longitude: 83.9856,
        speed: null,
        speed_reading_timestamp_ms: null,
        outcome: null,
        created_at: '2026-07-17T00:00:00Z',
      }],
    });

    // updateOutcome
    mockQueryFn.mockResolvedValueOnce({ rows: [] });

    await cancelledHandler();

    const updateCall = mockQueryFn.mock.calls[2];
    expect(updateCall[0]).toContain('UPDATE crash_candidates SET outcome');
    expect(updateCall[1]).toEqual(['false_alarm', candidateId]);
  });

  it('should still use direct room_id lookup when room is active (normal path)', async () => {
    handler.register();
    const countdownExpiredHandler = mockSocket.on.mock.calls.find(
      (call: any[]) => call[0] === 'crash:countdownExpired'
    )[1];

    // resolveRoomId → returns active room
    mockQueryFn.mockResolvedValueOnce({ rows: [{ id: roomId }] });

    // findLatestForUserInRoom (primary path, not fallback)
    mockQueryFn.mockResolvedValueOnce({
      rows: [{
        id: candidateId,
        room_id: roomId,
        user_id: userId,
        device_timestamp_ms: 1720958400000,
        latitude: 28.2096,
        longitude: 83.9856,
        speed: 20.0,
        speed_reading_timestamp_ms: 1720958399000,
        outcome: null,
        created_at: '2026-07-17T00:00:00Z',
      }],
    });

    // updateOutcome
    mockQueryFn.mockResolvedValueOnce({ rows: [] });

    // createAlert — roomId passed directly, no re-lookup needed
    mockQueryFn.mockResolvedValueOnce({
      rows: [{
        alarm_no: 'alarm-uuid-normal-1',
        correlation_id: 'corr-uuid-normal-1',
        join_check_timestamp: '2026-07-17T00:00:00Z',
        status: 'active',
      }],
    });

    await countdownExpiredHandler({
      timestamp: 1720958415000,
      latitude: 28.2096,
      longitude: 83.9856,
    });

    // findLatestForUserInRoom uses room_id directly
    const findCall = mockQueryFn.mock.calls[1];
    expect(findCall[0]).toContain('WHERE room_id = $1 AND user_id = $2');
    expect(findCall[1]).toEqual([roomId, userId]);

    // createAlert received the resolved roomId (not null)
    const alertInsertCall = mockQueryFn.mock.calls[3];
    expect(alertInsertCall[1][1]).toBe(roomId);

    // Broadcast still fires
    expect(emittedEvents[0].event).toBe('sos:broadcast');
  });
});
