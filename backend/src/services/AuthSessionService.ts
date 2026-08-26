import { QueryRunner } from '../db/QueryRunner';

export class AuthSessionService {
  constructor(private readonly db: QueryRunner) {}

  async create(jti: string, userId: string): Promise<void> {
    await this.db.run(`INSERT INTO auth_sessions (jti, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '24 hours')`, [jti, userId]);
  }

  async isActive(jti: string, userId: string): Promise<boolean> {
    const result = await this.db.run(`SELECT 1 FROM auth_sessions WHERE jti = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > NOW()`, [jti, userId]);
    return result.rows.length === 1;
  }

  async revoke(jti: string, userId: string): Promise<void> {
    await this.db.run(`UPDATE auth_sessions SET revoked_at = NOW() WHERE jti = $1 AND user_id = $2 AND revoked_at IS NULL`, [jti, userId]);
  }
}
