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
mobile/           React Native app (telemetry, safety, Post-Ride Summary UI)
contracts/        Shared WebSocket & REST contract specs (types + docs, ride-summary.ts)
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
src/services/WeatherService.ts        Weather provider client + in-memory cache + centroid calc
src/services/GroupCoherenceService.ts Group separation detection + midpoint & speed recommendations

src/routes/WeatherRouter.ts           GET /api/rooms/:groupCode/weather


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
| `vehicle_breakdowns` | Manual vehicle breakdown reports (reason, note, location, timestamps) |
| `device_tokens` | FCM push notification registration per user and platform |
| `medical_info` | Voluntary rider medical ID (blood group, allergies, emergency contacts, notes) |

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
| GET | `/api/rooms/:groupCode/weather` | Current weather at ride centroid (active rooms only) |
| POST | `/api/geofences` | Create geofence (name, type, area as coordinate array) |
| GET | `/api/geofences` | List active geofences |
| PATCH | `/api/geofences/:id` | Update geofence fields (name, type, is_active) |
| DELETE | `/api/geofences/:id` | Soft-delete (set is_active=false) |
| GET | `/api/safety/config` | Retrieve crash detection threshold configuration (13 tunable parameters — see DetectionConfig in mobile/src/safety/crash/types.ts) |
| GET | `/api/safety/stats` | Retrieve crash outcome analytics and false positive metrics (admin-only) |
| POST | `/api/devices/register` | Register/upsert FCM device push token (token, platform) |
| POST | `/api/users/medical-info` | Upsert authenticated user's medical ID info |
| GET | `/api/users/medical-info` | Fetch authenticated user's medical ID info |
| DELETE | `/api/users/medical-info` | Delete authenticated user's medical ID info |
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
| `sos:broadcast` | Server → Room | Emergency alert to all members (includes optional `medical_info`) |
| `group:separationAlert` | Server → Room | Separation alert + midpoint & recommended speeds |
| `group:reunited` | Server → Room | Notification when separated rider rejoins group |
| `vehicle:breakdown` | Client → Server | Rider manually reports breakdown (optional reason/note) |
| `vehicle:breakdownReported` | Server → Room | Breakdown broadcast to room members (includes optional `medical_info`) |
| `vehicle:breakdownResolved` | Server → Room | Broadcast when rider marks breakdown resolved |

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
| `weather.test.ts` | Weather endpoint (auth, membership, active-room guard, provider mock, cache, centroid, WMO mapping) |
| `group-coherence.test.ts` | Nearest-rider separation detection, strung-out formation isolation, speed caps, reunion trigger, 30s cooldown |
| `vehicle-breakdown.test.ts` | Vehicle breakdown report/resolution, FCM token registration, push notification failure isolation, and group coherence alert suppression |
| `medical-info.test.ts` | Medical ID upsert/fetch/delete, blood group enum & E.164 phone validation, auth scoping, and alert payload integration |

All tests use mocked `db.query` via `jest.mock('../src/db')` — no live database needed.

## Group Coherence & Reunion Guidance

**V1 Implementation Scope:**
- **Separation Detection:** Triggers when a rider's distance to the **nearest other rider** exceeds 500 meters for $\ge 30$ seconds. Nearest-rider distance is specifically used (rather than centroid distance) to prevent false positives for motorcycle groups riding in normal strung-out linear formation.
- **Meeting Point:** Straight-line (haversine) midpoint between separated rider and group centroid, labeled `is_approximate: true`.
- **Speed Math & Safety Caps:** Computes equal-arrival target speeds. Separated rider speed increase is capped at max +15% and $+15\text{ km/h}$ ($+4.17\text{ m/s}$). Main group speed decrease is capped at max -20% and $-15\text{ km/h}$ ($-4.17\text{ m/s}$). If either side is stationary ($\le 1.4\text{ m/s}$ / $5\text{ km/h}$), `recommended_speed` is set to `null` to gracefully degrade.
- **Cooldown & Reunion:** 30-second cooldown between re-emitting `group:separationAlert`. Reunion triggers (`group:reunited`) when distance drops $\le 300\text{ meters}$ for $\ge 15$ seconds to prevent threshold flapping.
- **V2 Deferred Work:** Road-aware routing engines (OSRM/Google Maps) and route-distance/ETA speed calculations are explicitly deferred.


## Weather Module

**Provider:** Open-Meteo (no API key, no billing, 10k requests/day free tier). Chosen for capstone scope — no budget, good-enough accuracy for "expect rain?" use case.

**Update model:** Pull with cache. `GET /api/rooms/:groupCode/weather` fetches on demand; results cached in-memory per room with 5-minute TTL. Push (periodic Socket.IO broadcast) deferred as a v2 enhancement.

**Location derivation:** Arithmetic mean (centroid) of all riders in `rider_current_locations` for the room. Returns `weather: null, reason: "no_location_data"` if no telemetry has been received yet.

**Active-room restriction:** Endpoint returns 409 for ended rooms. Current weather for an ended ride would be misleading — this is not historical weather-at-ride-time.

**Failure isolation:** 5-second AbortController timeout on the provider call. On any failure, returns `weather: null, reason: "provider_unavailable"` with 200 status. Never blocks or slows safety-critical paths.

