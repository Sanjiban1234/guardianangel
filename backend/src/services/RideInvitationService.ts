import { QueryRunner } from '../db/QueryRunner';
import { AppError } from '../utils/AppError';
import { RoomService } from './RoomService';

export class RideInvitationService {
  constructor(private readonly db: QueryRunner, private readonly rooms: RoomService) {}
  async list(userId: string) { return (await this.db.run(`SELECT i.id, i.room_id, i.status, i.expires_at, i.created_at, u.name AS inviter_name, rr.destination_label
    FROM ride_invitations i JOIN users u ON u.id=i.inviter_user_id JOIN ride_rooms rr ON rr.id=i.room_id
    WHERE i.invitee_user_id=$1 AND i.status='pending' AND i.expires_at > now() ORDER BY i.created_at DESC`, [userId])).rows; }
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
    const invitation=await this.db.run("SELECT room_id, inviter_user_id FROM ride_invitations WHERE id=$1 AND invitee_user_id=$2 AND status='pending' AND expires_at>now()", [invitationId,userId]);
    if(!invitation.rows.length) throw new AppError('Invitation unavailable','INVITATION_UNAVAILABLE');
    const joined=await this.rooms.joinRoomById(userId, invitation.rows[0].room_id);
    await this.db.run("UPDATE ride_invitations SET status='accepted', responded_at=now() WHERE id=$1 AND invitee_user_id=$2 AND status='pending'", [invitationId,userId]); return { joined, inviterUserId: invitation.rows[0].inviter_user_id };
  }
}
