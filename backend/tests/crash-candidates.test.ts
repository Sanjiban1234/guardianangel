import { CrashCandidateRepository } from '../src/repositories/CrashCandidateRepository';
import { QueryRunner } from '../src/db/QueryRunner';
import crypto from 'crypto';

describe('CrashCandidateRepository', () => {
  let repo: CrashCandidateRepository;
  let mockQueryFn: jest.Mock;

  const roomId = 'room-uuid-001';
  const userId = 'user-uuid-001';
  const groupCode = 'RIDE11ABCDEF1234';
  const tokenHash = crypto.createHash('sha256').update(groupCode.toUpperCase()).digest('hex');

  beforeEach(() => {
    mockQueryFn = jest.fn();
    const queryRunner = new QueryRunner(mockQueryFn);
    repo = new CrashCandidateRepository(queryRunner);
  });

  describe('resolveRoomId', () => {
    it('should resolve room_id from group code', async () => {
      mockQueryFn.mockResolvedValueOnce({ rows: [{ id: roomId }] });

      const result = await repo.resolveRoomId(groupCode);

      expect(result).toBe(roomId);
      expect(mockQueryFn).toHaveBeenCalledWith(
        expect.stringContaining('ride_rooms'),
        [tokenHash]
      );
    });

    it('should return null when no active room matches', async () => {
      mockQueryFn.mockResolvedValueOnce({ rows: [] });

      const result = await repo.resolveRoomId(groupCode);

      expect(result).toBeNull();
    });
  });

  describe('insert', () => {
    it('should insert a candidate with speed from rider_current_locations', async () => {
      const candidateId = 'candidate-uuid-001';
      const now = new Date().toISOString();

      // rider_current_locations lookup returns speed
      mockQueryFn.mockResolvedValueOnce({
        rows: [{ speed: 17.2, device_timestamp_ms: '1720958399000' }],
      });
      // INSERT returns the row
      mockQueryFn.mockResolvedValueOnce({
        rows: [{
          id: candidateId,
          room_id: roomId,
          user_id: userId,
          device_timestamp_ms: 1720958400000,
          latitude: 28.2096,
          longitude: 83.9856,
          speed: 17.2,
          speed_reading_timestamp_ms: 1720958399000,
          outcome: null,
          created_at: now,
        }],
      });

      const result = await repo.insert(roomId, userId, 1720958400000, 28.2096, 83.9856);

      expect(result.id).toBe(candidateId);
      expect(result.speed).toBe(17.2);
      expect(result.speed_reading_timestamp_ms).toBe(1720958399000);
      expect(result.outcome).toBeNull();

      // Verify telemetry lookup was scoped to room+user
      const [telemetryQuery, telemetryParams] = mockQueryFn.mock.calls[0];
      expect(telemetryQuery).toContain('rider_current_locations');
      expect(telemetryParams).toEqual([roomId, userId]);

      // Verify insert params include speed and reading timestamp
      const insertParams = mockQueryFn.mock.calls[1][1];
      expect(insertParams[5]).toBe(17.2);
      expect(insertParams[6]).toBe(1720958399000);
    });

    it('should insert with null speed when no telemetry exists', async () => {
      const candidateId = 'candidate-uuid-002';
      const now = new Date().toISOString();

      // No current location data
      mockQueryFn.mockResolvedValueOnce({ rows: [] });
      // INSERT
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
          created_at: now,
        }],
      });

      const result = await repo.insert(roomId, userId, 1720958400000, 28.2096, 83.9856);

      expect(result.speed).toBeNull();
      expect(result.speed_reading_timestamp_ms).toBeNull();
    });

    it('should skip telemetry lookup when roomId is null', async () => {
      const candidateId = 'candidate-uuid-003';
      const now = new Date().toISOString();

      // Only one call: the INSERT (no telemetry lookup)
      mockQueryFn.mockResolvedValueOnce({
        rows: [{
          id: candidateId,
          room_id: null,
          user_id: userId,
          device_timestamp_ms: 1720958400000,
          latitude: 28.2096,
          longitude: 83.9856,
          speed: null,
          speed_reading_timestamp_ms: null,
          outcome: null,
          created_at: now,
        }],
      });

      const result = await repo.insert(null, userId, 1720958400000, 28.2096, 83.9856);

      expect(result.speed).toBeNull();
      expect(mockQueryFn).toHaveBeenCalledTimes(1); // only the INSERT
    });
  });

  describe('outcome transitions', () => {
    it('should transition outcome from null to confirmed', async () => {
      const candidateId = 'candidate-uuid-010';
      mockQueryFn.mockResolvedValueOnce({ rows: [] });

      await repo.updateOutcome(candidateId, 'confirmed');

      expect(mockQueryFn).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE crash_candidates SET outcome'),
        ['confirmed', candidateId]
      );
    });

    it('should transition outcome from null to false_alarm', async () => {
      const candidateId = 'candidate-uuid-011';
      mockQueryFn.mockResolvedValueOnce({ rows: [] });

      await repo.updateOutcome(candidateId, 'false_alarm');

      expect(mockQueryFn).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE crash_candidates SET outcome'),
        ['false_alarm', candidateId]
      );
    });
  });

  describe('findLatestForUserInRoom', () => {
    it('should return the latest candidate scoped to room_id and user_id', async () => {
      const candidateId = 'candidate-uuid-020';
      const now = new Date().toISOString();

      mockQueryFn.mockResolvedValueOnce({
        rows: [{
          id: candidateId,
          room_id: roomId,
          user_id: userId,
          device_timestamp_ms: 1720958400000,
          latitude: 28.2096,
          longitude: 83.9856,
          speed: 16.7,
          speed_reading_timestamp_ms: 1720958399000,
          outcome: null,
          created_at: now,
        }],
      });

      const result = await repo.findLatestForUserInRoom(roomId, userId);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(candidateId);
      // Verify query uses room_id directly, not token_hash
      const [query, params] = mockQueryFn.mock.calls[0];
      expect(query).toContain('WHERE room_id = $1 AND user_id = $2');
      expect(params).toEqual([roomId, userId]);
    });

    it('should return null when no candidates exist for this room+user', async () => {
      mockQueryFn.mockResolvedValueOnce({ rows: [] });

      const result = await repo.findLatestForUserInRoom(roomId, userId);

      expect(result).toBeNull();
    });

    it('should NOT match candidates from a different room', async () => {
      const otherRoomId = 'room-uuid-999';
      mockQueryFn.mockResolvedValueOnce({ rows: [] });

      const result = await repo.findLatestForUserInRoom(otherRoomId, userId);

      expect(result).toBeNull();
      expect(mockQueryFn.mock.calls[0][1]).toEqual([otherRoomId, userId]);
    });
  });

  describe('full lifecycle', () => {
    it('insert → findLatest → confirm → verify outcome', async () => {
      const candidateId = 'candidate-uuid-030';
      const now = new Date().toISOString();

      // Insert: telemetry lookup + INSERT
      mockQueryFn
        .mockResolvedValueOnce({ rows: [{ speed: 22.1, device_timestamp_ms: '1720958498000' }] })
        .mockResolvedValueOnce({
          rows: [{
            id: candidateId, room_id: roomId, user_id: userId,
            device_timestamp_ms: 1720958500000,
            latitude: 28.21, longitude: 83.99,
            speed: 22.1, speed_reading_timestamp_ms: 1720958498000,
            outcome: null, created_at: now,
          }],
        });

      const inserted = await repo.insert(roomId, userId, 1720958500000, 28.21, 83.99);
      expect(inserted.outcome).toBeNull();
      expect(inserted.speed).toBe(22.1);

      // Find latest in room
      mockQueryFn.mockResolvedValueOnce({
        rows: [{
          id: candidateId, room_id: roomId, user_id: userId,
          device_timestamp_ms: 1720958500000,
          latitude: 28.21, longitude: 83.99,
          speed: 22.1, speed_reading_timestamp_ms: 1720958498000,
          outcome: null, created_at: now,
        }],
      });

      const found = await repo.findLatestForUserInRoom(roomId, userId);
      expect(found!.id).toBe(candidateId);

      // Update to confirmed
      mockQueryFn.mockResolvedValueOnce({ rows: [] });
      await repo.updateOutcome(found!.id, 'confirmed');

      // Verify via findById
      mockQueryFn.mockResolvedValueOnce({
        rows: [{
          id: candidateId, room_id: roomId, user_id: userId,
          device_timestamp_ms: 1720958500000,
          latitude: 28.21, longitude: 83.99,
          speed: 22.1, speed_reading_timestamp_ms: 1720958498000,
          outcome: 'confirmed', created_at: now,
        }],
      });

      const verified = await repo.findById(candidateId);
      expect(verified!.outcome).toBe('confirmed');
    });

    it('insert → cancel → verify false_alarm', async () => {
      const candidateId = 'candidate-uuid-031';
      const now = new Date().toISOString();

      // Insert: no telemetry
      mockQueryFn
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{
            id: candidateId, room_id: roomId, user_id: userId,
            device_timestamp_ms: 1720958600000,
            latitude: 28.22, longitude: 84.0,
            speed: null, speed_reading_timestamp_ms: null,
            outcome: null, created_at: now,
          }],
        });

      const inserted = await repo.insert(roomId, userId, 1720958600000, 28.22, 84.0);
      expect(inserted.outcome).toBeNull();

      // Find latest
      mockQueryFn.mockResolvedValueOnce({
        rows: [{
          id: candidateId, room_id: roomId, user_id: userId,
          device_timestamp_ms: 1720958600000,
          latitude: 28.22, longitude: 84.0,
          speed: null, speed_reading_timestamp_ms: null,
          outcome: null, created_at: now,
        }],
      });

      const found = await repo.findLatestForUserInRoom(roomId, userId);
      expect(found!.outcome).toBeNull();

      // Mark as false_alarm (cancel path)
      mockQueryFn.mockResolvedValueOnce({ rows: [] });
      await repo.updateOutcome(found!.id, 'false_alarm');

      // Verify
      mockQueryFn.mockResolvedValueOnce({
        rows: [{
          id: candidateId, room_id: roomId, user_id: userId,
          device_timestamp_ms: 1720958600000,
          latitude: 28.22, longitude: 84.0,
          speed: null, speed_reading_timestamp_ms: null,
          outcome: 'false_alarm', created_at: now,
        }],
      });

      const verified = await repo.findById(candidateId);
      expect(verified!.outcome).toBe('false_alarm');
    });
  });

  describe('cancel no-op safety (handleCancelled guard logic)', () => {
    it('should no-op when no candidate exists for the user in this room', async () => {
      mockQueryFn.mockResolvedValueOnce({ rows: [] });

      const latest = await repo.findLatestForUserInRoom(roomId, userId);
      expect(latest).toBeNull();

      // Simulating the handler guard: if (latest && latest.outcome === null)
      // This must not throw or call updateOutcome
      if (latest && latest.outcome === null) {
        await repo.updateOutcome(latest.id, 'false_alarm');
      }

      // Only the findLatest query was called, no UPDATE
      expect(mockQueryFn).toHaveBeenCalledTimes(1);
    });

    it('should no-op when the latest candidate is already confirmed', async () => {
      const candidateId = 'candidate-uuid-040';
      const now = new Date().toISOString();

      mockQueryFn.mockResolvedValueOnce({
        rows: [{
          id: candidateId, room_id: roomId, user_id: userId,
          device_timestamp_ms: 1720958700000,
          latitude: 28.23, longitude: 84.01,
          speed: 20.0, speed_reading_timestamp_ms: 1720958699000,
          outcome: 'confirmed',
          created_at: now,
        }],
      });

      const latest = await repo.findLatestForUserInRoom(roomId, userId);
      expect(latest).not.toBeNull();
      expect(latest!.outcome).toBe('confirmed');

      // Simulating the handler guard: outcome !== null, so skip
      if (latest && latest.outcome === null) {
        await repo.updateOutcome(latest.id, 'false_alarm');
      }

      // Only the findLatest query was called, no UPDATE
      expect(mockQueryFn).toHaveBeenCalledTimes(1);
    });

    it('should no-op when the latest candidate is already false_alarm (duplicate cancel)', async () => {
      const candidateId = 'candidate-uuid-041';
      const now = new Date().toISOString();

      mockQueryFn.mockResolvedValueOnce({
        rows: [{
          id: candidateId, room_id: roomId, user_id: userId,
          device_timestamp_ms: 1720958800000,
          latitude: 28.24, longitude: 84.02,
          speed: null, speed_reading_timestamp_ms: null,
          outcome: 'false_alarm',
          created_at: now,
        }],
      });

      const latest = await repo.findLatestForUserInRoom(roomId, userId);
      expect(latest!.outcome).toBe('false_alarm');

      if (latest && latest.outcome === null) {
        await repo.updateOutcome(latest.id, 'false_alarm');
      }

      expect(mockQueryFn).toHaveBeenCalledTimes(1);
    });
  });
});
