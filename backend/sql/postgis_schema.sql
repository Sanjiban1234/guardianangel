-- Guardian Angel PostGIS schema (new normalized room model)
--
-- Apply this as a migration to a NEW database or after deliberately migrating
-- the current active_riders/engine_heartbeat model. It intentionally does not
-- alter those legacy tables in place.

BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS ride_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Store SHA-256 of the invite token, never the raw credential.
  token_hash TEXT NOT NULL UNIQUE,
  creator_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'ended')),
  ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS room_members (
  room_id UUID NOT NULL REFERENCES ride_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'rider'
    CHECK (role IN ('rider', 'guardian')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS room_members_user_room_idx
  ON room_members (user_id, room_id);

CREATE TABLE IF NOT EXISTS telemetry_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES ride_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Client capture time. The separate received_at field is server audit time.
  device_timestamp_ms BIGINT NOT NULL
    CHECK (device_timestamp_ms >= 1600000000000),
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  accuracy REAL NOT NULL CHECK (accuracy >= 0),
  speed REAL NOT NULL CHECK (speed >= 0),
  synced BOOLEAN NOT NULL DEFAULT true,
  -- Stable UUID created in SQLite. This makes re-sync retries idempotent.
  client_reading_id UUID NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_reading_id),
  UNIQUE (room_id, user_id, device_timestamp_ms)
);

-- GiST is the spatial R-tree-style index PostGIS can use for radius and
-- containment prefilters. B-tree is only useful for ordered scalar equality/
-- range values, not 2-D geographic shapes.
CREATE INDEX IF NOT EXISTS telemetry_readings_location_gix
  ON telemetry_readings USING GIST (location);

-- Spatial predicates should also first cut the data to the room/time slice.
CREATE INDEX IF NOT EXISTS telemetry_readings_room_user_time_idx
  ON telemetry_readings (room_id, user_id, device_timestamp_ms);

-- Keep the *current* position separate from the append-only telemetry history.
-- This prevents proximity checks from scanning a rider's entire track.
CREATE TABLE IF NOT EXISTS rider_current_locations (
  room_id UUID NOT NULL REFERENCES ride_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_timestamp_ms BIGINT NOT NULL,
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  accuracy REAL NOT NULL,
  speed REAL NOT NULL,
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS rider_current_locations_location_gix
  ON rider_current_locations USING GIST (location);

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
$$;

DROP TRIGGER IF EXISTS telemetry_current_location_trigger ON telemetry_readings;
CREATE TRIGGER telemetry_current_location_trigger
AFTER INSERT ON telemetry_readings
FOR EACH ROW EXECUTE FUNCTION maintain_rider_current_location();

CREATE TABLE IF NOT EXISTS geofences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  area GEOGRAPHY(POLYGON, 4326) NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('hazard', 'dead_zone')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS geofences_area_gix
  ON geofences USING GIST (area);
CREATE INDEX IF NOT EXISTS geofences_active_type_idx
  ON geofences (type) WHERE is_active;

COMMIT;
