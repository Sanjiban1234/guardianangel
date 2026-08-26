import request from 'supertest';
import { app } from '../src/index';
import * as db from '../src/db';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { resetAuthLimiterForTests } from '../src/routes/AuthRouter';

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
});
