import { QueryRunner } from '../db/QueryRunner';
import { logger } from '../utils/logger';

export type PlatformType = 'ios' | 'android';

export interface FcmSender {
  sendMulticast: (
    tokens: string[],
    notification: { title: string; body: string },
    data?: Record<string, string>
  ) => Promise<{ successCount: number; failureCount: number }>;
}

export class FcmPushService {
  constructor(
    private readonly db: QueryRunner,
    private readonly fcmSender?: FcmSender
  ) {}

  /**
   * Register or update a device token for a user and platform.
   */
  async registerDeviceToken(
    userId: string,
    token: string,
    platform: PlatformType
  ): Promise<void> {
    if (!token || typeof token !== 'string' || token.trim() === '') {
      throw new Error('Device token must be a non-empty string');
    }

    if (platform !== 'ios' && platform !== 'android') {
      throw new Error('Platform must be either "ios" or "android"');
    }

    await this.db.run(
      `INSERT INTO device_tokens (user_id, token, platform, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, platform) DO UPDATE
       SET token = EXCLUDED.token,
           updated_at = NOW()`,
      [userId, token, platform]
    );
  }

  /**
   * Send vehicle breakdown push notification to target user IDs.
   * Isolated failure posture: errors log and continue without throwing.
   */
  async sendBreakdownPush(
    targetUserIds: string[],
    payload: {
      breakdown_id: string;
      user_id: string;
      name: string;
      reason?: string;
      note?: string;
      latitude: number;
      longitude: number;
      reported_at: number;
    }
  ): Promise<void> {
    if (!targetUserIds || targetUserIds.length === 0) return;

    try {
      const result = await this.db.run(
        `SELECT token FROM device_tokens WHERE user_id = ANY($1)`,
        [targetUserIds]
      );

      const tokens: string[] = result.rows.map((r) => r.token).filter(Boolean);
      if (tokens.length === 0) return;

      const title = 'Vehicle Breakdown Reported';
      const body = payload.reason
        ? `${payload.name} reported a breakdown (${payload.reason.replace('_', ' ')})`
        : `${payload.name} reported a breakdown`;

      const dataPayload: Record<string, string> = {
        type: 'vehicle_breakdown',
        breakdown_id: payload.breakdown_id,
        user_id: payload.user_id,
        name: payload.name,
        latitude: String(payload.latitude),
        longitude: String(payload.longitude),
        reported_at: String(payload.reported_at),
      };
      if (payload.reason) dataPayload.reason = payload.reason;
      if (payload.note) dataPayload.note = payload.note;

      if (this.fcmSender) {
        await this.fcmSender.sendMulticast(
          tokens,
          { title, body },
          dataPayload
        );
      } else {
        logger.info('breakdown push simulated', { count: tokens.length });
      }
    } catch (err) {
      logger.error('breakdown push failed', err);
    }
  }

  /** Send an informational petrol-refill request to the other room riders. */
  async sendRefillPush(
    targetUserIds: string[],
    payload: { refill_id: string; user_id: string; name: string; group_code: string; note?: string; created_at: number }
  ): Promise<void> {
    if (!targetUserIds || targetUserIds.length === 0) return;
    try {
      const result = await this.db.run(
        `SELECT token FROM device_tokens WHERE user_id = ANY($1)`,
        [targetUserIds]
      );
      const tokens: string[] = result.rows.map((r) => r.token).filter(Boolean);
      if (tokens.length === 0) return;
      const body = payload.note
        ? `${payload.name} requested a petrol refill: ${payload.note}`
        : `${payload.name} requested a petrol refill`;
      const data: Record<string, string> = {
        type: 'petrol_refill', refill_id: payload.refill_id, user_id: payload.user_id,
        name: payload.name, group_code: payload.group_code, created_at: String(payload.created_at),
      };
      if (payload.note) data.note = payload.note;
      if (this.fcmSender) await this.fcmSender.sendMulticast(tokens, { title: 'Petrol Refill Requested', body }, data);
      else logger.info('refill push simulated', { count: tokens.length });
    } catch (err) {
      logger.error('refill push failed', err);
    }
  }
}
