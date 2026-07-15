/**
 * db.ts — backward-compatibility shim AND the authoritative singleton for tests.
 *
 * The existing test suite mocks this module with:
 *   jest.mock('../src/db', () => ({ query: jest.fn(), pool: { connect: jest.fn() }, initDb: jest.fn() }))
 *
 * To ensure services use the mocked `query` in tests, QueryRunner in index.ts
 * delegates its run() calls through this module's exported `query`.
 * That way jest.mock() intercepts ALL database calls regardless of which
 * service class originated them.
 */

import { Pool } from 'pg';
import dotenv from 'dotenv';
import { DatabasePool } from './db/DatabasePool';
import { MockDatabase } from './db/MockDatabase';

dotenv.config();

// ─── Shared instances ─────────────────────────────────────────────────────────

const _dbPool  = new DatabasePool();
const _mockDb  = new MockDatabase();

let _useMock = !process.env.DATABASE_URL;

// ─── Core query function — ALL services route through here ────────────────────

export const query = async (text: string, params: any[] = []): Promise<{ rows: any[] }> => {
  if (_useMock || _dbPool.hasError) {
    return _mockDb.handle(text, params);
  }

  try {
    return await _dbPool.query(text, params);
  } catch (err) {
    const msg = (err as Error).message;
    if (
      msg.includes('ECONNREFUSED') ||
      msg.includes('no password specified') ||
      msg.includes('does not exist')
    ) {
      if (!_useMock) {
        console.warn(`db: connection failed ("${msg}"). Switching to mock.`);
        _useMock = true;
        _dbPool.markFailed();
      }
      return _mockDb.handle(text, params);
    }
    throw err;
  }
};

/** @deprecated Use pool from DatabasePool class in new code */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : undefined,
});

export const initDb = async (): Promise<void> => {
  if (!process.env.DATABASE_URL) {
    console.log('db: No DATABASE_URL — running in Mock/In-Memory mode.');
    _useMock = true;
    return;
  }

  let client: any;
  try {
    client = await _dbPool.connect();
    await client.query('BEGIN');

    for (const ext of ['postgis', 'pgcrypto', '"uuid-ossp"']) {
      try { await client.query(`CREATE EXTENSION IF NOT EXISTS ${ext}`); } catch {}
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ride_rooms (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        room_token VARCHAR(255) UNIQUE NOT NULL,
        creator_id UUID REFERENCES users(id) ON DELETE SET NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW(),
        ended_at TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS room_members (
        room_id UUID REFERENCES ride_rooms(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        joined_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (room_id, user_id)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS telemetry_readings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        room_id UUID REFERENCES ride_rooms(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        device_timestamp BIGINT NOT NULL,
        latitude DOUBLE PRECISION NOT NULL,
        longitude DOUBLE PRECISION NOT NULL,
        accuracy REAL NOT NULL,
        speed REAL NOT NULL,
        geom GEOMETRY(Point, 4326),
        UNIQUE (user_id, device_timestamp)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS emergency_alerts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        room_id UUID REFERENCES ride_rooms(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        timestamp BIGINT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        latitude DOUBLE PRECISION NOT NULL,
        longitude DOUBLE PRECISION NOT NULL
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS weather_reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        room_id UUID REFERENCES ride_rooms(id) ON DELETE CASCADE,
        latitude DOUBLE PRECISION NOT NULL,
        longitude DOUBLE PRECISION NOT NULL,
        condition VARCHAR(50) NOT NULL,
        temperature REAL NOT NULL,
        timestamp BIGINT NOT NULL
      )
    `);
    try { await client.query('CREATE INDEX IF NOT EXISTS telemetry_geom_idx ON telemetry_readings USING GIST (geom)'); } catch {}

    await client.query('COMMIT');
    console.log('db: PostgreSQL schema initialised.');
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.warn(`db: Schema init failed — "${(error as Error).message}". Switching to mock.`);
    _useMock = true;
    _dbPool.markFailed();
  } finally {
    client?.release();
  }
};
