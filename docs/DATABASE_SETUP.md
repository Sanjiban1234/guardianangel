# Database Setup Guide

This document covers how to install and configure PostgreSQL with PostGIS for the Guardian Angel backend, and how to connect it via the `.env` file.

---

## Prerequisites

- **Node.js** v18 or higher
- **PostgreSQL** v14 or higher
- **PostGIS** extension (bundled with most PostgreSQL installers on Windows)

---

## 1. Install PostgreSQL

### Windows

1. Download the installer from https://www.postgresql.org/download/windows/
2. Run the installer and follow the setup wizard.
3. During installation:
   - Set a password for the default `postgres` user (remember this).
   - Keep the default port as `5432`.
   - When prompted by Stack Builder, select **PostGIS** under Spatial Extensions and install it.
4. After installation, ensure the PostgreSQL `bin` directory is added to your system PATH (e.g., `C:\Program Files\PostgreSQL\16\bin`).

### macOS (Homebrew)

```bash
brew install postgresql@16 postgis
brew services start postgresql@16
```

### Linux (Ubuntu/Debian)

```bash
sudo apt update
sudo apt install postgresql postgresql-contrib postgis
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

---

## 2. Create the Database

Open a terminal (or pgAdmin) and connect to PostgreSQL:

```bash
psql -U postgres
```

Then run:

```sql
CREATE DATABASE guardian_angel;
\c guardian_angel
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

This creates the `guardian_angel` database and enables the required extensions:
- **PostGIS** — for geospatial indexing on telemetry data
- **uuid-ossp** — for UUID primary key generation

---

## 3. Configure the `.env` File

Navigate to the `backend/` directory. Copy the example env file:

```bash
cp .env.example .env
```

Open `.env` and update the values:

```env
PORT=3000
DATABASE_URL=postgresql://<username>:<password>@<host>:<port>/guardian_angel
JWT_SECRET=super_secret_jwt_key_change_me_in_production
NODE_ENV=development
```

### Environment Variables Explained

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Port the backend server listens on | `3000` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@localhost:5432/guardian_angel` |
| `JWT_SECRET` | Secret key used to sign JWT tokens for authentication | Any long random string |
| `NODE_ENV` | Environment mode (`development`, `test`, or `production`) | `development` |

### Connection String Format

```
postgresql://<username>:<password>@<host>:<port>/<database_name>
```

- **username** — your PostgreSQL user (default: `postgres`)
- **password** — the password you set during installation
- **host** — `localhost` for local development
- **port** — `5432` (PostgreSQL default)
- **database_name** — `guardian_angel`

---

## 4. How the Code Connects to the Database

The backend uses the `pg` (node-postgres) library. The connection is configured in `backend/src/db.ts`:

1. On server startup, `initDb()` is called from `src/index.ts`.
2. `initDb()` reads `DATABASE_URL` from the `.env` file via `dotenv`.
3. A connection pool (`Pool`) is created with the connection string.
4. The function then auto-creates all required tables if they don't exist:
   - `users` — registered rider accounts
   - `ride_rooms` — active/ended ride sessions
   - `room_members` — many-to-many relationship between users and rooms
   - `telemetry_readings` — GPS location data with PostGIS geometry column
   - `emergency_alerts` — SOS event records
   - `weather_reports` — weather data linked to ride rooms

### Fallback Mode (No Database)

If PostgreSQL is not running or `DATABASE_URL` is invalid, the backend automatically falls back to an **in-memory mock database**. This allows development and testing without a running PostgreSQL instance, but data will not persist across server restarts.

---

## 5. Database Schema

The following tables are created automatically on first startup:

```sql
-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Ride rooms / sessions
CREATE TABLE ride_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_token VARCHAR(255) UNIQUE NOT NULL,
  creator_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  ended_at TIMESTAMP
);

-- Room membership (many-to-many)
CREATE TABLE room_members (
  room_id UUID REFERENCES ride_rooms(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id)
);

-- Telemetry / GPS readings with PostGIS geometry
CREATE TABLE telemetry_readings (
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
);

-- Emergency SOS alerts
CREATE TABLE emergency_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES ride_rooms(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  timestamp BIGINT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL
);

-- Weather reports
CREATE TABLE weather_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES ride_rooms(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  condition VARCHAR(50) NOT NULL,
  temperature REAL NOT NULL,
  timestamp BIGINT NOT NULL
);
```

---

## 6. Running the Backend

Once your database is set up and `.env` is configured:

```bash
cd backend
npm install
npm run dev
```

The server will start and print either:
- `PostgreSQL database initialized successfully.` — connected to the real database
- `Could not connect to PostgreSQL: ... Initializing system in-memory.` — running in fallback mode

---

## 7. Troubleshooting

| Problem | Solution |
|---------|----------|
| `ECONNREFUSED` error | Make sure PostgreSQL is running (`pg_isready` or check Services on Windows) |
| `database "guardian_angel" does not exist` | Run `CREATE DATABASE guardian_angel;` in psql |
| `extension "postgis" is not available` | Install PostGIS via Stack Builder (Windows) or your package manager |
| `password authentication failed` | Verify the username/password in your `DATABASE_URL` matches your PostgreSQL credentials |
| `role "postgres" does not exist` | Create the role: `CREATE ROLE postgres WITH LOGIN SUPERUSER PASSWORD 'your_password';` |

---

## 8. Production Notes

- Replace `JWT_SECRET` with a strong, randomly generated key.
- Set `NODE_ENV=production` to enable SSL on the database connection.
- Use a managed PostgreSQL service (e.g., Supabase, Railway, Render, AWS RDS) and update `DATABASE_URL` accordingly.
- Never commit the `.env` file to version control (it is already in `.gitignore`).
