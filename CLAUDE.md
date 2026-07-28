# Guardian Angel

Real-time safety platform for group motorcycle rides. Detects crashes via on-device sensors, broadcasts SOS alerts to ride group members and guardians.

## Tech Stack

| Layer | Stack |
|-------|-------|
| Mobile | React Native 0.86 + TypeScript (single codebase, iOS/Android) |
| Backend | Node.js + Express + Socket.IO + TypeScript |
| Database | PostgreSQL with PostGIS extension |
| Auth | JWT (bcryptjs for password hashing) |
| Shared | `contracts/` — TypeScript interfaces + markdown spec for all WebSocket events |

## Repository Layout

```
backend/          Node.js server (sessions, sockets, REST, DB)
mobile/           React Native app (telemetry, safety, UI)
contracts/        Shared WebSocket event contract (types + docs)
docs/             Architecture docs, audit reports, ER diagram
```

## Backend Architecture

Class-based, constructor-injected services. All DB access goes through `QueryRunner` (thin wrapper over `pg.Pool`), which is the single surface mocked in tests.

### Key Modules

```
src/index.ts                    Composition root (DI wiring, Express + Socket.IO setup)
src/db.ts                       Schema init (CREATE TABLE IF NOT EXISTS, idempotent)
src/db/QueryRunner.ts           Injectable query function, mockable in tests
src/db/DatabasePool.ts          pg.Pool singleton with error tracking

src/routes/AuthRouter.ts        POST /api/auth/register, /api/auth/login
src/routes/RoomRouter.ts        POST /api/rooms, /api/rooms/join; GET history, summary

src/sockets/RideSocketController.ts   WebSocket connection handler, instantiates per-socket handlers
src/handlers/SessionHandler.ts        session:join, session:leave
src/handlers/LocationHandler.ts       location:update → broadcast + persist
src/handlers/BulkSyncHandler.ts       telemetry:bulkSync → batch insert
src/handlers/CrashHandler.ts          crash:candidate, crash:countdownExpired, crash:cancelled
src/handlers/DisconnectHandler.ts     cleanup on socket disconnect

src/services/UserService.ts           Registration, login, password hashing
src/services/RoomService.ts           Room CRUD, membership verification
src/services/TelemetryService.ts      Single-reading persistence
src/services/EmergencyAlertService.ts SOS alert creation/resolution
src/services/PresenceService.ts       Online/offline tracking

src/repositories/PostgisTelemetryRepository.ts   Spatial queries (distance, nearby, geofences)
src/repositories/CrashCandidateRepository.ts     Crash candidate persistence + outcome tracking
```

### Database Schema (PostGIS — source of truth)

| Table | Purpose |
|-------|---------|
| `users` | Accounts (id UUID, name, phone, password_hash) |
| `ride_rooms` | Ride sessions (token_hash SHA-256 of group code, status active/ended) |
| `room_members` | Many-to-many room membership (rider/guardian roles) |
| `telemetry_readings` | Append-only GPS track (GEOGRAPHY POINT, speed, accuracy) |
| `rider_current_locations` | Latest position per rider/room (trigger-maintained) |
| `crash_candidates` | Persisted crash detection events with outcome tracking |
| `geofences` | Safety zones (GEOGRAPHY POLYGON, hazard/dead_zone) |
| `emergency_alarms` | SOS records (active/resolved) |

Legacy tables still in schema but not used for new paths: `active_riders`, `notification_subdivision`, `engine_heartbeat`.

