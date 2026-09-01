import { QueryRunner } from '../db/QueryRunner';
import { AppError } from '../utils/AppError';

export type PublicUser = { userId: string; displayName: string; username: string };

const fail = (message: string, code: string) => { throw new AppError(message, code); };

export class FriendService {
  constructor(private readonly db: QueryRunner) {}

  static normalizeUsername(value: string): string {
    const username = value.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{2,31}$/.test(username) || ['admin', 'support', 'guardianangel', 'api'].includes(username)) {
      fail('Username must be 3–32 characters, start with a letter, and use only letters, numbers, or underscores', 'INVALID_USERNAME');
    }
    return username;
  }

  async setUsername(userId: string, value: string): Promise<string> {
    const username = FriendService.normalizeUsername(value);
    try {
      const result = await this.db.run('UPDATE users SET username = $1 WHERE id = $2 RETURNING username', [username, userId]);
      if (!result.rows.length) fail('User not found', 'USER_NOT_FOUND');
      return result.rows[0].username;
    } catch (error: any) {
      if (error?.code === '23505') fail('Username is unavailable', 'USERNAME_TAKEN');
      throw error;
    }
  }

  async search(userId: string, rawQuery: string): Promise<PublicUser[]> {
    const q = rawQuery.trim().toLowerCase();
    if (q.length < 3 || q.length > 32 || !/^[a-z0-9_]+$/.test(q)) fail('Enter at least 3 username characters', 'INVALID_SEARCH');
    const result = await this.db.run(`SELECT id AS "userId", name AS "displayName", username
      FROM users u WHERE username IS NOT NULL AND lower(username) LIKE $1 AND id <> $2
      AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_user_id = $2 AND b.blocked_user_id = u.id) OR (b.blocker_user_id = u.id AND b.blocked_user_id = $2))
      ORDER BY lower(username) LIMIT 20`, [`${q}%`, userId]);
    return result.rows;
  }

  async list(userId: string): Promise<PublicUser[]> {
    return (await this.db.run(`SELECT u.id AS "userId", u.name AS "displayName", u.username FROM friendships f JOIN users u ON u.id = CASE WHEN f.user_a_id = $1 THEN f.user_b_id ELSE f.user_a_id END WHERE f.user_a_id = $1 OR f.user_b_id = $1 ORDER BY lower(u.username), u.name`, [userId])).rows;
  }
  async requests(userId: string, direction: 'incoming' | 'outgoing') {
    const column = direction === 'incoming' ? 'receiver_user_id' : 'sender_user_id';
    const other = direction === 'incoming' ? 'sender_user_id' : 'receiver_user_id';
    return (await this.db.run(`SELECT r.id, r.status, r.created_at, u.id AS "userId", u.name AS "displayName", u.username FROM friend_requests r JOIN users u ON u.id = r.${other} WHERE r.${column} = $1 AND r.status = 'pending' ORDER BY r.created_at DESC`, [userId])).rows;
  }
  async request(senderId: string, receiverId: string): Promise<{ id: string; action: 'created' | 'accepted' }> {
    if (senderId === receiverId) fail('You cannot add yourself', 'SELF_REQUEST');
    const blocked = await this.db.run('SELECT 1 FROM user_blocks WHERE (blocker_user_id = $1 AND blocked_user_id = $2) OR (blocker_user_id = $2 AND blocked_user_id = $1) LIMIT 1', [senderId, receiverId]);
    if (blocked.rows.length) fail('Unable to send friend request', 'SOCIAL_INTERACTION_UNAVAILABLE');
    const opposite = await this.db.run(`UPDATE friend_requests SET status = 'accepted', responded_at = now() WHERE sender_user_id = $2 AND receiver_user_id = $1 AND status = 'pending' RETURNING id`, [senderId, receiverId]);
    if (opposite.rows.length) {
      await this.db.run('INSERT INTO friendships (user_a_id, user_b_id) VALUES (LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid)) ON CONFLICT DO NOTHING', [senderId, receiverId]);
      return { id: opposite.rows[0].id, action: 'accepted' };
    }
    const result = await this.db.run(`INSERT INTO friend_requests (sender_user_id, receiver_user_id) SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM friendships WHERE user_a_id = LEAST($1::uuid,$2::uuid) AND user_b_id = GREATEST($1::uuid,$2::uuid)) RETURNING id`, [senderId, receiverId]);
    if (!result.rows.length) fail('Unable to send friend request', 'REQUEST_UNAVAILABLE');
    return { id: result.rows[0].id, action: 'created' };
  }
  async respond(userId: string, requestId: string, accept: boolean): Promise<void> {
    const request = await this.db.run(`UPDATE friend_requests SET status = $3, responded_at = now() WHERE id = $1 AND receiver_user_id = $2 AND status = 'pending' RETURNING sender_user_id, receiver_user_id`, [requestId, userId, accept ? 'accepted' : 'declined']);
    if (!request.rows.length) fail('Friend request is unavailable', 'REQUEST_UNAVAILABLE');
    if (accept) await this.db.run('INSERT INTO friendships (user_a_id, user_b_id) VALUES (LEAST($1::uuid,$2::uuid), GREATEST($1::uuid,$2::uuid)) ON CONFLICT DO NOTHING', [request.rows[0].sender_user_id, userId]);
  }
  async cancel(userId: string, requestId: string): Promise<void> {
    const result = await this.db.run("UPDATE friend_requests SET status = 'cancelled', responded_at = now() WHERE id = $1 AND sender_user_id = $2 AND status = 'pending' RETURNING id", [requestId, userId]);
    if (!result.rows.length) fail('Friend request is unavailable', 'REQUEST_UNAVAILABLE');
  }
  async remove(userId: string, otherId: string): Promise<void> { await this.db.run('DELETE FROM friendships WHERE user_a_id = LEAST($1::uuid,$2::uuid) AND user_b_id = GREATEST($1::uuid,$2::uuid)', [userId, otherId]); }
  async block(userId: string, otherId: string): Promise<void> {
    if (userId === otherId) fail('You cannot block yourself', 'SELF_BLOCK');
    await this.db.run('INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, otherId]);
    await this.remove(userId, otherId);
    await this.db.run("UPDATE friend_requests SET status = 'cancelled', responded_at = now() WHERE status = 'pending' AND ((sender_user_id = $1 AND receiver_user_id = $2) OR (sender_user_id = $2 AND receiver_user_id = $1))", [userId, otherId]);
    await this.db.run("UPDATE ride_invitations SET status = 'cancelled', responded_at = now() WHERE status = 'pending' AND ((inviter_user_id = $1 AND invitee_user_id = $2) OR (inviter_user_id = $2 AND invitee_user_id = $1))", [userId, otherId]);
  }
  async unblock(userId: string, otherId: string): Promise<void> { await this.db.run('DELETE FROM user_blocks WHERE blocker_user_id = $1 AND blocked_user_id = $2', [userId, otherId]); }
}
