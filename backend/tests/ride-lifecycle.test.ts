import { QueryRunner } from '../src/db/QueryRunner';
import { RoomService } from '../src/services/RoomService';

describe('ride lifecycle authority and membership', () => {
  const groupCode = 'ABCDEF123456';
  const hostId = 'host-id';
  const memberId = 'member-id';

  it('allows only the owner to end an active ride', async () => {
    const hostQuery = jest.fn().mockResolvedValue({ rows: [{ id: 'room-id' }] });
    const hostService = new RoomService(new QueryRunner(hostQuery));
    await expect(hostService.endRoom(groupCode, hostId)).resolves.toBe(true);
    expect(hostQuery.mock.calls[0][0]).toContain("rm.role = 'owner'");
    expect(hostQuery.mock.calls[0][1]).toEqual([expect.any(String), hostId]);

    const memberQuery = jest.fn().mockResolvedValue({ rows: [] });
    const memberService = new RoomService(new QueryRunner(memberQuery));
    await expect(memberService.endRoom(groupCode, memberId)).resolves.toBe(false);
  });

  it('removes an explicit member leave but never permits an owner leave', async () => {
    const memberQuery = jest.fn().mockResolvedValue({ rows: [{ user_id: memberId }] });
    const memberService = new RoomService(new QueryRunner(memberQuery));
    await expect(memberService.leaveRoom(groupCode, memberId)).resolves.toBe(true);
    expect(memberQuery.mock.calls[0][0]).toContain("rm.role <> 'owner'");

    const ownerQuery = jest.fn().mockResolvedValue({ rows: [] });
    const ownerService = new RoomService(new QueryRunner(ownerQuery));
    await expect(ownerService.leaveRoom(groupCode, hostId)).resolves.toBe(false);
  });

  it('returns active membership recovery details only for an active member', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{ role: 'owner', ride_started_at: '2026-08-18T00:00:00Z', destination_latitude: '28.2', destination_longitude: '83.9', destination_label: 'Pokhara' }],
    });
    const service = new RoomService(new QueryRunner(query));
    await expect(service.getActiveMembership(groupCode, hostId)).resolves.toEqual({
      group_code: groupCode,
      role: 'owner',
      rideStartedAt: '2026-08-18T00:00:00Z',
      destination: { latitude: 28.2, longitude: 83.9, label: 'Pokhara' },
    });
    expect(query.mock.calls[0][0]).toContain("rr.status = 'active'");
  });
});
