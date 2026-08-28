import crypto from 'crypto';
import { QueryRunner } from '../db/QueryRunner';

export type BiometricChallenge = {
  credentialId: string;
  challenge: string;
};

type CredentialRow = {
  id: string;
  user_id: string;
  public_key: string;
  challenge_hash: string | null;
};

export class BiometricCredentialService {
  constructor(private readonly db: QueryRunner) {}

  async register(userId: string, publicKey: string): Promise<string> {
    if (typeof publicKey !== 'string' || publicKey.length > 8_192) {
      throw new Error('Invalid biometric public key');
    }
    try {
      crypto.createPublicKey(publicKey);
    } catch {
      throw new Error('Invalid biometric public key');
    }

    const credentialId = crypto.randomUUID();
    const result = await this.db.run(
      `INSERT INTO biometric_credentials (id, user_id, public_key, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '30 days')
       ON CONFLICT (user_id) WHERE revoked_at IS NULL DO UPDATE
       SET public_key = EXCLUDED.public_key, challenge_hash = NULL,
           challenge_expires_at = NULL, expires_at = EXCLUDED.expires_at,
           created_at = NOW(), last_used_at = NULL
       RETURNING id`,
      [credentialId, userId, publicKey],
    );
    const persistedId = result.rows[0]?.id;
    if (typeof persistedId !== 'string') throw new Error('Unable to register biometric credential');
    return persistedId;
  }

  async createChallenge(credentialId: string): Promise<BiometricChallenge | null> {
    if (!isUuid(credentialId)) return null;
    const challenge = crypto.randomBytes(32).toString('base64url');
    const challengeHash = hash(challenge);
    const result = await this.db.run(
      `UPDATE biometric_credentials
       SET challenge_hash = $1, challenge_expires_at = NOW() + INTERVAL '5 minutes'
       WHERE id = $2 AND revoked_at IS NULL AND expires_at > NOW()
       RETURNING id`,
      [challengeHash, credentialId],
    );
    return result.rows.length === 1 ? { credentialId, challenge } : null;
  }

  async verifyAndConsume(credentialId: string, challenge: string, signatureBase64: string): Promise<string | null> {
    if (!isUuid(credentialId) || !isReasonableChallenge(challenge) || !isReasonableSignature(signatureBase64)) return null;
    const result = await this.db.run(
      `SELECT id, user_id, public_key, challenge_hash
       FROM biometric_credentials
       WHERE id = $1 AND revoked_at IS NULL AND expires_at > NOW()
         AND challenge_expires_at > NOW()`,
      [credentialId],
    );
    const credential = result.rows[0] as CredentialRow | undefined;
    if (!credential?.challenge_hash || !safeEqual(credential.challenge_hash, hash(challenge))) return null;

    try {
      const verified = crypto.verify(
        'RSA-SHA256',
        Buffer.from(challenge, 'utf8'),
        credential.public_key,
        Buffer.from(signatureBase64, 'base64'),
      );
      if (!verified) return null;
    } catch {
      return null;
    }

    const consumed = await this.db.run(
      `UPDATE biometric_credentials
       SET challenge_hash = NULL, challenge_expires_at = NULL, last_used_at = NOW()
       WHERE id = $1 AND challenge_hash = $2 AND revoked_at IS NULL AND expires_at > NOW()
         AND challenge_expires_at > NOW()
       RETURNING user_id`,
      [credentialId, credential.challenge_hash],
    );
    return consumed.rows[0]?.user_id ?? null;
  }

  async revokeForUser(userId: string): Promise<void> {
    await this.db.run(
      `UPDATE biometric_credentials SET revoked_at = NOW()
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
  }
}

const hash = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');
const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const isReasonableChallenge = (value: unknown): value is string => typeof value === 'string' && value.length >= 32 && value.length <= 256;
const isReasonableSignature = (value: unknown): value is string => typeof value === 'string' && value.length >= 128 && value.length <= 16_384;
const safeEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};
