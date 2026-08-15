# Guardian Angel Backend - Docker Setup

Complete Docker environment for the Guardian Angel backend with PostgreSQL + PostGIS.

## Quick Start

### 1. Configure Environment

Copy the Docker environment template:
```bash
cd backend
cp .env.docker .env
```

Edit `.env` and update:
- `DB_PASSWORD` - Database password (default is set, change for production)
- `JWT_SECRET` - JWT signing secret (must be strong in production)
- `ALLOWED_ORIGINS` - CORS allowed origins (add your mobile app URL)

### 2. Start Services

Start both database and backend:
```bash
docker-compose up -d
```

Or build and start with logs:
```bash
docker-compose up --build
```

### 3. Verify Services

Check service health:
```bash
docker-compose ps
```

View logs:
```bash
docker-compose logs -f backend
docker-compose logs -f db
```

Test the API:
```bash
curl http://localhost:3000/api/health
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| `backend` | 3000 | Node.js + Express + Socket.IO |
| `db` | 5432 | PostgreSQL 16 + PostGIS 3.6 |

**Note:** The database image is built from a custom Dockerfile (`Dockerfile.postgres`) that extends `postgres:16` with PostGIS 3.6 extensions. This ensures compatibility across different host platforms.

## Common Commands

### Start services
```bash
docker-compose up -d
```

### Stop services
```bash
docker-compose down
```

### Restart a service
```bash
docker-compose restart backend
docker-compose restart db
```

### Rebuild after code changes
```bash
docker-compose up --build -d backend
```

### View logs
```bash
docker-compose logs -f
docker-compose logs -f backend
docker-compose logs -f db
```

### Execute commands in containers
```bash
# Backend shell
docker-compose exec backend sh

# Database shell
docker-compose exec db psql -U ga_admin -d guardian_angel
```

### Clean up (removes volumes/data)
```bash
docker-compose down -v
```

## Development Workflow

### Local Development (without Docker)

For faster iteration during development:
```bash
# Start only the database in Docker
docker-compose up -d db

# Run backend locally with hot reload
npm install
npm run dev
```

Update `.env` to use `DB_HOST=localhost` for local development.

### Production Build

The Dockerfile uses multi-stage builds:
1. **Builder stage**: Installs all dependencies and compiles TypeScript
2. **Production stage**: Only includes production dependencies and compiled code

This keeps the final image small and secure.

## Troubleshooting

### Backend can't connect to database

Check if database is healthy:
```bash
docker-compose ps
docker-compose logs db
```

Verify `DB_HOST=db` in docker-compose environment variables.

### Port already in use

If ports 3000 or 5432 are already in use, modify `docker-compose.yml`:
```yaml
ports:
  - "3001:3000"  # Use port 3001 on host
```

### Database schema not initialized

The schema is automatically loaded from `sql/postgis_schema.sql` on first startup. To reinitialize:
```bash
docker-compose down -v
docker-compose up -d
```

### View database data

Connect to the database:
```bash
docker-compose exec db psql -U ga_admin -d guardian_angel

# List tables
\dt

# Query data
SELECT * FROM users;
SELECT * FROM ride_rooms;
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DB_PASSWORD` | Yes | changeme | Database password |
| `JWT_SECRET` | Yes | - | JWT signing secret |
| `ALLOWED_ORIGINS` | No | localhost:3000,localhost:8081 | CORS allowed origins |
| `PORT` | No | 3000 | Backend server port |
| `MAX_BODY_SIZE` | No | 100kb | Max request body size |
| `MAX_BULK_BATCH` | No | 100 | Max bulk telemetry batch |

## Health Checks

Both services have health checks configured:

- **Database**: `pg_isready` every 5 seconds
- **Backend**: HTTP GET `/api/health` every 30 seconds

The backend waits for the database to be healthy before starting (`depends_on` with `condition: service_healthy`).

## Network

Services communicate over a dedicated bridge network `guardian-angel-network`. This provides:
- Service discovery (containers can reference each other by service name)
- Network isolation from other Docker networks
- Automatic DNS resolution

## Volumes

- `pgdata`: Persistent PostgreSQL data storage

Data persists across container restarts. Use `docker-compose down -v` to remove volumes.
