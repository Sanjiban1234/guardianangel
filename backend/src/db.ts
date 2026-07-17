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

    try { await client.query('CREATE EXTENSION IF NOT EXISTS postgis'); } catch {}
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

    // Indexes (legacy)
    await client.query('CREATE INDEX IF NOT EXISTS idx_active_riders_group_code ON active_riders(group_code)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_active_riders_user_id ON active_riders(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_engine_heartbeat_user_ts ON engine_heartbeat(user_id, device_timestamp DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_engine_heartbeat_group ON engine_heartbeat(group_code)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_emergency_alarms_user ON emergency_alarms(user_id)');

    // ─── PostGIS spatial tables ──────────────────────────────────────────────

    await client.query(`
      CREATE TABLE IF NOT EXISTS ride_rooms (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        token_hash TEXT NOT NULL UNIQUE,
        creator_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'ended')),
        ended_at TIMESTAMPTZ
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS room_members (
        room_id UUID NOT NULL REFERENCES ride_rooms(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'rider'
          CHECK (role IN ('rider', 'guardian')),
        joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (room_id, user_id)
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS room_members_user_room_idx ON room_members (user_id, room_id)');

    // Add room_id FK to emergency_alarms now that ride_rooms exists
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'emergency_alarms' AND column_name = 'room_id'
        ) THEN
          ALTER TABLE emergency_alarms ADD COLUMN room_id UUID REFERENCES ride_rooms(id) ON DELETE SET NULL;
        END IF;
      END $$
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS telemetry_readings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        room_id UUID NOT NULL REFERENCES ride_rooms(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_timestamp_ms BIGINT NOT NULL
          CHECK (device_timestamp_ms >= 1600000000000),
        location GEOGRAPHY(POINT, 4326) NOT NULL,
        accuracy REAL NOT NULL CHECK (accuracy >= 0),
        speed REAL NOT NULL CHECK (speed >= 0),
        synced BOOLEAN NOT NULL DEFAULT true,
        client_reading_id UUID NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (user_id, client_reading_id),
        UNIQUE (room_id, user_id, device_timestamp_ms)
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS telemetry_readings_location_gix ON telemetry_readings USING GIST (location)');
    await client.query('CREATE INDEX IF NOT EXISTS telemetry_readings_room_user_time_idx ON telemetry_readings (room_id, user_id, device_timestamp_ms)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS rider_current_locations (
        room_id UUID NOT NULL REFERENCES ride_rooms(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_timestamp_ms BIGINT NOT NULL,
        location GEOGRAPHY(POINT, 4326) NOT NULL,
        accuracy REAL NOT NULL,
        speed REAL NOT NULL,
        PRIMARY KEY (room_id, user_id)
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS rider_current_locations_location_gix ON rider_current_locations USING GIST (location)');

    await client.query(`
      CREATE OR REPLACE FUNCTION maintain_rider_current_location()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO rider_current_locations
          (room_id, user_id, device_timestamp_ms, location, accuracy, speed)
        VALUES
          (NEW.room_id, NEW.user_id, NEW.device_timestamp_ms, NEW.location, NEW.accuracy, NEW.speed)
        ON CONFLICT (room_id, user_id) DO UPDATE
          SET device_timestamp_ms = EXCLUDED.device_timestamp_ms,
              location = EXCLUDED.location,
              accuracy = EXCLUDED.accuracy,
              speed = EXCLUDED.speed
          WHERE EXCLUDED.device_timestamp_ms >= rider_current_locations.device_timestamp_ms;
        RETURN NEW;
      END;
      $$
    `);

    await client.query('DROP TRIGGER IF EXISTS telemetry_current_location_trigger ON telemetry_readings');
    await client.query(`
      CREATE TRIGGER telemetry_current_location_trigger
      AFTER INSERT ON telemetry_readings
      FOR EACH ROW EXECUTE FUNCTION maintain_rider_current_location()
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS geofences (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        area GEOGRAPHY(POLYGON, 4326) NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('hazard', 'dead_zone')),
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS geofences_area_gix ON geofences USING GIST (area)');
    await client.query(`CREATE INDEX IF NOT EXISTS geofences_active_type_idx ON geofences (type) WHERE is_active`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS crash_candidates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        room_id UUID REFERENCES ride_rooms(id) ON DELETE SET NULL,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_timestamp_ms BIGINT NOT NULL,
        location GEOGRAPHY(POINT, 4326) NOT NULL,
        speed REAL,
        speed_reading_timestamp_ms BIGINT,
        outcome TEXT CHECK (outcome IN ('confirmed', 'false_alarm')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS crash_candidates_room_user_idx ON crash_candidates (room_id, user_id, device_timestamp_ms DESC)');

    await client.query('COMMIT');
    console.log('db: PostgreSQL + PostGIS schema initialised.');
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    throw new Error(`db: Schema init failed — "${(error as Error).message}"`);
  } finally {
    client?.release();
  }
};
