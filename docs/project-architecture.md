# Guardian Angel project architecture

This document describes the repository as implemented on 17 July 2026. It is
intended to be the practical reference for contributors: it explains how the
parts communicate, what each source/configuration file owns, and both the
legacy relational schema and the PostGIS ride-tracking schema that currently
coexist in the backend.

> **Important contract note:** the running server uses `name` and
> `group_code`; the shared `contracts/` files and some older documents use
> `username` and `room_token`. New client work must follow the mounted routes
> and handlers until the team deliberately standardises the vocabulary.

## 1. System at a glance

Guardian Angel is a group-ride safety system. A React Native app authenticates
with a Node.js backend, joins a live ride group, streams GPS telemetry through
Socket.io, caches/replays offline readings, and broadcasts SOS and disconnect
notifications to the other group members. PostgreSQL stores accounts, alert
data, membership, and spatial ride data. PostGIS provides meter-based spatial
queries and indexes.

```text
React Native mobile app
  | HTTPS REST: registration, login, group creation/join/history, health
  | Socket.io: authenticated live ride events
  v
Express + Socket.io (`backend/src/index.ts`)
  | routes -> services -> QueryRunner -> PostgreSQL pool
  | socket controller -> event handlers -> services
  v
PostgreSQL + PostGIS
  |- legacy account / alert / heartbeat tables
  `- normalized ride-room / telemetry / geofence tables
