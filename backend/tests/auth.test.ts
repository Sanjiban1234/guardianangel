import request from 'supertest';
import { app } from '../src/index';
import * as db from '../src/db';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { resetAuthLimiterForTests, resetBiometricLimiterForTests } from '../src/routes/AuthRouter';
import { createAuthenticatedTestSession, installTestSessionValidator, resetTestSessions } from './helpers/auth';

jest.mock('../src/db', () => ({
  query: jest.fn(),
  pool: {
    connect: jest.fn(),
  },
  initDb: jest.fn().mockResolvedValue(true)
}));

const mockedQuery = db.query as jest.MockedFunction<typeof db.query>;

describe('Authentication REST Endpoints & Security Controls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetAuthLimiterForTests();
    resetBiometricLimiterForTests();
    resetTestSessions();
    installTestSessionValidator();
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user successfully with strong password and valid E.164 phone', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [] } as any);
      mockedQuery.mockResolvedValueOnce({
        rows: [{ id: 'user-uuid-123', name: 'testrider', email: 'test@example.com', vehicle_model: 'Yamaha MT-15', plate_number: 'BA 99 PA 1234' }]
      } as any);

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'testrider',
          email: 'test@example.com',
          password: 'Password123',
          phone: '+9779812345678',
          vehicle_model: '  Yamaha MT-15  ',
          plate_number: ' BA 99   PA 1234 '
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('message', 'User registered successfully');
      expect(response.body.user).toEqual({
        id: 'user-uuid-123', name: 'testrider', email: 'test@example.com', vehicle_model: 'Yamaha MT-15', plate_number: 'BA 99 PA 1234',
      });
      expect(mockedQuery).toHaveBeenCalledTimes(2);
      expect(mockedQuery).toHaveBeenLastCalledWith(
        expect.stringContaining('vehicle_model'),
        expect.arrayContaining(['Yamaha MT-15', 'BA 99 PA 1234'])
      );
    });

    it('should return 409 if email already exists', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [{ id: 'user-uuid-123' }]
      } as any);

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'existingrider',
          email: 'existing@example.com',
          password: 'Password123',
          phone: '+9779812345678'
        });

      expect(response.status).toBe(409);
      expect(response.body).toHaveProperty('error', 'Email is already registered');
      expect(mockedQuery).toHaveBeenCalledTimes(1);
    });

    it('stores a valid username selected during registration', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [] } as any);
      mockedQuery.mockResolvedValueOnce({
        rows: [{ id: 'user-uuid-username', name: 'testrider', email: 'username@example.com', username: 'test_rider' }],
      } as any);

      const response = await request(app)
        .post('/api/auth/register')
        .send({ name: 'testrider', username: 'Test_Rider', email: 'username@example.com', password: 'Password123', phone: '+9779812345678' });

      expect(response.status).toBe(201);
      expect(response.body.user.username).toBe('test_rider');
      expect(mockedQuery).toHaveBeenLastCalledWith(expect.stringContaining('username'), expect.arrayContaining(['test_rider']));
    });

    it('returns a meaningful conflict when the selected username is unavailable', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [] } as any);
      mockedQuery.mockRejectedValueOnce({ code: '23505', constraint: 'users_username_normalized_unique_idx' });

      const response = await request(app)
        .post('/api/auth/register')
        .send({ name: 'testrider', username: 'test_rider', email: 'taken-username@example.com', password: 'Password123', phone: '+9779812345678' });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: 'Username is unavailable' });
    });

    it('rejects blank vehicle values when a client supplies them', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'testrider', email: 'test@example.com', password: 'Password123', phone: '+9779812345678',
          vehicle_model: '   ', plate_number: 'BA 99 PA 1234',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Vehicle model');
      expect(mockedQuery).not.toHaveBeenCalled();
    });

    it('should return 400 if required fields are missing', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'testrider'
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Name, email, password, and phone number are required');
      expect(mockedQuery).not.toHaveBeenCalled();
    });

    it('should reject passwords missing uppercase letters', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'weakrider',
          email: 'weak@example.com',
          password: 'password123',
          phone: '+9779812345678'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('uppercase');
      expect(mockedQuery).not.toHaveBeenCalled();
    });

    it('should reject passwords missing lowercase letters', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'weakrider',
          email: 'weak@example.com',
          password: 'PASSWORD123',
          phone: '+9779812345678'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('lowercase');
    });

    it('should reject passwords missing numbers', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'weakrider',
          email: 'weak@example.com',
          password: 'PasswordWord',
          phone: '+9779812345678'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('number');
    });

    it('should reject name exceeding 50 characters', async () => {
      const longName = 'a'.repeat(51);
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          name: longName,
          email: 'test@example.com',
          password: 'Password123',
          phone: '+9779812345678'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('50 characters');
    });

    it('should auto-normalize 10-digit Nepali phone numbers to E.164 on registration', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [] } as any);
      mockedQuery.mockResolvedValueOnce({
        rows: [{ id: 'user-uuid-nepali', name: 'nepalirider', email: 'nepali@example.com' }]
      } as any);

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'nepalirider',
          email: 'nepali@example.com',
          password: 'Password123',
          phone: '9812345678'
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('message', 'User registered successfully');
      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO users'),
        expect.arrayContaining(['+9779812345678'])
      );
    });

    it('should reject invalid phone numbers that cannot be normalized to E.164', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'badphone',
          email: 'bad@example.com',
          password: 'Password123',
          phone: '12345'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('E.164');
    });

    it('should reject invalid email format', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'testrider',
          email: 'not-an-email',
          password: 'Password123',
          phone: '+9779812345678'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid email format');
    });
  });

  describe('POST /api/auth/login', () => {
    it('should authenticate user and return a token', async () => {
      const hashedPassword = await bcrypt.hash('Password123', 10);

      mockedQuery.mockResolvedValueOnce({
        rows: [{
          id: 'user-uuid-123',
          name: 'testrider',
          email: 'test@example.com',
          password_hash: hashedPassword
        }]
      } as any);

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'Password123'
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('token');
      expect(response.body.user).toEqual({ id: 'user-uuid-123', name: 'testrider', email: 'test@example.com', profile_complete: true });
      expect(jwt.decode(response.body.token)).toMatchObject({ role: 'rider' });
    });

    it('should return 401 for incorrect password', async () => {
      const hashedPassword = await bcrypt.hash('CorrectPassword123', 10);

      mockedQuery.mockResolvedValueOnce({
        rows: [{
          id: 'user-uuid-123',
          name: 'testrider',
          email: 'test@example.com',
          password_hash: hashedPassword
        }]
      } as any);

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'WrongPassword123'
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'Invalid email or password');
    });

    it('should return 401 if user does not exist', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [] } as any);

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'unknown@example.com',
          password: 'Password123'
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'Invalid email or password');
    });
  });

  describe('Rate Limiting & JWT Secret Controls', () => {
    it('should enforce rate limiting after 5 login attempts when test flag enabled', async () => {
      process.env.ENABLE_AUTH_RATE_LIMIT_TEST = 'true';
      mockedQuery.mockResolvedValue({ rows: [] } as any);

      for (let i = 0; i < 5; i++) {
        await request(app).post('/api/auth/login').send({ email: 'rider@example.com', password: 'Password123' });
      }

      const response = await request(app)
        .post('/api/auth/login')
        .send({ email: 'rider@example.com', password: 'Password123' });

      expect(response.status).toBe(429);
      expect(response.body).toHaveProperty('error');

      delete process.env.ENABLE_AUTH_RATE_LIMIT_TEST;
    });

    it('should fail fast at startup if JWT_SECRET environment variable is missing', () => {
      const originalSecret = process.env.JWT_SECRET;
      delete process.env.JWT_SECRET;

      expect(() => {
        jest.isolateModules(() => {
          delete process.env.JWT_SECRET;
          delete require.cache[require.resolve('../src/config')];
          const dotenv = require('dotenv');
          jest.spyOn(dotenv, 'config').mockImplementation(() => {
            delete process.env.JWT_SECRET;
            return {};
          });
          require('../src/config');
        });
      }).toThrow('FATAL: JWT_SECRET environment variable is required');

      process.env.JWT_SECRET = originalSecret;
    });
  });

  describe('POST /api/auth/biometric endpoints', () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const credentialId = '22222222-2222-4222-8222-222222222222';
    const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const androidSpkiBase64 = keyPair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const publicKey = `-----BEGIN PUBLIC KEY-----\n${androidSpkiBase64.match(/.{1,64}/g)?.join('\n')}\n-----END PUBLIC KEY-----\n`;
    const challenge = 'c'.repeat(43);
    const challengeHash = crypto.createHash('sha256').update(challenge).digest('hex');

    const authenticatedToken = (): string => createAuthenticatedTestSession({ id: userId, name: 'rider', role: 'rider' }).token;

    it('registers an authenticated public key and rejects unauthenticated or malformed registration', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [{ id: credentialId }] } as any);
      const successful = await request(app)
        .post('/api/auth/biometric/register')
        .set('Authorization', `Bearer ${authenticatedToken()}`)
        .send({ public_key: publicKey });
      expect(successful.status).toBe(201);
      expect(successful.body).toEqual({ credential_id: credentialId });
      expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT (user_id) WHERE revoked_at IS NULL'), expect.arrayContaining([userId, publicKey]));

      const unauthenticated = await request(app).post('/api/auth/biometric/register').send({ public_key: publicKey });
      expect(unauthenticated.status).toBe(401);

      const malformed = await request(app)
        .post('/api/auth/biometric/register')
        .set('Authorization', `Bearer ${authenticatedToken()}`)
        .send({ public_key: 'not-a-key' });
      expect(malformed.status).toBe(400);
    });

    it('issues a challenge only for an active credential and rejects malformed or unavailable credentials', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [{ id: credentialId }] } as any);
      const successful = await request(app).post('/api/auth/biometric/challenge').send({ credential_id: credentialId });
      expect(successful.status).toBe(200);
      expect(successful.body.credential_id).toBe(credentialId);
      expect(successful.body.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const malformed = await request(app).post('/api/auth/biometric/challenge').send({ credential_id: 'not-a-uuid' });
      expect(malformed.status).toBe(401);

      mockedQuery.mockResolvedValueOnce({ rows: [] } as any);
      const unavailable = await request(app).post('/api/auth/biometric/challenge').send({ credential_id: credentialId });
      expect(unavailable.status).toBe(401);
    });

    it('accepts one valid signature, creates a normal session, and rejects wrong or replayed signatures', async () => {
      const signature = crypto.sign('RSA-SHA256', Buffer.from(challenge), keyPair.privateKey).toString('base64');
      mockedQuery
        .mockResolvedValueOnce({ rows: [{ id: credentialId, user_id: userId, public_key: publicKey, challenge_hash: challengeHash }] } as any)
        .mockResolvedValueOnce({ rows: [{ user_id: userId }] } as any)
        .mockResolvedValueOnce({ rows: [{ id: userId, name: 'rider', email: 'rider@example.com' }] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);
      const successful = await request(app).post('/api/auth/biometric/verify').send({ credential_id: credentialId, challenge, signature });
      expect(successful.status).toBe(200);
      expect(successful.body.token).toEqual(expect.any(String));

      const wrongSignature = crypto.sign('RSA-SHA256', Buffer.from('d'.repeat(43)), keyPair.privateKey).toString('base64');
      mockedQuery.mockResolvedValueOnce({ rows: [{ id: credentialId, user_id: userId, public_key: publicKey, challenge_hash: challengeHash }] } as any);
      const wrong = await request(app).post('/api/auth/biometric/verify').send({ credential_id: credentialId, challenge, signature: wrongSignature });
      expect(wrong.status).toBe(401);

      mockedQuery
        .mockResolvedValueOnce({ rows: [{ id: credentialId, user_id: userId, public_key: publicKey, challenge_hash: challengeHash }] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);
      const replay = await request(app).post('/api/auth/biometric/verify').send({ credential_id: credentialId, challenge, signature });
      expect(replay.status).toBe(401);
    });

    it('revokes the current session and biometric credential on logout', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${authenticatedToken()}`)
        .send();
      expect(response.status).toBe(200);
      expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining('auth_sessions SET revoked_at'), expect.arrayContaining([expect.any(String), userId]));
      expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining('biometric_credentials SET revoked_at'), [userId]);
    });
  });
});
