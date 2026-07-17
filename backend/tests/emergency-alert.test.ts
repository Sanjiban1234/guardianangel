import { EmergencyAlertService } from '../src/services/EmergencyAlertService';
import { QueryRunner } from '../src/db/QueryRunner';

describe('EmergencyAlertService', () => {
  let service: EmergencyAlertService;
  let mockQueryFn: jest.Mock;

  const userId = 'user-uuid-001';
  const groupCode = 'RIDE11ABCDEF1234';

  beforeEach(() => {
    mockQueryFn = jest.fn();
    const queryRunner = new QueryRunner(mockQueryFn);
    service = new EmergencyAlertService(queryRunner);
  });

  it('should create an alert with room_id when ride_rooms lookup succeeds', async () => {
    const roomId = 'room-uuid-001';

    mockQueryFn
      .mockResolvedValueOnce({ rows: [{ id: roomId }] })
      .mockResolvedValueOnce({
        rows: [{
          alarm_no: 'alarm-uuid-001',
          correlation_id: 'corr-uuid-001',
          join_check_timestamp: '2026-07-17T00:00:00Z',
          status: 'active',
        }],
      });

    const alert = await service.createAlert(groupCode, userId, 1720958400000, 28.2096, 83.9856);

    expect(alert.alarm_no).toBe('alarm-uuid-001');
    expect(alert.status).toBe('active');

    const insertParams = mockQueryFn.mock.calls[1][1];
    expect(insertParams[1]).toBe(roomId);
  });

  it('should still create an alert with room_id=null when ride_rooms lookup fails (stale/ended room)', async () => {
    // ride_rooms lookup returns no rows (ended room, stale token, bad data)
    mockQueryFn
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          alarm_no: 'alarm-uuid-002',
          correlation_id: 'corr-uuid-002',
          join_check_timestamp: '2026-07-17T00:00:00Z',
          status: 'active',
        }],
      });

    const alert = await service.createAlert(groupCode, userId, 1720958400000, 28.2096, 83.9856);

    // Alert is still created — SOS should never be blocked
    expect(alert.alarm_no).toBe('alarm-uuid-002');
    expect(alert.status).toBe('active');

    // room_id param is null
    const insertParams = mockQueryFn.mock.calls[1][1];
    expect(insertParams[1]).toBeNull();
  });

  it('should skip token_hash lookup when roomId is passed directly', async () => {
    const roomId = 'room-uuid-direct';

    mockQueryFn.mockResolvedValueOnce({
      rows: [{
        alarm_no: 'alarm-uuid-003',
        correlation_id: 'corr-uuid-003',
        join_check_timestamp: '2026-07-17T00:00:00Z',
        status: 'active',
      }],
    });

    const alert = await service.createAlert(groupCode, userId, 1720958400000, 28.2096, 83.9856, roomId);

    expect(alert.alarm_no).toBe('alarm-uuid-003');
    // Only one DB call — the INSERT. No ride_rooms lookup.
    expect(mockQueryFn).toHaveBeenCalledTimes(1);
    expect(mockQueryFn.mock.calls[0][1][1]).toBe(roomId);
  });

  it('should skip token_hash lookup when roomId is explicitly null (race case)', async () => {
    mockQueryFn.mockResolvedValueOnce({
      rows: [{
        alarm_no: 'alarm-uuid-004',
        correlation_id: 'corr-uuid-004',
        join_check_timestamp: '2026-07-17T00:00:00Z',
        status: 'active',
      }],
    });

    const alert = await service.createAlert(groupCode, userId, 1720958400000, 28.2096, 83.9856, null);

    expect(alert.alarm_no).toBe('alarm-uuid-004');
    // Only one DB call — the INSERT, no lookup
    expect(mockQueryFn).toHaveBeenCalledTimes(1);
    expect(mockQueryFn.mock.calls[0][1][1]).toBeNull();
  });

  it('should resolve an active alert', async () => {
    mockQueryFn.mockResolvedValueOnce({ rows: [] });

    await service.resolveAlert('alarm-uuid-001');

    expect(mockQueryFn).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'resolved'"),
      ['alarm-uuid-001']
    );
  });
});
