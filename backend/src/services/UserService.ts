import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { QueryRunner } from '../db/QueryRunner';
import { JWT_AUDIENCE, JWT_ISSUER, JWT_SECRET } from '../config';

export interface RegisterResult {
  id: string;
  name: string;
}

export interface LoginResult {
  token: string;
  user: { id: string; name: string };
}

export class UserService {
  constructor(private readonly db: QueryRunner) {}

  async register(
    name: string,
    password: string,
    phone: string
  ): Promise<RegisterResult> {
    const existing = await this.db.run(
      'SELECT id FROM users WHERE name = $1',
      [name]
    );
    if (existing.rows.length > 0) {
      const err = new Error('Username is already taken');
      (err as any).code = 'USERNAME_TAKEN';
      throw err;
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const result = await this.db.run(
      'INSERT INTO users (name, password_hash, phone) VALUES ($1, $2, $3) RETURNING id, name',
      [name, passwordHash, phone]
    );

    return result.rows[0] as RegisterResult;
  }

  async login(name: string, password: string): Promise<LoginResult> {
    const result = await this.db.run(
      'SELECT * FROM users WHERE name = $1',
      [name]
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
      { id: user.id, name: user.name },
      JWT_SECRET,
      { expiresIn: '24h', issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
    );

    return {
      token,
      user: { id: user.id, name: user.name },
    };
  }

  async updateGeoHash(userId: string, geohash: string): Promise<void> {
    await this.db.run(
      'UPDATE users SET geohash = $1 WHERE id = $2',
      [geohash, userId]
    );
  }
}
