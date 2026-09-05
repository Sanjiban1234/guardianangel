import { QueryRunner } from '../db/QueryRunner';
import { AppError } from '../utils/AppError';
import { RoomService } from './RoomService';

export class RideInvitationService {
  constructor(private readonly db: QueryRunner, private readonly rooms: RoomService) {}
  async list(userId: string) { return (await this.db.run(`SELECT i.id, i.room_id, i.status, i.expires_at, i.created_at, u.name AS inviter_name, rr.destination_label
    FROM ride_invitations i JOIN users u ON u.id=i.inviter_user_id JOIN ride_rooms rr ON rr.id=i.room_id
    WHERE i.invitee_user_id=$1 AND i.status='pending' AND i.expires_at > now() AND rr.status='active' AND rr.created_at + interval '24 hours' > now() ORDER BY i.created_at DESC`, [userId])).rows; }
  async invite(inviterId: string, roomId: string, inviteeId: string) {
    if (inviterId === inviteeId) throw new AppError('Unable to send invitation', 'INVITATION_UNAVAILABLE');
    const allowed = await this.db.run(`SELECT 1 FROM room_members m JOIN friendships f ON ((f.user_a_id=$1 AND f.user_b_id=$2) OR (f.user_b_id=$1 AND f.user_a_id=$2))
      WHERE m.room_id=$3 AND m.user_id=$1 AND m.role='owner' AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_user_id=$1 AND b.blocked_user_id=$2) OR (b.blocker_user_id=$2 AND b.blocked_user_id=$1))`, [inviterId, inviteeId, roomId]);
    if (!allowed.rows.length) throw new AppError('Unable to send invitation', 'INVITATION_UNAVAILABLE');
    try { const result = await this.db.run(`INSERT INTO ride_invitations (room_id, inviter_user_id, invitee_user_id, expires_at) VALUES ($1,$2,$3,now() + interval '24 hours') RETURNING id, expires_at`, [roomId, inviterId, inviteeId]); return result.rows[0]; }
    catch (e: any) { if (e?.code === '23505') throw new AppError('Invitation already pending', 'INVITATION_PENDING'); throw e; }
  }
  async decline(userId: string, invitationId: string) { const r=await this.db.run("UPDATE ride_invitations SET status='declined', responded_at=now() WHERE id=$1 AND invitee_user_id=$2 AND status='pending' RETURNING id, inviter_user_id", [invitationId,userId]); if(!r.rows.length) throw new AppError('Invitation unavailable','INVITATION_UNAVAILABLE'); return r.rows[0]; }
  async accept(userId: string, invitationId: string) {
    return this.db.transaction(async db => {
      const invitation = await db.run(`SELECT room_id, inviter_user_id, status, expires_at
        FROM ride_invitations WHERE id=$1 AND invitee_user_id=$2 FOR UPDATE`, [invitationId, userId]);
      const invite = invitation.rows[0];
      if (!invite || !['pending', 'accepted'].includes(invite.status)
        || (invite.status === 'pending' && new Date(invite.expires_at).getTime() <= Date.now())) {
        throw new AppError('This invitation is no longer valid.', 'INVITATION_UNAVAILABLE');
      }
      const blocked = await db.run(`SELECT 1 FROM user_blocks WHERE
        (blocker_user_id=$1 AND blocked_user_id=$2) OR (blocker_user_id=$2 AND blocked_user_id=$1)`, [userId, invite.inviter_user_id]);
      if (blocked.rows.length) throw new AppError('This invitation is no longer valid.', 'INVITATION_UNAVAILABLE');
      // An accepted invitation restores existing membership, never grants a fresh join after leaving.
      if (invite.status === 'accepted') {
        const member = await db.run('SELECT 1 FROM room_members WHERE room_id=$1 AND user_id=$2', [invite.room_id, userId]);
        if (!member.rows.length) throw new AppError('This invitation is no longer valid.', 'INVITATION_UNAVAILABLE');
      }
      const joined = await this.rooms.joinRoomById(userId, invite.room_id, db);
      await db.run("UPDATE ride_invitations SET status='accepted', responded_at=now() WHERE id=$1 AND invitee_user_id=$2 AND status='pending'", [invitationId, userId]);
      return { joined, inviterUserId: invite.inviter_user_id };
    });
  }
}
