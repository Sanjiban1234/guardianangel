import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { QueryRunner } from '../db/QueryRunner';
import { PresenceService } from './PresenceService';
import { GUARDIAN_PORTAL_BASE_URL, GUARDIAN_PORTAL_OBSERVER_SECRET, GUARDIAN_PORTAL_SHARE_LIFETIME_MS } from '../config';

type SeparationState = 'unknown' | 'separated' | 'reunited';
export interface PortalLocation { latitude: number; longitude: number; lastUpdatedAt: number | null; freshness: 'FRESH' | 'STALE'; }
export interface PortalPresence { connectionState: 'CONNECTED' | 'DISCONNECTED'; updatedAt: number; }
export interface PortalBootstrap { shareId: string; riderName: string; rideStatus: 'live' | 'ended'; startedAt: string; endedAt?: string; location?: PortalLocation; presence: PortalPresence; separationState: SeparationState; observerCredential?: string; }
export interface ObserverClaims extends jwt.JwtPayload { shareId: string; roomId: string; ownerUserId: string; scope: 'guardian-portal-observer'; }

export class GuardianPortalShareError extends Error { constructor(public readonly code: 'NOT_ACTIVE_RIDER' | 'UNAVAILABLE') { super(code); } }

export class GuardianPortalShareService {
  constructor(private readonly db: QueryRunner, private readonly presence?: PresenceService) {}
  private hash(token: string): string { return crypto.createHash('sha256').update(token).digest('hex'); }

