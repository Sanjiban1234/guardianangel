import request from 'supertest';
import { app } from '../src/index';
import * as db from '../src/db';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Mock the db module
jest.mock('../src/db', () => ({
  query: jest.fn(),
  pool: {
    connect: jest.fn(),
  },
  initDb: jest.fn().mockResolvedValue(true)
}));

const mockedQuery = db.query as jest.MockedFunction<typeof db.query>;

describe('Authentication REST Endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user successfully', async () => {
      // 1. Mock username duplicate check returns no rows
      mockedQuery.mockResolvedValueOnce({ rows: [] } as any);
      // 2. Mock database insert returns user data
      mockedQuery.mockResolvedValueOnce({
        rows: [{ id: 'user-uuid-123', username: 'testrider' }]
      } as any);

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'testrider',
          password: 'password123',
          phone: '+9779812345678'
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('message', 'User registered successfully');
      expect(response.body.user).toEqual({ id: 'user-uuid-123', username: 'testrider' });
      expect(mockedQuery).toHaveBeenCalledTimes(2);
    });

    it('should return 409 if username already exists', async () => {
      // Mock duplicate check returns an existing user row
      mockedQuery.mockResolvedValueOnce({
        rows: [{ id: 'user-uuid-123' }]
      } as any);

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'existingrider',
          password: 'password123',
          phone: '+9779812345678'
        });

      expect(response.status).toBe(409);
      expect(response.body).toHaveProperty('error', 'Username is already taken');
      expect(mockedQuery).toHaveBeenCalledTimes(1);
    });

    it('should return 400 if required fields are missing', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'testrider'
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Username, password, and phone number are required');
      expect(mockedQuery).not.toHaveBeenCalled();
    });

    it('should reject weak passwords', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'weakrider',
          password: 'weak',
          phone: '+9779812345678'
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Password must be at least 8 characters with letters and numbers');
      expect(mockedQuery).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/auth/login', () => {
    it('should authenticate user and return a token', async () => {
      const hashedPassword = await bcrypt.hash('password123', 10);

      // Mock user lookup returns matching record
      mockedQuery.mockResolvedValueOnce({
        rows: [{
          id: 'user-uuid-123',
          username: 'testrider',
          password_hash: hashedPassword
        }]
      } as any);

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'testrider',
          password: 'password123'
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('token');
      expect(response.body.user).toEqual({ id: 'user-uuid-123', username: 'testrider' });

      // Verify returned token is a valid JWT
      const decoded = jwt.verify(response.body.token, process.env.JWT_SECRET || 'super_secret_jwt_key_change_me_in_production') as any;
      expect(decoded.id).toBe('user-uuid-123');
      expect(decoded.username).toBe('testrider');
    });

    it('should return 401 for incorrect password', async () => {
      const hashedPassword = await bcrypt.hash('correct_password', 10);

      mockedQuery.mockResolvedValueOnce({
        rows: [{
          id: 'user-uuid-123',
          username: 'testrider',
          password_hash: hashedPassword
        }]
      } as any);

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'testrider',
          password: 'wrong_password'
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'Invalid username or password');
    });

    it('should return 401 if user does not exist', async () => {
      // Mock user lookup returns no rows
      mockedQuery.mockResolvedValueOnce({ rows: [] } as any);

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'unknownrider',
          password: 'password123'
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'Invalid username or password');
    });
  });
});