**WMO code mapping:** `mapWeatherCode()` in `WeatherService.ts` — pure function mapping numeric WMO weather codes to human-readable condition strings (clear_sky, rain, thunderstorm_with_hail, etc.). Exported and unit-tested independently.

**Response shape:**
```json
{
  "weather": {
    "condition": "partly_cloudy",
    "temperature_celsius": 28.5,
    "precipitation_probability": 40,
    "wind_speed_kmh": 12.3,
    "fetched_at": "2026-07-24T10:30:00Z"
  },
  "location": { "latitude": 14.5123, "longitude": 121.0456 }
}
```

**Known limitations:**
- In-memory cache means a server restart clears it (acceptable for project scale; not a bug to fix now)
- Centroid uses arithmetic mean — accurate for group rides within a few km, but would need a proper geographic centroid for continent-scale spread (not a real scenario)
- No weather-based alerting or route-hazard logic (future feature — would need its own design)

## Crash Detection Thresholds (Unvalidated)

**CRITICAL:** All crash detection threshold values in this project are **provisional and untested**. No real-world crash testing or bench validation has been performed. The values in `/api/safety/config` and `DEFAULT_DETECTION_CONFIG` are engineering estimates based on literature review, not validated against actual motorcycle crash data.

Current thresholds (from `mobile/src/safety/crash/types.ts` `DEFAULT_DETECTION_CONFIG`):
- `magnitudeThresholdG: 4.0` — peak acceleration spike in g-forces
- `jerkThreshold: 150` — rate of acceleration change in m/s³
- `postEventWindowMs: 4000` — duration to watch for post-impact stillness/tumbling
- `speedGateKmh: 15` — minimum pre-event speed to consider detection
- See full config in types.ts for all 13 tunable parameters

**Do not adjust these values without real testing data.** Lowering thresholds increases false positives (alerts during normal riding); raising them risks missing real crashes. Real-world validation is an outstanding task, not yet scheduled.

The backend endpoint `GET /api/safety/config` returns these exact values to allow remote tuning without app updates once validation data is available.

## Known Gaps / Deferred Work

- **Crash detection threshold validation**: No real-world or bench testing has been performed. Current values are literature-based estimates only. This is a **mandatory pre-production task**, requires controlled crash testing or validated simulation data
- **Mobile safety module**: `mobile/src/safety/` implements crash detection (`CrashDetector` state machine, `CountdownTimer`, `OverrideController`), with configurable detection thresholds via `GET /api/safety/config` (finding 5.5) and sample rate health tracking (finding 5.6)
- **Weather push model**: Server could poll weather per active room and broadcast `weather:update` via Socket.IO — deferred, pull-with-cache is sufficient for v1
- **Guardian Portal** (web observer UI): Deferred until after midterm defense
- **Geofences**: CRUD endpoints exist; any authenticated user can create/modify/soft-delete geofences (deliberate scope decision for now, not an oversight — must add role-based restriction before production)
- **Role-based permissions**: All authenticated users have equal access; admin/guardian restrictions deferred
- **Telemetry speed in crash_candidates**: Populated from `rider_current_locations` — if no telemetry has been received yet for that ride, speed will be null

## Security & Resilience Fixes (Audit Remediation)

The following backend hardening measures were resolved per the July 31, 2026 Safety Audit:
- **JWT Fallback Secret Removed**: Hardcoded JWT fallback secret deleted; server fails fast if `JWT_SECRET` is unset.
- **Auth Rate Limiting**: `/api/auth/login` and `/api/auth/register` protected with `express-rate-limit` (5 attempts / 15-min window).
- **CORS Whitelist**: Explicit origin checking against `ALLOWED_ORIGINS` with `credentials: true`.
- **Password Complexity**: Enforced minimum 8 chars, 1 uppercase, 1 lowercase, 1 number on registration.
- **Input Length & Format Limits**: Enforced username $\le 50$, password $\le 128$, phone $\le 20$ chars, and strict E.164 phone format (`/^\+[1-9]\d{1,14}$/`).
- **Telemetry & Bounds Validation**: Coordinates, speed ceiling ($200\text{ m/s}$), relative timestamps (past 24h to future 5min), and `MAX_BULK_BATCH` enforced.
- **UUID Format Validation**: Route params expecting UUID format validated before database access.
- **Room Token Keyspace**: Group code generation updated to 12 hex characters (6 random bytes).
- **Crash Rate Limiting & Safety Endpoints**: Client crash events rate-limited to max 3 / 60s per user; central `/api/safety/config` and `/api/safety/stats` analytics endpoints added.
- **Graceful Shutdown & Audit Logging**: `SIGTERM`/`SIGINT` handlers added with a 30s drain window, structured audit logging via `winston`.

- **Room resolution race**: `resolveRoomId` (via token_hash) is called independently at several points rather than cached once at session:join. A rare race exists where a room ending mid-flow leaves `emergency_alarms.room_id` as NULL for that alert (cosmetic/audit-only impact — confirmed via testing that outcome tracking and SOS broadcast are unaffected). A cleaner fix would cache room_id in socket roomState at session:join and thread it through everywhere instead of re-resolving; deferred as a broader refactor, not urgent.
