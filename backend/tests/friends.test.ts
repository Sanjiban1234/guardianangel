import { FriendService } from '../src/services/FriendService';
import { RideInvitationService } from '../src/services/RideInvitationService';

const runner = (responses: any[]) => ({ run: jest.fn(async () => responses.shift() || { rows: [] }) }) as any;

describe('Friends service regression coverage', () => {
  it('normalizes user-selected handles and rejects invalid/reserved handles', () => {
    expect(FriendService.normalizeUsername('  Rider_Name  ')).toBe('rider_name');
    for (const value of ['ab', 'bad-name', 'admin', '1rider', '']) {
      expect(() => FriendService.normalizeUsername(value)).toThrow();
    }
  });

  it('sets a normalized username and surfaces database uniqueness conflicts', async () => {
    const db = runner([{ rows: [{ username: 'rider_name' }] }]);
    await expect(new FriendService(db).setUsername('user-a', ' Rider_Name ')).resolves.toBe('rider_name');
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining('UPDATE users SET username'), ['rider_name', 'user-a']);
    const duplicate = runner([{ rows: [] }]); duplicate.run.mockRejectedValueOnce({ code: '23505' });
    await expect(new FriendService(duplicate).setUsername('user-a', 'taken_name')).rejects.toMatchObject({ code: 'USERNAME_TAKEN' });
  });

  it('searches only public username identity and preserves null legacy usernames outside results', async () => {
    const db = runner([{ rows: [{ userId: 'user-b', displayName: 'B Rider', username: 'brider' }] }]);
    const result = await new FriendService(db).search('user-a', 'bri');
    expect(result).toEqual([{ userId: 'user-b', displayName: 'B Rider', username: 'brider' }]);
    expect(db.run.mock.calls[0][0]).toContain('username IS NOT NULL');
    expect(db.run.mock.calls[0][0]).not.toContain('email');
    await expect(new FriendService(runner([])).search('user-a', 'ab')).rejects.toMatchObject({ code: 'INVALID_SEARCH' });
  });

  it('rejects self and blocked friend requests before creating social state', async () => {
    await expect(new FriendService(runner([])).request('same', 'same')).rejects.toMatchObject({ code: 'SELF_REQUEST' });
    const db = runner([{ rows: [{ 1: 1 }] }]);
    await expect(new FriendService(db).request('user-a', 'user-b')).rejects.toMatchObject({ code: 'SOCIAL_INTERACTION_UNAVAILABLE' });
    expect(db.run).toHaveBeenCalledTimes(1);
  });

  it('accepts an opposite pending request and creates only the canonical friendship pair', async () => {
    const db = runner([{ rows: [] }, { rows: [{ id: 'request-1' }] }, { rows: [] }]);
    await expect(new FriendService(db).request('user-a', 'user-b')).resolves.toEqual({ id: 'request-1', action: 'accepted' });
    expect(db.run.mock.calls[2][0]).toContain('LEAST');
    expect(db.run.mock.calls[2][0]).toContain('ON CONFLICT DO NOTHING');
  });

  it('uses the authoritative room id and rejects non-owner/non-friend ride invitations', async () => {
    const denied = runner([{ rows: [] }]);
    await expect(new RideInvitationService(denied, {} as any).invite('owner', 'room-id', 'friend')).rejects.toMatchObject({ code: 'INVITATION_UNAVAILABLE' });
    expect(denied.run).toHaveBeenCalledWith(expect.stringContaining('m.room_id=$3'), ['owner', 'friend', 'room-id']);
  });
});