```

The mobile folder currently contains the standard React Native starter screen.
The GPS, crash-detection, offline SQLite, weather, and ride UI modules are
planned by the project structure and shared contract, but are not yet present
in `mobile/src/`.

## 2. Runtime request and event flows

### Authentication and REST

1. `POST /api/auth/register` accepts `name`, `password`, and `phone`.
   `UserService` bcrypt-hashes the password and inserts `users`.
2. `POST /api/auth/login` validates credentials and returns a 24-hour JWT with
   `id` and `name` claims, plus configured issuer and audience.
3. Protected endpoints pass through `AuthMiddleware.authenticateJWT`, which
   verifies the bearer token and attaches its user claims to `req.user`.
4. `POST /api/rooms` creates a random uppercase 16-character `group_code`,
   hashes it with SHA-256, writes `ride_rooms`, and makes the creator a member.
   The raw code is returned once; only its hash is stored.
5. `POST /api/rooms/join` checks the hashed code, active room state, and adds
   the caller to `room_members`. It is limited to 10 attempts per 15 minutes.
6. `GET /api/rooms/:groupCode/history` confirms membership, then returns the
   room's ordered spatial telemetry history. `GET /api/health` is public.

### Live ride and offline recovery

1. The app connects to Socket.io with its JWT in `auth.token` (or an
   Authorization header). Socket middleware authenticates it before the
   controller installs handlers.
2. The client sends `session:join` with `{ group_code }`. Membership is
   checked and the socket joins `group:<group_code>`.
3. A `location:update` is range-checked, written to `telemetry_readings`, and
   emitted as `location:broadcast` to the other sockets in the group.
4. `telemetry:bulkSync` accepts up to `MAX_BULK_BATCH` (500 by default)
   offline readings. The service uses a set-based JSONB insert and returns the
   successfully inserted client IDs, either through the Socket.io callback or
   `telemetry:bulkSyncAck`.
5. The unique keys prevent duplicate replays. A live reading with the same
   `(room_id, user_id, device_timestamp_ms)` updates its location/accuracy/
   speed; bulk sync ignores an existing `(user_id, client_reading_id)`.
6. The insert trigger refreshes `rider_current_locations` only if the incoming
   reading is not older than the current saved point.

### Crash and disconnect safety events

- `crash:candidate` is currently recorded in the server log only.
- `crash:countdownExpired` creates an `emergency_alarms` row, then emits
  `sos:broadcast` to the Socket.io group.
- On socket disconnection, the server reads the latest legacy
  `engine_heartbeat` location for that user and emits `peer:lastKnown` to the
  remaining group sockets. This lookup is not yet group-scoped.

## 3. Backend components

| Layer | Files | Responsibility |
|---|---|---|
| Composition | `src/index.ts` | Builds Express/HTTP/Socket.io, creates one service per domain, mounts the two routers, registers the socket controller, initializes the schema, and starts the server. |
| Configuration | `src/config.ts` | Loads `.env`, validates the JWT secret outside tests, and exports port, CORS origins, body-size limit, and bulk limit. |
| Data access | `src/db.ts`, `src/db/DatabasePool.ts`, `src/db/QueryRunner.ts` | Owns PostgreSQL pooling, creates extensions/tables/indexes/triggers at startup, and supplies an injectable query function to services. |
| REST | `src/routes/AuthRouter.ts`, `src/routes/RoomRouter.ts` | Implements the mounted public HTTP API and input/error handling. |
| Authentication | `src/middleware/AuthMiddleware.ts` | Verifies JWTs for Express and Socket.io, supporting issuer/audience tokens and older unsigned-claim-format tokens as a fallback. |
| Domain services | `src/services/*.ts` | Keeps user, ride group, telemetry, emergency, and presence database logic separate from transports. |
| Realtime | `src/sockets/RideSocketController.ts`, `src/handlers/*.ts` | Authenticates a connection, creates per-socket room state, and isolates each event family in its own handler. |
| Advanced spatial queries | `src/repositories/PostgisTelemetryRepository.ts` | A reusable direct-`pg` repository for transactional PostGIS inserts, track distance, geofence, and nearby-rider queries. It is not wired into `index.ts` yet. |

## 4. Database architecture

`initDb()` creates all tables listed below in a transaction. The Docker setup
also applies `sql/postgis_schema.sql` to a brand-new database. Do not run both
against an existing database without reviewing migrations; they are largely
idempotent but schema changes still require change control.

### 4.1 Relationships

```text
users 1 --- * ride_rooms          (creator_id)
users * --- * ride_rooms          (room_members)
ride_rooms 1 --- * telemetry_readings
users 1 --- * telemetry_readings
ride_rooms 1 --- * rider_current_locations
users 1 --- * rider_current_locations

users 1 --- * active_riders
users 1 --- * engine_heartbeat
users 1 --- * emergency_alarms
active_riders 0..1 --- * emergency_alarms
notification_subdivision 0..1 --- * emergency_alarms

geofences is independent reference/safety-boundary data.
```

### 4.2 Core and legacy relational tables

These tables remain active because alerts and disconnect presence still query
them. `users` is shared by both models.

| Table | Columns and constraints | Purpose |
|---|---|---|
| `users` | `id` UUID PK; unique `name`; `phone`; optional `geohash`; `password_hash`; `created_at` | Registered accounts and credential storage. |
| `active_riders` | `id` UUID PK; `user_id` FK; `group_code`; optional `include_id` FK; `geohash`; operation/status; `joined_at`; unique `(user_id, group_code)` | Legacy representation of a rider participating in a group. The current room service does not write it. |
| `notification_subdivision` | UUID PK and optional `field_id`, `group_id`, `take_id`, `take_ofcl`, `type_area` | Legacy notification-routing metadata. |
| `emergency_alarms` | `alarm_no` UUID PK; `user_id` FK; optional `active_rider_id`/`notification_subdivision_id` FKs; correlation and expiry fields; coordinates; status; timestamps | SOS/emergency record written by `EmergencyAlertService`. |
| `engine_heartbeat` | UUID PK; user/alarm references; legacy group/status/pulse fields; scalar latitude/longitude/accuracy/speed; `device_timestamp`; unique `(user_id, device_timestamp)` | Legacy telemetry/presence table. `PresenceService` reads it on disconnect. |

### 4.3 Normalized PostGIS ride schema

| Table | Columns and constraints | Purpose |
|---|---|---|
| `ride_rooms` | `id` UUID PK; unique `token_hash`; `creator_id` FK; `created_at`; `status` in `active`/`ended`; optional `ended_at` | One ride session. Stores SHA-256 of the shareable group code, never the code itself. |
| `room_members` | composite PK `(room_id, user_id)`; both FKs cascade; `role` in `rider`/`guardian`; `joined_at` | Membership and role authorization for a ride room. |
| `telemetry_readings` | UUID PK; room/user FKs; `device_timestamp_ms`; `location GEOGRAPHY(POINT,4326)`; non-negative accuracy/speed; `synced`; UUID `client_reading_id`; `received_at`; unique client ID per user and unique timestamp per room/user | Append-only GPS history, except live timestamp conflicts update the existing row. `location` uses WGS84 longitude/latitude. |
| `rider_current_locations` | composite PK `(room_id, user_id)`; timestamp; geographic point; accuracy/speed | One latest location per rider and room; maintained from telemetry inserts. |
| `geofences` | UUID PK; `name`; `area GEOGRAPHY(POLYGON,4326)`; `type` in `hazard`/`dead_zone`; `is_active`; `created_at` | Safety zones queried by point containment. |

### 4.4 PostGIS behaviour and indexes

- `GEOGRAPHY(..., 4326)` stores WGS84 global coordinates and makes
  `ST_DWithin`, `ST_Distance`, and `ST_Length` operate in metres.
- Values must be passed as `ST_MakePoint(longitude, latitude)`—the coordinate
  order is intentionally the reverse of the mobile payload fields.
- GiST indexes on telemetry/current-location/geofence geography columns make
  radius and containment searches practical.
- B-tree indexes on membership and `(room_id, user_id, device_timestamp_ms)`
  support authorization and ordered history queries.
- `maintain_rider_current_location()` is an `AFTER INSERT` trigger. Its
  conflict clause protects the current projection from out-of-order telemetry.
- `PostgisTelemetryRepository` exposes `totalDistanceMeters`,
  `activeGeofencesAt`, and `ridersWithinMeters` as parameterized `pg` queries.

## 5. REST API actually mounted

| Method and path | Auth | Body / parameter | Behaviour |
|---|---|---|---|
| `POST /api/auth/register` | No | `{ name, password, phone }` | Validates fields, hashes password, creates account. |
| `POST /api/auth/login` | No | `{ name, password }` | Returns JWT and `{ id, name }`. |
| `GET /api/health` | No | — | Returns `{ status: "healthy", timestamp }`. |
| `POST /api/rooms` | Bearer JWT | — | Creates ride room and returns `{ room_id, group_code, creator_id }`. |
| `POST /api/rooms/join` | Bearer JWT | `{ group_code }` | Adds the authenticated user to the active room. |
| `GET /api/rooms/:groupCode/history` | Bearer JWT | URL parameter | Requires membership and returns ordered telemetry. |

## 6. Socket.io API actually implemented

All events require a valid JWT during the connection handshake. The server
uses `group:<group_code>` Socket.io rooms internally.

| Event | Direction | Runtime payload / behaviour |
|---|---|---|
| `session:join` | client -> server | `{ group_code }`; verifies membership and joins the room. |
| `session:joined` | server -> client | `{ group_code, members: [{ user_id, name }] }`. |
| `session:member_joined` / `session:member_left` | server -> peers | `{ user_id, name }`. |
| `location:update` | client -> server | `{ timestamp, latitude, longitude, accuracy, speed }`; validates, persists, broadcasts. |
| `location:broadcast` | server -> peers | Sender ID/name plus the live reading. |
| `telemetry:bulkSync` | client -> server | `{ readings }`; max 500; acknowledgement sent via callback or event. |
| `telemetry:bulkSyncAck` | server -> client | `{ confirmedClientReadingIds }`. |
| `crash:candidate` | client -> server | Logs candidate details only. |
| `crash:countdownExpired` | client -> server | Creates alert and broadcasts SOS. |
| `sos:broadcast` | server -> room | `{ alarm_no, user_id, name, timestamp, latitude, longitude }`. |
| `peer:lastKnown` | server -> peers | `{ user_id, name, timestamp, latitude, longitude }` on unexpected disconnect. |

`contracts/websocket-events.ts` and `.md` describe the intended shared
contract but currently differ in naming and a few fields. Treat them as a
coordination artifact, not an exact runtime description, until aligned.

## 7. File-by-file responsibility map

### Root, contracts, and documentation

| File | What it does |
|---|---|
| `.gitignore` | Excludes dependencies, builds, secrets, logs, and local native build products. |
| `README.md` | Short project description and top-level folder map. |
| `CONTRIBUTING.md` | Branching, ownership, mobile scaffold, and shared-contract contribution rules. |
| `guardian_angel_backend_architecture.md` | Earlier backend architecture/API reference; useful background but uses older room-token vocabulary. |
| `contracts/websocket-events.md` | Human-readable shared Socket.io contract intended for cross-team agreement. |
| `contracts/websocket-events.ts` | TypeScript interfaces for that intended Socket.io contract; not imported by the active server. |
| `docs/project-architecture.md` | This implementation-focused architecture, schema, and file reference. |
| `docs/architecture.md` | Earlier backend-focused architecture reference. |
| `docs/postgis-backend-guide.md` | Rationale and operational guidance for the PostGIS schema and repository queries. |
| `docs/DATABASE_SETUP.md` | Database installation/setup guide; portions use the earlier schema and should be reconciled before relying on it. |
| `docs/backend-implementation-audit.md` | Point-in-time audit of implementation/contract alignment. |
| `docs/audit-flaws-and-fixes.md` | Prior remediation notes. |
| `docs/SRS-mapping.md` | Requirements-to-system mapping placeholder/support document. |
| `docs/ER diagram.jpg` | Diagram asset for the database design. |

### Backend files

| File | What it does |
|---|---|
| `backend/package.json` / `package-lock.json` | Backend dependency manifest/lockfile; scripts are `dev`, `build`, `start`, `test`, and `demo`. |
| `backend/tsconfig.json` | TypeScript compiler options. |
| `backend/jest.config.js` | Jest + ts-jest test configuration. |
| `backend/.env.example` | Safe template for port, database, and JWT settings; copy to ignored `.env`. |
| `backend/docker-compose.yml` | Starts PostGIS 16/3.4, persists its data, and initializes a new database with the SQL schema. |
| `backend/README.md` | Backend usage/API guide; contains older public naming in places. |
| `backend/sql/postgis_schema.sql` | Transactional PostGIS schema migration: extensions, normalized tables, indexes, trigger, and geofences. |
| `backend/src/index.ts` | Server composition root and startup. |
| `backend/src/config.ts` | Environment configuration and safe defaults. |
| `backend/src/db.ts` | PostgreSQL query export and automatic legacy + PostGIS schema initialization. |
| `backend/src/db/DatabasePool.ts` | Encapsulates `pg.Pool`, connection acquisition, queries, and pool error state. |
| `backend/src/db/QueryRunner.ts` | Injectable adapter used by services; makes service database calls mockable in tests. |
| `backend/src/middleware/AuthMiddleware.ts` | REST/WebSocket JWT authentication and typed request/socket identities. |
| `backend/src/middleware/auth.ts` | Deprecated compatibility re-export for older lowercase imports. |
| `backend/src/routes/AuthRouter.ts` | Mounted register/login routes using `name`. |
| `backend/src/routes/RoomRouter.ts` | Mounted health/create/join/history group routes using `group_code`. |
| `backend/src/routes/auth.ts` | Older unmounted auth router using `username`; retained only as legacy code. |
| `backend/src/routes/rooms.ts` | Older unmounted room router using `room_token`; retained only as legacy code. |
| `backend/src/services/UserService.ts` | Password hashing, registration, login/JWT signing, optional geohash update. |
| `backend/src/services/RoomService.ts` | Group-code generation/hashing, room creation, membership, history, and end-room actions. |
| `backend/src/services/TelemetryService.ts` | Live and bulk spatial telemetry persistence plus nearby-rider query. |
| `backend/src/services/EmergencyAlertService.ts` | Creates, resolves, and lists legacy emergency alarm records. |
| `backend/src/services/PresenceService.ts` | Fetches latest legacy heartbeat for disconnect notification. |
| `backend/src/repositories/PostgisTelemetryRepository.ts` | Standalone parameterized advanced spatial repository. |
| `backend/src/sockets/RideSocketController.ts` | Socket connection composition and per-socket handler registration. |
| `backend/src/sockets/rideSocket.ts` | Empty deprecated compatibility stub; no runtime behaviour. |
| `backend/src/handlers/SessionHandler.ts` | Socket join/leave and group room state. |
| `backend/src/handlers/LocationHandler.ts` | Live telemetry validation, save, and peer broadcast. |
| `backend/src/handlers/BulkSyncHandler.ts` | Offline batch-size validation and sync acknowledgement. |
| `backend/src/handlers/CrashHandler.ts` | Candidate logging and confirmed SOS creation/broadcast. |
| `backend/src/handlers/DisconnectHandler.ts` | Last-known-location broadcast on disconnect. |
| `backend/tests/auth.test.ts` | Authentication route tests. |
| `backend/tests/rooms.test.ts` | Room create/join/history tests. |
| `backend/tests/telemetry.test.ts` | Socket telemetry and bulk-sync tests. |
| `backend/demo/simulate_client.ts` | Manual end-to-end API/socket simulation client. |

### Mobile files

| File/group | What it does |
|---|---|
| `mobile/App.tsx` | Current React Native starter UI: safe-area provider, adaptive status bar, and new-app screen. |
| `mobile/index.js` | Registers `App` with React Native using the name in `app.json`. |
| `mobile/app.json` | App display/bundle metadata. |
| `mobile/package.json` / `package-lock.json` | React Native dependencies and Android/iOS/start/test/lint scripts. |
| `mobile/tsconfig.json`, `babel.config.js`, `metro.config.js`, `jest.config.js` | TypeScript, transpilation, Metro bundling, and Jest configuration. |
| `mobile/Gemfile`, `mobile/ios/Podfile` | Ruby/CocoaPods dependency tooling for iOS. |
| `mobile/README.md` | Standard React Native setup and run instructions. |
| `mobile/__tests__/App.test.tsx` | Starter UI render test. |
| `mobile/android/settings.gradle`, `build.gradle`, `gradle.properties`, `gradlew*`, `gradle/wrapper/*` | Android Gradle project and wrapper configuration. |
| `mobile/android/app/build.gradle`, `proguard-rules.pro`, `src/main/AndroidManifest.xml` | Android app module, shrinker rules, and app manifest. |
| `mobile/android/app/src/main/java/**/MainActivity.kt`, `MainApplication.kt` | Kotlin Android activity and React Native application bootstrap. |
| `mobile/android/app/src/main/res/**` | Android launcher icons, strings, styles, drawable, and resource variants. |
| `mobile/android/app/debug.keystore` | Development-only Android debug signing key. |
| `mobile/ios/GuardianAngelMobile.xcodeproj/**` | Xcode project and shared scheme metadata. |
| `mobile/ios/GuardianAngelMobile/AppDelegate.swift` | Swift iOS application/React Native bootstrap. |
| `mobile/ios/GuardianAngelMobile/Info.plist` | iOS application metadata and permissions configuration. |
| `mobile/ios/GuardianAngelMobile/PrivacyInfo.xcprivacy` | iOS privacy manifest. |
| `mobile/ios/GuardianAngelMobile/LaunchScreen.storyboard` | iOS launch screen. |
| `mobile/ios/GuardianAngelMobile/Images.xcassets/**` | iOS app-icon asset catalog. |

## 8. Operations and change rules

- Set a strong `JWT_SECRET`, a real `DATABASE_URL`, explicit `ALLOWED_ORIGINS`,
  and production TLS termination before deployment.
- Keep `.env` out of version control. Use `backend/.env.example` as the
  template.
- Any change to a socket event name or payload must update both files in
  `contracts/` and the mobile/backend implementation together.
- Before relying on alerts/presence in production, reconcile the legacy
  `engine_heartbeat`/`active_riders` writes with the newer PostGIS model; the
  current alert and disconnect code still depend on legacy tables.
- Prefer the normalized PostGIS tables for new telemetry, room, proximity, and
  geofence work; avoid introducing new scalar latitude/longitude history
  tables.
