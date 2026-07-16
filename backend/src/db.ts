import { Pool } from 'pg';
import dotenv from 'dotenv';
import { DatabasePool } from './db/DatabasePool';

dotenv.config();

const _dbPool = new DatabasePool();

export const query = async (text: string, params: any[] = []): Promise<{ rows: any[] }> => {
  return _dbPool.query(text, params);
};

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : undefined,
});

export const initDb = async (): Promise<void> => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required. Set it in .env file.');
  }

  let client: any;
  try {
    client = await _dbPool.connect();
    await client.query('BEGIN');

    try { await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto'); } catch {}
    try { await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'); } catch {}

    // Users/Riders table (ER: ID, Name, Phone, GeoHash)
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        geohash VARCHAR(20),
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(name)
      )
    `);

    // Active Riders table (ER: GroupCode, IncludeID, GeoHash, type of Operation)
    await client.query(`
      CREATE TABLE IF NOT EXISTS active_riders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        group_code VARCHAR(255) NOT NULL,
        include_id UUID REFERENCES users(id) ON DELETE SET NULL,
        geohash VARCHAR(20),
        type_of_operation VARCHAR(50) DEFAULT 'ride',
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        joined_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, group_code)
      )
    `);

    // Notification Subdivision Table (ER: FieldID, GroupID, TakeID, TakeOfcl, TypeArea)
    await client.query(`
      CREATE TABLE IF NOT EXISTS notification_subdivision (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        field_id VARCHAR(100),
        group_id VARCHAR(100),
        take_id VARCHAR(100),
        take_ofcl VARCHAR(100),
        type_area VARCHAR(100)
      )
    `);

    // Emergency Alarm table (ER: Alarmno, correlationID, Expire, JOINID, JOIN-CHECK-TIMESTAMP)
    await client.query(`
      CREATE TABLE IF NOT EXISTS emergency_alarms (
        alarm_no UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        active_rider_id UUID REFERENCES active_riders(id) ON DELETE SET NULL,
        notification_subdivision_id UUID REFERENCES notification_subdivision(id) ON DELETE SET NULL,
        correlation_id UUID DEFAULT gen_random_uuid(),
        expire TIMESTAMP,
        join_id UUID,
        join_check_timestamp TIMESTAMP DEFAULT NOW(),
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Engine Heartbeat table (ER: LogID, StatusID, Pulses, Seconds, NumberOfPulse)
    await client.query(`
      CREATE TABLE IF NOT EXISTS engine_heartbeat (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        log_id UUID DEFAULT gen_random_uuid(),
        alarm_no UUID REFERENCES emergency_alarms(alarm_no) ON DELETE SET NULL,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        group_code VARCHAR(255),
        status_id VARCHAR(50) DEFAULT 'normal',
        pulses INTEGER DEFAULT 0,
        seconds INTEGER DEFAULT 0,
        number_of_pulse INTEGER DEFAULT 0,
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        accuracy REAL,
        speed REAL,
        device_timestamp BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, device_timestamp)
      )
    `);

    // Indexes
    await client.query('CREATE INDEX IF NOT EXISTS idx_active_riders_group_code ON active_riders(group_code)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_active_riders_user_id ON active_riders(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_engine_heartbeat_user_ts ON engine_heartbeat(user_id, device_timestamp DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_engine_heartbeat_group ON engine_heartbeat(group_code)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_emergency_alarms_user ON emergency_alarms(user_id)');

    await client.query('COMMIT');
    console.log('db: PostgreSQL schema initialised (ER diagram tables).');
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    throw new Error(`db: Schema init failed — "${(error as Error).message}"`);
  } finally {
    client?.release();
  }
};
