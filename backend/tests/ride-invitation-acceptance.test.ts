import express from 'express';
import request from 'supertest';
import { QueryRunner } from '../src/db/QueryRunner';
import { RoomService } from '../src/services/RoomService';
import { RideInvitationService } from '../src/services/RideInvitationService';
import { RideInvitationRouter } from '../src/routes/RideInvitationRouter';
import { RoomRouter } from '../src/routes/RoomRouter';
import { SessionHandler } from '../src/handlers/SessionHandler';
import { PresenceService } from '../src/services/PresenceService';
import { createAuthenticatedTestSession, installTestSessionValidator } from './helpers/auth';

jest.mock('express-rate-limit', () => ({ __esModule: true, default: () => (_req: any, _res: any, next: any) => next() }));

// Stateful SQL boundary, following the project's mocked-database REST tests.
// Real services and authenticated routers run together; transactions restore on failure.
function fixture() {
  let rooms: any[] = [];
  let members: any[] = [];
  let invites: any[] = [];
  let blocked = false;
  const run = jest.fn(async (sql: string, p: any[] = []): Promise<{ rows: any[] }> => {
    if (sql.includes('SELECT profile_complete')) return { rows: [{ profile_complete: true }] };
    if (sql.includes('INSERT INTO ride_rooms')) {
      const room = { id: `room-${rooms.length}`, token_hash: p[0], creator_id: p[1], destination_latitude: p[2], destination_longitude: p[3], destination_label: p[4], group_code: p[5], status: 'active', expires_at: new Date(Date.now() + 3600000).toISOString() };
      rooms.push(room); return { rows: [room] };
    }
    if (sql.includes('INSERT INTO room_members')) {
      if (!members.some(m => m.room_id === p[0] && m.user_id === p[1])) members.push({ room_id: p[0], user_id: p[1], role: sql.includes("'owner'") ? 'owner' : 'member' });
      return { rows: [] };
    }
    if (sql.includes('JOIN friendships')) return { rows: blocked ? [] : [{ value: 1 }] };
    if (sql.includes('INSERT INTO ride_invitations')) {
      const invite = { id: `invite-${invites.length}`, room_id: p[0], inviter_user_id: p[1], invitee_user_id: p[2], status: 'pending', expires_at: new Date(Date.now() + 3600000).toISOString() };
      invites.push(invite); return { rows: [invite] };
    }
    if (sql.includes('FROM ride_invitations WHERE id=')) return { rows: invites.filter(i => i.id === p[0] && i.invitee_user_id === p[1]) };
    if (sql.includes('FROM user_blocks')) return { rows: blocked ? [{ value: 1 }] : [] };
    if (sql.includes('UPDATE ride_invitations')) {
      const invite = invites.find(i => i.id === p[0] && i.invitee_user_id === p[1] && i.status === 'pending');
      if (invite) { invite.status = sql.includes("status='declined'") ? 'declined' : 'accepted'; invite.responded_at = new Date().toISOString(); }
      return { rows: invite ? [invite] : [] };
    }
    if (sql.includes('FROM ride_rooms WHERE')) return { rows: rooms.filter(r => sql.includes('WHERE token_hash') ? r.token_hash === p[0] : r.id === p[0]) };
    if (sql.includes('SELECT rm.room_id, rm.role')) return { rows: members.filter(m => m.user_id === p[0] && rooms.some(r => r.id === m.room_id && r.status === 'active' && new Date(r.expires_at).getTime() > Date.now())) };
    if (sql.includes('SELECT COUNT(*)')) return { rows: [{ count: members.filter(m => m.room_id === p[0]).length }] };
    if (sql.includes('SELECT 1 FROM room_members')) return { rows: members.filter(m => m.room_id === p[0] && m.user_id === p[1]) };
    if (sql.includes('SELECT rr.id, rr.status, rr.group_code')) return { rows: rooms.filter(r => r.token_hash === p[0] && members.some(m => m.room_id === r.id && m.user_id === p[1])) };
    if (sql.includes('SELECT rm.user_id, u.name')) {
      const room = rooms.find(r => r.token_hash === p[0]);
      return { rows: members.filter(m => m.room_id === room?.id).map(m => ({ ...m, name: m.user_id.toUpperCase() })) };
    }
    if (sql.includes('FROM ride_invitations i')) return { rows: invites.filter(i => i.invitee_user_id === p[0] && i.status === 'pending') };
    if (sql.includes('UPDATE ride_rooms SET group_code')) { rooms.find(r => r.id === p[0]).group_code = p[1]; return { rows: [] }; }
    throw new Error(`Unhandled test SQL: ${sql}`);
  });
  const db = new QueryRunner(run);
  db.transaction = async action => {
    const snapshot = JSON.stringify({ rooms, members, invites });
    try { return await action(db); }
    catch (e) { ({ rooms, members, invites } = JSON.parse(snapshot)); throw e; }
  };
  const roomService = new RoomService(db);
  const invitations = new RideInvitationService(db, roomService);
  const app = express(); app.use(express.json());
  app.use('/api', new RoomRouter(roomService).router);
  app.use('/api', new RideInvitationRouter(invitations, { publicUser: async () => ({ userId: 'b', displayName: 'B' }) } as any).router);
  return { app, db, run, roomService, invitations, rooms: () => rooms, members: () => members, invites: () => invites, block: () => { blocked = true; } };
}