  async create(userId: string, groupCode: string): Promise<{ url: string; expiresAt: string }> {
    const room = await this.db.run(`SELECT rr.id FROM ride_rooms rr JOIN room_members rm ON rm.room_id = rr.id AND rm.user_id = $2 WHERE rr.token_hash = $1 AND rr.status = 'active' AND rr.ride_started_at IS NOT NULL LIMIT 1`, [this.hash(groupCode.toUpperCase()), userId]);
    if (!room.rows[0]?.id) throw new GuardianPortalShareError('NOT_ACTIVE_RIDER');
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + GUARDIAN_PORTAL_SHARE_LIFETIME_MS).toISOString();
    await this.db.run(`INSERT INTO guardian_portal_shares (room_id, owner_user_id, token_hash, expires_at, revoked_at, separation_state, separation_updated_at) VALUES ($1, $2, $3, $4, NULL, 'unknown', NULL) ON CONFLICT (room_id, owner_user_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at, revoked_at = NULL, separation_state = 'unknown', separation_updated_at = NULL, created_at = now()`, [room.rows[0].id, userId, this.hash(token), expiresAt]);
    return { url: `${GUARDIAN_PORTAL_BASE_URL}/watch#${token}`, expiresAt };
  }

  async current(userId: string, groupCode: string): Promise<{ active: boolean; expiresAt?: string }> {
    const result = await this.db.run(`SELECT s.expires_at FROM guardian_portal_shares s JOIN ride_rooms rr ON rr.id=s.room_id JOIN room_members rm ON rm.room_id=rr.id AND rm.user_id=$2 WHERE rr.token_hash=$1 AND rr.status='active' AND rr.ride_started_at IS NOT NULL AND s.owner_user_id=$2 AND s.revoked_at IS NULL AND s.expires_at > now() LIMIT 1`, [this.hash(groupCode.toUpperCase()), userId]);
    return result.rows[0] ? { active: true, expiresAt: result.rows[0].expires_at } : { active: false };
  }

  async revoke(userId: string, groupCode: string): Promise<string[]> {
    const result = await this.db.run(`UPDATE guardian_portal_shares s SET revoked_at=now() FROM ride_rooms rr WHERE rr.id=s.room_id AND rr.token_hash=$1 AND s.owner_user_id=$2 AND s.revoked_at IS NULL RETURNING s.id`, [this.hash(groupCode.toUpperCase()), userId]);
    return result.rows.map(row => row.id);
  }

  async activeSharesForRoom(groupCode: string): Promise<Array<{ id: string; owner_user_id: string }>> {
    const result = await this.db.run(`SELECT s.id, s.owner_user_id FROM guardian_portal_shares s JOIN ride_rooms rr ON rr.id=s.room_id WHERE rr.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()`, [this.hash(groupCode.toUpperCase())]);
    return result.rows;
  }

  async revokeForRider(groupCode: string, userId: string): Promise<string[]> {
    const result = await this.db.run(`UPDATE guardian_portal_shares s SET revoked_at=now() FROM ride_rooms rr WHERE rr.id=s.room_id AND rr.token_hash=$1 AND s.owner_user_id=$2 AND s.revoked_at IS NULL RETURNING s.id`, [this.hash(groupCode.toUpperCase()), userId]);
    return result.rows.map(row => row.id);
  }

  async markSeparation(groupCode: string, userId: string, state: Exclude<SeparationState, 'unknown'>): Promise<string[]> {
    const result = await this.db.run(`UPDATE guardian_portal_shares s SET separation_state=$3, separation_updated_at=now() FROM ride_rooms rr WHERE rr.id=s.room_id AND rr.token_hash=$1 AND s.owner_user_id=$2 AND rr.status='active' AND s.revoked_at IS NULL AND s.expires_at>now() RETURNING s.id`, [this.hash(groupCode.toUpperCase()), userId, state]);
    return result.rows.map(row => row.id);
  }

  async bootstrap(rawToken: string): Promise<PortalBootstrap> {
    const result = await this.db.run(`SELECT s.id AS share_id, s.room_id, s.owner_user_id, s.expires_at, s.revoked_at, s.separation_state, rr.status, rr.ride_started_at, rr.ended_at, u.name, ST_Y(l.location::geometry) AS latitude, ST_X(l.location::geometry) AS longitude, EXTRACT(EPOCH FROM tr.received_at)*1000 AS last_updated_at FROM guardian_portal_shares s JOIN ride_rooms rr ON rr.id=s.room_id JOIN room_members rm ON rm.room_id=rr.id AND rm.user_id=s.owner_user_id JOIN users u ON u.id=s.owner_user_id LEFT JOIN rider_current_locations l ON l.room_id=rr.id AND l.user_id=s.owner_user_id LEFT JOIN telemetry_readings tr ON tr.room_id=l.room_id AND tr.user_id=l.user_id AND tr.device_timestamp_ms=l.device_timestamp_ms WHERE s.token_hash=$1 LIMIT 1`, [this.hash(rawToken)]);
    const row = result.rows[0];
    if (!row || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now() || !row.ride_started_at) throw new GuardianPortalShareError('UNAVAILABLE');
    const presence: PortalPresence = { connectionState: this.presence?.isUserConnected(row.owner_user_id) ? 'CONNECTED' : 'DISCONNECTED', updatedAt: Date.now() };
    if (row.status !== 'active') return { shareId: row.share_id, riderName: row.name, rideStatus: 'ended', startedAt: row.ride_started_at, endedAt: row.ended_at, presence, separationState: row.separation_state };
    const updated = row.last_updated_at == null ? null : Number(row.last_updated_at);
    const fresh = updated !== null && Date.now() - updated <= 15_000;
    const location = row.latitude == null || row.longitude == null ? undefined : { latitude: Number(row.latitude), longitude: Number(row.longitude), lastUpdatedAt: updated, freshness: fresh ? 'FRESH' : 'STALE' } as PortalLocation;
    return { shareId: row.share_id, riderName: row.name, rideStatus: 'live', startedAt: row.ride_started_at, location, presence, separationState: row.separation_state, observerCredential: this.issueObserverCredential(row.share_id, row.room_id, row.owner_user_id, row.expires_at) };
  }

  private issueObserverCredential(shareId: string, roomId: string, ownerUserId: string, expiresAt: string): string {
    const seconds = Math.max(1, Math.min(10 * 60, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)));
    return jwt.sign({ shareId, roomId, ownerUserId, scope: 'guardian-portal-observer' }, GUARDIAN_PORTAL_OBSERVER_SECRET, { algorithm: 'HS256', audience: 'guardian-portal-observer', issuer: 'guardian-angel', expiresIn: seconds });
  }

  async validateObserverCredential(token: string): Promise<ObserverClaims> {
    const claims = jwt.verify(token, GUARDIAN_PORTAL_OBSERVER_SECRET, { algorithms: ['HS256'], audience: 'guardian-portal-observer', issuer: 'guardian-angel' }) as ObserverClaims;
    if (claims.scope !== 'guardian-portal-observer') throw new GuardianPortalShareError('UNAVAILABLE');
    const valid = await this.db.run(`SELECT 1 FROM guardian_portal_shares s JOIN ride_rooms rr ON rr.id=s.room_id JOIN room_members rm ON rm.room_id=rr.id AND rm.user_id=s.owner_user_id WHERE s.id=$1 AND s.room_id=$2 AND s.owner_user_id=$3 AND rr.status='active' AND rr.ride_started_at IS NOT NULL AND s.revoked_at IS NULL AND s.expires_at>now() LIMIT 1`, [claims.shareId, claims.roomId, claims.ownerUserId]);
    if (!valid.rows[0]) throw new GuardianPortalShareError('UNAVAILABLE');
    return claims;
  }
}
