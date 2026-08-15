-- Run this as PostgreSQL superuser (postgres) to enable PostGIS
-- Command: psql -U postgres -d guardian_angel -f fix-postgis.sql

-- Create PostGIS extension (requires superuser)
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Verify PostGIS is installed
SELECT PostGIS_Version();

-- Grant ga_admin user permissions if needed
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ga_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ga_admin;
