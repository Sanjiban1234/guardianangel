import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { QueryRunner } from '../db/QueryRunner';
import { JWT_AUDIENCE, JWT_ISSUER, JWT_SECRET } from '../config';

export interface RegisterResult {
  id: string;
  username: string;
}

export interface LoginResult {
  token: string;
  user: { id: string; username: string };
}

/**
 * UserService — owns all user-account business logic.
 *
 * Failures (DB errors, hash errors) are thrown as plain Errors so the
 * caller (route handler) decides the HTTP status. This class has no
 * knowledge of Express or HTTP codes.
 */
export class UserService {
  constructor(private readonly db: QueryRunner) {}

  /**
   * Register a new user.
   * Throws if the username is already taken or the DB write fails.
   */
  async register(
    username: string,
    password: string,
    phone: string
  ): Promise<RegisterResult> {
    // Uniqueness pre-check — surfaces a clean error before hashing
    const existing = await this.db.run(
      'SELECT id FROM users WHERE username = $1',
      [username]
    );
    if (existing.rows.length > 0) {
      const err = new Error('Username is already taken');
      (err as any).code = 'USERNAME_TAKEN';
      throw err;
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const result = await this.db.run(
      'INSERT INTO users (username, password_hash, phone) VALUES ($1, $2, $3) RETURNING id, username',
      [username, passwordHash, phone]
    );

    return result.rows[0] as RegisterResult;
  }

  /**
   * Authenticate a user and return a signed JWT.
   * Throws with code AUTH_FAILED if credentials are wrong.
   */
  async login(username: string, password: string): Promise<LoginResult> {
    const result = await this.db.run(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      const err = new Error('Invalid username or password');
      (err as any).code = 'AUTH_FAILED';
      throw err;
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      const err = new Error('Invalid username or password');
      (err as any).code = 'AUTH_FAILED';
      throw err;
    }

    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '24h', issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
    );

    return {
      token,
      user: { id: user.id, username: user.username },
    };
  }
}
