import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { QueryRunner } from '../db/QueryRunner';
import { JWT_AUDIENCE, JWT_ISSUER, JWT_SECRET } from '../config';
import { AppError } from '../utils/AppError';

export interface RegisterResult {
  id: string;
  name: string;
  email: string;
}

export interface LoginResult {
  token: string;
  user: { id: string; name: string; email: string; profile_complete: boolean };
}

export class UserService {
  constructor(private readonly db: QueryRunner) {}

  async register(
    name: string,
    email: string,
    password: string,
    phone: string
  ): Promise<RegisterResult> {
    // Check if email is already registered
    const existingEmail = await this.db.run(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );
    if (existingEmail.rows.length > 0) {
      throw new AppError('Email is already registered', 'EMAIL_TAKEN');
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const result = await this.db.run(
      'INSERT INTO users (name, email, password_hash, phone, profile_complete) VALUES ($1, $2, $3, $4, true) RETURNING id, name, email',
      [name, email, passwordHash, phone]
    );

    return result.rows[0] as RegisterResult;
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const result = await this.db.run(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      throw new AppError('Invalid email or password', 'AUTH_FAILED');
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      throw new AppError('Invalid email or password', 'AUTH_FAILED');
    }

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role === 'admin' ? 'admin' : 'rider' },
      JWT_SECRET,
      { expiresIn: '24h', issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
    );

    return {
      token,
      user: { id: user.id, name: user.name, email: user.email, profile_complete: user.profile_complete !== false },
    };
  }

  async updateGeoHash(userId: string, geohash: string): Promise<void> {
    await this.db.run(
      'UPDATE users SET geohash = $1 WHERE id = $2',
      [geohash, userId]
    );
  }
}
