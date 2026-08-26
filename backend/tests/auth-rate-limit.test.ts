import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app } from '../src/index';
import * as db from '../src/db';
import { resetAuthLimiterForTests } from '../src/routes/AuthRouter';

jest.mock('../src/db', () => ({ query: jest.fn(), pool: { connect: jest.fn() }, initDb: jest.fn().mockResolvedValue(true) }));
const query = db.query as jest.MockedFunction<typeof db.query>;
const credentials = { email: 'test@example.com', password: 'Password123' };

describe('GA-02 authentication rate limiting', () => {
  beforeEach(() => { jest.clearAllMocks(); process.env.NODE_ENV = 'test'; resetAuthLimiterForTests(); });
  it('allows a valid login normally', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'u1', name: 'Rider', email: credentials.email, password_hash: await bcrypt.hash(credentials.password, 4) }] } as any);
    expect((await request(app).post('/api/auth/login').send(credentials)).status).toBe(200);
  });
  it('throttles repeated failed logins at the five-request threshold', async () => {
    query.mockResolvedValue({ rows: [] } as any);
    for (let i = 0; i < 5; i++) expect((await request(app).post('/api/auth/login').send({ ...credentials, password: 'WrongPassword123' })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ ...credentials, password: 'WrongPassword123' })).status).toBe(429);
  });
  it('also throttles registration abuse and cannot be reset outside tests', async () => {
    for (const email of ['Test@Example.com', 'test@example.com', 'TEST@example.com', 'four@example.com', 'five@example.com']) {
      expect((await request(app).post('/api/auth/register').send({ name: 'Rider', email, password: 'weak', phone: '+9779812345678' })).status).toBe(400);
    }
    expect((await request(app).post('/api/auth/register').send({ name: 'Rider', email: 'six@example.com', password: 'weak', phone: '+9779812345678' })).status).toBe(429);
    process.env.NODE_ENV = 'production'; resetAuthLimiterForTests();
    expect((await request(app).post('/api/auth/login').send(credentials)).status).toBe(429);
    process.env.NODE_ENV = 'test';
  });
});