### REST API Surface

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/register` | Create account (name, password, phone) |
| POST | `/api/auth/login` | Authenticate, returns JWT |
| POST | `/api/rooms` | Create ride room (returns group_code) |
| POST | `/api/rooms/join` | Join existing room by group_code |
| GET | `/api/rooms/:groupCode/history` | Telemetry history for room |
| GET | `/api/rooms/:groupCode/summary` | Distance + duration stats |
| POST | `/api/geofences` | Create geofence (name, type, area as coordinate array) |
| GET | `/api/geofences` | List active geofences |
| PATCH | `/api/geofences/:id` | Update geofence fields (name, type, is_active) |
| DELETE | `/api/geofences/:id` | Soft-delete (set is_active=false) |
| GET | `/api/health` | Server health check |

All endpoints except health require JWT in `Authorization: Bearer <token>` header.

### WebSocket Events (see `contracts/websocket-events.ts` for full types)

| Event | Direction | Purpose |
|-------|-----------|---------|
| `session:join` | Client → Server | Join ride room by group_code |
| `session:joined` | Server → Client | Confirm join + member list |
| `session:leave` | Client → Server | Leave room |
| `session:member_joined/left` | Server → Room | Membership changes |
| `location:update` | Client → Server | GPS reading |
| `location:broadcast` | Server → Room | Broadcast position to group |
| `telemetry:bulkSync` | Client → Server | Offline catch-up batch |
| `crash:candidate` | Client → Server | On-device crash detection triggered |
| `crash:countdownExpired` | Client → Server | 15s grace period elapsed, trigger SOS |
| `crash:cancelled` | Client → Server | Rider dismissed crash warning |
| `sos:broadcast` | Server → Room | Emergency alert to all members |

WebSocket auth: JWT passed in `socket.auth.token` on connection.

### Crash Detection Flow

1. Mobile detects candidate crash (accelerometer/gyroscope — module not yet implemented)
2. Client emits `crash:candidate` with timestamp + lat/lng
3. Server persists to `crash_candidates` table, pulls speed from `rider_current_locations`
4. 15-second countdown runs on device
5. If rider cancels → `crash:cancelled` → outcome set to `false_alarm`
6. If countdown expires → `crash:countdownExpired` → outcome set to `confirmed`, SOS alert created and broadcast

## Naming Conventions (Contract Vocabulary)

- **name** (not username) — user identifier in registration/login
- **group_code** (not room_token) — the plaintext invite code for a ride room
- **token_hash** — SHA-256 of group_code, stored in `ride_rooms`
- **alarm_no** (not alert_id) — UUID primary key of emergency_alarms

## Running

```bash
# Backend
cd backend
cp .env.example .env  # configure DATABASE_URL, JWT_SECRET
npm install
npm run dev           # tsx watch mode

# Tests
npm test              # jest --runInBand --detectOpenHandles
```

Environment variables: `DATABASE_URL`, `JWT_SECRET` (required in non-test), `PORT` (default 3000), `ALLOWED_ORIGINS`, `MAX_BODY_SIZE`, `MAX_BULK_BATCH`.

## Test Suites

| File | Coverage |
|------|----------|
| `auth.test.ts` | Registration + login (validation, duplicates, auth failures) |
| `rooms.test.ts` | Room creation, joining, access control, history isolation |
| `telemetry.test.ts` | WebSocket location broadcast, bulk sync |
| `disconnect.test.ts` | Room-scoped disconnect isolation |
| `summary.test.ts` | Ride summary endpoint (distance, duration, access control) |
| `crash-candidates.test.ts` | Crash candidate persistence, outcome transitions, room scoping |
| `emergency-alert.test.ts` | SOS creation with/without room_id, graceful degradation |
| `geofences.test.ts` | Geofence CRUD (create, list, update, soft-delete, validation) |

All tests use mocked `db.query` via `jest.mock('../src/db')` — no live database needed.

## Known Gaps / Deferred Work

- **Mobile safety module**: `mobile/src/safety/` is empty (.gitkeep only) — crash detection algorithm not yet implemented
- **Weather module**: Deferred until after midterm defense
- **Guardian Portal** (web observer UI): Deferred until after midterm defense
- **Geofences**: CRUD endpoints exist; any authenticated user can create/modify/soft-delete geofences (deliberate scope decision for now, not an oversight — must add role-based restriction before production)
- **Role-based permissions**: All authenticated users have equal access; admin/guardian restrictions deferred
- **Telemetry speed in crash_candidates**: Populated from `rider_current_locations` — if no telemetry has been received yet for that ride, speed will be null
- **Room resolution race**: `resolveRoomId` (via token_hash) is called independently at several points rather than cached once at session:join. A rare race exists where a room ending mid-flow leaves `emergency_alarms.room_id` as NULL for that alert (cosmetic/audit-only impact — confirmed via testing that outcome tracking and SOS broadcast are unaffected). A cleaner fix would cache room_id in socket roomState at session:join and thread it through everywhere instead of re-resolving; deferred as a broader refactor, not urgent.
