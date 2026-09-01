import { QueryRunner } from '../src/db/QueryRunner';
import { GuardianPortalShareError, GuardianPortalShareService } from '../src/services/GuardianPortalShareService';

describe('Guardian Portal shares', () => {
  it('creates a high-entropy fragment-only URL and stores only its hash', async () => {
    const query = jest.fn().mockResolvedValueOnce({ rows: [{ id: 'room-1' }] }).mockResolvedValueOnce({ rows: [] });
    const service = new GuardianPortalShareService(new QueryRunner(query));
    const share = await service.create('rider-1', 'GROUP123');
    expect(share.url).toMatch(/\/watch#[A-Za-z0-9_-]{32,}$/);
    const token = share.url.split('#')[1];
    expect(JSON.stringify(query.mock.calls[1])).not.toContain(token);
    expect(query.mock.calls[1][1][2]).toMatch(/^[a-f0-9]{64}$/);
  });
  it('rejects creation when the caller is not on a started active ride', async () => {
    const service = new GuardianPortalShareService(new QueryRunner(jest.fn().mockResolvedValue({ rows: [] })));
    await expect(service.create('rider-1', 'GROUP123')).rejects.toEqual(expect.objectContaining<Partial<GuardianPortalShareError>>({ code: 'NOT_ACTIVE_RIDER' }));
  });
  it('returns no live location for an ended ride', async () => {
    const service = new GuardianPortalShareService(new QueryRunner(jest.fn().mockResolvedValue({ rows: [{ share_id:'share-1', room_id:'room-1', owner_user_id:'rider-1', expires_at:new Date(Date.now()+60_000).toISOString(), revoked_at:null, separation_state:'reunited', status:'ended', ride_started_at:new Date().toISOString(), ended_at:new Date().toISOString(), name:'Rider' }] })));
    await expect(service.bootstrap('a'.repeat(43))).resolves.toMatchObject({ rideStatus:'ended', separationState:'reunited' });
  });
});
