import { QueryRunner } from '../src/db/QueryRunner';
import { RoomService } from '../src/services/RoomService';
import { RefillNotificationService } from '../src/services/RefillNotificationService';
import { RefillNotificationHandler } from '../src/handlers/RefillNotificationHandler';
import { Server } from 'socket.io';

describe('Ride entry policy and petrol refill notifications', () => {
  const userId = '11111111-1111-1111-1111-111111111111';
  const roomId = '22222222-2222-2222-2222-222222222222';
  const groupCode = 'ABCDEF123456';

  it('creates a destination room with its creator as owner', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ profile_complete: true }] })
      .mockResolvedValueOnce({ rows: [{ id: roomId }] })
      .mockResolvedValueOnce({ rows: [] });
    const service = new RoomService(new QueryRunner(query));
    const result = await service.createRoom(userId, { latitude: 28.2, longitude: 83.9, label: 'Pokhara' });
    expect(result.destination).toEqual({ latitude: 28.2, longitude: 83.9, label: 'Pokhara' });
    expect(query.mock.calls[1][0]).toContain('destination_latitude');
    expect(query.mock.calls[2][1]).toEqual([roomId, userId]);
    expect(query.mock.calls[2][0]).toContain("'owner'");
  });

  it.each([
    ['expired', new Date(Date.now() - 1000).toISOString(), [], 0, 'ROOM_EXPIRED'],
    ['already a member', new Date(Date.now() + 3600000).toISOString(), [{ value: 1 }], 0, 'ALREADY_MEMBER'],
    ['full', new Date(Date.now() + 3600000).toISOString(), [], 20, 'ROOM_FULL'],
  ])('rejects a %s room with a distinct error', async (_caseName, expiresAt, membershipRows, count, code) => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ profile_complete: true }] })
      .mockResolvedValueOnce({ rows: [{ id: roomId, status: 'active', expires_at: expiresAt }] })
      .mockResolvedValueOnce({ rows: membershipRows })
      .mockResolvedValueOnce({ rows: [{ count }] });
    const service = new RoomService(new QueryRunner(query));
    await expect(service.joinRoom(userId, groupCode)).rejects.toMatchObject({ code });
  });

  it('blocks incomplete profiles from creating or joining rooms', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ profile_complete: false }] });
    const service = new RoomService(new QueryRunner(query));
    await expect(service.createRoom(userId, { latitude: 28.2, longitude: 83.9 })).rejects.toMatchObject({ code: 'PROFILE_INCOMPLETE' });
    await expect(service.joinRoom(userId, groupCode)).rejects.toMatchObject({ code: 'PROFILE_INCOMPLETE' });
  });

  it('logs a member refill request and sends FCM only to other riders', async () => {
    const push = { sendRefillPush: jest.fn().mockResolvedValue(undefined) };
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: roomId }] })
      .mockResolvedValueOnce({ rows: [{ id: 'refill-id', room_id: roomId, rider_id: userId, note: 'Need petrol', created_at: '2026-08-13T10:00:00Z' }] })
      .mockResolvedValueOnce({ rows: [{ user_id: 'other-rider' }] });
    const service = new RefillNotificationService(new QueryRunner(query), push as any);
    const record = await service.requestRefill(groupCode, userId, 'Rider', 'Need petrol');
    expect(record.id).toBe('refill-id');
    expect(query.mock.calls[0][0]).toContain('rm.user_id = $2');
    expect(push.sendRefillPush).toHaveBeenCalledWith(['other-rider'], expect.objectContaining({ group_code: groupCode, user_id: userId }));
  });

  it('uses authenticated socket identity and broadcasts refill:notified', async () => {
    const roomEmitter = { emit: jest.fn() };
    const io = { to: jest.fn().mockReturnValue(roomEmitter) };
    const socket: any = { user: { id: userId, name: 'Authenticated Rider' }, on: jest.fn(), emit: jest.fn() };
    const refillService = { requestRefill: jest.fn().mockResolvedValue({ id: 'refill-id', note: 'Fuel', created_at: 1720000000000 }) };
    const handler = new RefillNotificationHandler(io as unknown as Server, socket, refillService as any);
    handler.register();
    const listener = socket.on.mock.calls.find((call: any) => call[0] === 'refill:requested')[1];
    await listener({ group_code: groupCode, user_id: 'spoofed', note: 'Fuel' });
    expect(refillService.requestRefill).toHaveBeenCalledWith(groupCode, userId, 'Authenticated Rider', 'Fuel');
    expect(roomEmitter.emit).toHaveBeenCalledWith('refill:notified', expect.objectContaining({ user_id: userId, name: 'Authenticated Rider' }));
  });
});