describe('ride invitation acceptance through REST and shared membership service', () => {
  let f: ReturnType<typeof fixture>;
  let authA: string, authB: string;
  beforeAll(() => {
    installTestSessionValidator();
    authA = `Bearer ${createAuthenticatedTestSession({ id: 'a', name: 'A', role: 'rider' }).token}`;
    authB = `Bearer ${createAuthenticatedTestSession({ id: 'b', name: 'B', role: 'rider' }).token}`;
  });
  beforeEach(() => { f = fixture(); });
  async function setup() {
    const created = await request(f.app).post('/api/rooms').set('Authorization', authA).send({ destination: { latitude: 28, longitude: 84, label: 'Pokhara' } });
    expect(created.status).toBe(201);
    const invited = await request(f.app).post(`/api/rooms/${created.body.room_id}/invitations`).set('Authorization', authA).send({ invitee_user_id: 'b' });
    expect(invited.status).toBe(201);
    return { room: created.body, id: invited.body.id };
  }
  const accept = (id: string) => request(f.app).post(`/api/ride-invitations/${id}/accept`).set('Authorization', authB);

  it('creates, invites, accepts, consumes and restores the canonical room with one membership', async () => {
    const { room, id } = await setup();
    const first = await accept(id);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ room_id: room.room_id, group_code: room.group_code, status: 'active', role: 'member', rideStartedAt: null, destination: room.destination });
    expect(f.invites()[0]).toMatchObject({ status: 'accepted', responded_at: expect.any(String) });
    const duplicate = await accept(id);
    expect(duplicate.status).toBe(200); expect(duplicate.body).toEqual(first.body);
    expect(f.members().filter(m => m.user_id === 'b')).toHaveLength(1);
    expect((await request(f.app).get('/api/ride-invitations').set('Authorization', authB)).body).toEqual([]);
    const manual = await request(f.app).post('/api/rooms/join').set('Authorization', authB).send({ group_code: room.group_code });
    expect(manual.status).toBe(200); expect(manual.body.room_id).toBe(room.room_id);
    expect(f.members()).toHaveLength(2);
  });
  it('accepts a pending invitation for an existing same-room member even at capacity', async () => {
    const { room, id } = await setup();
    await f.roomService.joinRoom('b', room.group_code);
    for (let n = 0; n < 18; n++) f.members().push({ room_id: room.room_id, user_id: `r${n}`, role: 'member' });
    expect((await accept(id)).status).toBe(200); expect(f.members()).toHaveLength(20);
  });
  it('rejects another active room and preserves membership and pending invitation', async () => {
    const { id } = await setup();
    const other = await f.roomService.createRoom('b', { latitude: 1, longitude: 2 });
    const result = await accept(id);
    expect(result.status).toBe(409); expect(result.body.code).toBe('ACTIVE_ROOM_CONFLICT');
    expect(f.members().filter(m => m.user_id === 'b')).toEqual([{ room_id: other.room_id, user_id: 'b', role: 'owner' }]);
    expect(f.invites()[0].status).toBe('pending');
  });
  it.each(['declined', 'cancelled', 'expired'])('rejects %s invitations', async status => {
    const { id } = await setup(); f.invites()[0].status = status;
    expect((await accept(id)).status).toBe(400); expect(f.members()).toHaveLength(1);
  });
  it.each(['ended', 'deleted', 'expired', 'invite-expired', 'blocked', 'legacy-code'])('rejects %s before creating membership', async state => {
    const { id } = await setup();
    if (state === 'ended') f.rooms()[0].status = 'ended';
    if (state === 'deleted') f.rooms().splice(0);
    if (state === 'expired') f.rooms()[0].expires_at = new Date(0).toISOString();
    if (state === 'invite-expired') f.invites()[0].expires_at = new Date(0).toISOString();
    if (state === 'blocked') f.block();
    if (state === 'legacy-code') f.rooms()[0].group_code = null;
    expect((await accept(id)).status).toBe(400); expect(f.members()).toHaveLength(1);
    expect(f.invites()[0].status).toBe('pending');
  });
  it('rejects a different authenticated user', async () => {
    const { id } = await setup();
    expect((await request(f.app).post(`/api/ride-invitations/${id}/accept`).set('Authorization', authA)).status).toBe(400);
    expect(f.members()).toHaveLength(1);
  });
  it('declines without joining and cannot later accept', async () => {
    const { id } = await setup();
    expect((await request(f.app).post(`/api/ride-invitations/${id}/decline`).set('Authorization', authB)).status).toBe(200);
    expect(f.invites()[0].status).toBe('declined'); expect(f.members()).toHaveLength(1);
    expect((await accept(id)).status).toBe(400);
  });
  it('rolls back membership if consuming the invitation fails', async () => {
    const { id } = await setup(); const original = f.db.run.bind(f.db);
    jest.spyOn(f.db, 'run').mockImplementation((sql, params) => sql.includes("SET status='accepted'") ? Promise.reject(new Error('database unavailable')) : original(sql, params));
    expect((await accept(id)).status).toBe(500);
    expect(f.members()).toHaveLength(1); expect(f.invites()[0].status).toBe('pending');
  });
  it('does not reuse an accepted invitation as a fresh grant after leaving', async () => {
    const { id } = await setup(); await accept(id);
    f.members().splice(f.members().findIndex(m => m.user_id === 'b'), 1);
    expect((await accept(id)).status).toBe(400); expect(f.members()).toHaveLength(1);
  });
  it('returns started state and preserves owner role on same-room manual restore', async () => {
    const { room, id } = await setup(); f.rooms()[0].ride_started_at = '2026-09-05T00:00:00Z';
    expect((await accept(id)).body.rideStartedAt).toBe('2026-09-05T00:00:00Z');
    expect(await f.roomService.joinRoom('a', room.group_code)).toMatchObject({ role: 'owner', rideStartedAt: '2026-09-05T00:00:00Z' });
  });
  it('recovers a legacy code only from a verified member and then accepts the existing invitation', async () => {
    const { room, id } = await setup(); f.rooms()[0].group_code = null;
    expect(await f.roomService.verifyMembership(room.group_code, 'intruder')).toBeNull();
    expect(f.rooms()[0].group_code).toBeNull();
    expect(await f.roomService.verifyMembership(room.group_code, 'a')).toMatchObject({ id: room.room_id });
    expect(f.rooms()[0].group_code).toBe(room.group_code);
    expect((await accept(id)).body.group_code).toBe(room.group_code);
  });
  it('joins the normal socket group, notifies the host and returns one roster row on rejoin', async () => {
    const { room, id } = await setup(); const accepted = await accept(id);
    const presence = new PresenceService(f.db);
    const hostEvents = { emit: jest.fn() };
    const socket: any = { id: 'socket-b', user: { id: 'b', name: 'B' }, on: jest.fn(), join: jest.fn(), emit: jest.fn(), to: jest.fn(() => hostEvents) };
    const state = { currentGroupCode: null };
    new SessionHandler({} as any, socket, state, f.roomService, presence).register();
    const join = socket.on.mock.calls.find(([event]: any[]) => event === 'session:join')[1];
    const ack = jest.fn();
    await join({ group_code: accepted.body.group_code }, ack);
    await join({ group_code: accepted.body.group_code }, ack);
    expect(socket.join).toHaveBeenCalledWith(`group:${room.group_code}`);
    expect(socket.to).toHaveBeenCalledWith(`group:${room.group_code}`);
    expect(hostEvents.emit).toHaveBeenCalledWith('session:member_joined', expect.objectContaining({ user_id: 'b' }));
    expect(ack.mock.lastCall[0].members.filter((m: any) => m.user_id === 'b')).toHaveLength(1);
    expect(ack.mock.lastCall[0].members.find((m: any) => m.user_id === 'b').connection_state).toBe('CONNECTED');
    expect(f.members()).toHaveLength(2);
  });
});
