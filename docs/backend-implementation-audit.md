# Backend Implementation Audit

**Reviewed:** 17 July 2026  
**Reference:** `guardian_angel_backend_architecture.md`  
**Scope:** backend implementation, shared Socket.io contract, backend documentation, and tests. Mobile platform-generated files are listed by role but were not used to judge the backend.

## Verdict

**Partially matches.** The backend implements the main runtime capabilities: JWT-authenticated Express and Socket.io services, group creation/joining, live telemetry, offline bulk synchronisation, persistence, SOS creation, last-known-location broadcasts, and protected history queries.

It does **not** currently match the reference and shared contracts at the API/schema level. The running implementation has moved from the documented `RideRoom` / `room_token` model to an `active_riders` / `group_code` model without updating its contracts, README, architecture document, or tests. This makes client integration unsafe until one model is chosen and all artifacts are aligned.

## Requirement comparison

| Architecture requirement | Status | Evidence / gap |
|---|---|---|
| Node.js, Express, Socket.io | Matches | `backend/src/index.ts` composes Express and Socket.io. |
| PostgreSQL + PostGIS | Partial | PostgreSQL is used, but `backend/src/db.ts` does not create the PostGIS extension or store/index a geometry column. |
| Authenticated REST and sockets | Partial | JWT is applied to protected REST endpoints and socket handshakes. The active token/user payload uses `name`, whereas docs/contracts use `username`. |
| Cryptographic session/room token | Partial | An 8-byte random uppercase hex `group_code` is generated. It is not the documented `room_token`, and the schema has no distinct room/session record. |
| Create/join multi-rider sessions | Partial | Creation and joining work through rows in `active_riders`; a room is inferred from a shared group code rather than represented by `ride_rooms` and `room_members`. |
| Live telemetry and group broadcast | Partial | `location:update` persists and broadcasts to group peers, but emitted payload uses `name` rather than contract-required `username`. |
| Offline bulk sync with precise acknowledgement | Partial | It returns `confirmedClientReadingIds` and has a 500-reading cap. It lacks per-reading validation and uses sequential upserts rather than an atomic batch. |
| Conflict resolution | Matches, with caveat | `UNIQUE(user_id, device_timestamp)` plus `ON CONFLICT ... DO UPDATE` implements timestamp-keyed overwrite. This is not true last-write-wins based on server ordering; the last processed duplicate wins. |
| Disconnect / last known position | Partial | Implemented, but the lookup is by user only, not by user and group; a rider's last location from another group could be emitted. |
| SOS to ride room and Guardian Portal | Partial | SOS is stored and emitted to the Socket.io group. There is no Guardian Portal namespace, endpoint, authorization model, or separate delivery integration. |
| REST health endpoint | Matches | `GET /api/health` is public and returns health/timestamp. |
| Group access isolation | Partial | History queries and socket join verify membership. Membership is not rechecked for every subsequent socket update, and room identity naming diverges from the contract. |
| TLS for all traffic | Not demonstrated | The application creates an HTTP server. Documentation says TLS is expected at a proxy, but deployment/proxy configuration is absent. |
| Rate/abuse protection | Partial | REST join attempts are rate-limited; socket events are not rate-limited. |

## High-priority mismatches to resolve

1. **Choose and enforce one public model.** The reference, `contracts/`, `backend/README.md`, and tests require `room_token`, `room_id`, and `username`; mounted code requires/returns `group_code` and `name`.
2. **Fix build configuration.** `npm run build` fails under the installed TypeScript with `TS5103` because `tsconfig.json` sets an unsupported `ignoreDeprecations: "6.0"` value.
3. **Repair or replace the tests.** `npm test` has 17 tests: 2 pass and 15 fail. Tests exercise the superseded contract and JWTs with `username`, while the active socket controller requires `name`.
4. **Synchronize the schema with the chosen architecture.** Current runtime tables are `users`, `active_riders`, `notification_subdivision`, `emergency_alarms`, and `engine_heartbeat`; they are not the documented normalized `ride_rooms`, `room_members`, `telemetry_readings`, and `emergency_alerts` schema.
5. **Complete safety/security gaps.** Add validation for crash and bulk-reading data, Socket.io event rate limits, a portal delivery/access layer, group-scoped last-known lookups, and a real production TLS deployment definition. Add PostGIS only if geospatial queries are a requirement.

## Files and responsibilities

### Repository documentation and contracts

| File | Responsibility / audit note |
|---|---|
| `README.md` | Short project map; accurately identifies modules but not the active API vocabulary. |
| `CONTRIBUTING.md` | Contribution workflow and module ownership guidance. |
| `guardian_angel_backend_architecture.md` | Original backend reference used for this audit; specifies the `RideRoom`/token model. |
| `docs/architecture.md` | Intended current backend specification; detailed but stale against mounted implementation. |
| `docs/DATABASE_SETUP.md` | PostgreSQL/PostGIS installation and environment setup; overstates schema alignment with current tables. |
| `docs/SRS-mapping.md` | Empty placeholder; currently provides no requirements mapping. |
| `docs/audit-flaws-and-fixes.md` | Prior audit/remediation notes; supporting project documentation. |
| `docs/ER diagram.jpg` | Visual database design source; implementation uses its legacy-style entity names. |
| `contracts/websocket-events.md` | Human-readable Socket.io contract; stale (`room_token`, `username`, `alert_id`). |
| `contracts/websocket-events.ts` | Type definitions for the shared contract; stale for the same fields and not imported by backend handlers. |
| `docs/backend-implementation-audit.md` | This evidence-based comparison and file responsibility report. |

### Backend configuration and entry points

| File | Responsibility / audit note |
|---|---|
| `backend/package.json` | Backend scripts and dependencies. Defines build/test/dev/demo commands. |
| `backend/package-lock.json` | Locked dependency versions. |
| `backend/tsconfig.json` | TypeScript compiler configuration; currently blocks builds because of `ignoreDeprecations`. |
| `backend/jest.config.js` | Jest/TypeScript test configuration. |
| `backend/README.md` | Backend API and feature guide; describes the old room-token public contract. |
| `backend/src/config.ts` | Loads environment settings: JWT config, port, CORS origins, body size, bulk cap. Requires JWT secret outside tests. |
| `backend/src/index.ts` | Composition root: creates services/routes/socket controller and starts schema setup/server. |

### Database layer

| File | Responsibility / audit note |
|---|---|
| `backend/src/db.ts` | Creates the pool-facing query function and initializes current legacy-named PostgreSQL schema/indexes. No PostGIS geometry or extension. |
| `backend/src/db/DatabasePool.ts` | Owns the PostgreSQL connection pool and exposes connection/query operations. |
| `backend/src/db/QueryRunner.ts` | Injectable wrapper around database queries, mainly enabling service tests. Its comments claim mock fallback, but no fallback implementation exists. |

### Authentication and REST API

| File | Responsibility / audit note |
|---|---|
| `backend/src/middleware/AuthMiddleware.ts` | JWT verification for Express and Socket.io; attaches `{ id, name }` to requests/sockets. |
| `backend/src/middleware/auth.ts` | Compatibility re-export for the renamed authentication middleware. |
| `backend/src/routes/AuthRouter.ts` | **Mounted** registration/login router; accepts and returns `name`. |
| `backend/src/routes/RoomRouter.ts` | **Mounted** health, group creation/joining, and protected group history routes; uses `group_code`. |
| `backend/src/routes/auth.ts` | Older, unmounted auth router using `username` and a `users.username` column that current schema does not create. |
| `backend/src/routes/rooms.ts` | Older, unmounted room router retained from the documented `ride_rooms` model. |

### Socket controller and handlers

| File | Responsibility / audit note |
|---|---|
| `backend/src/sockets/RideSocketController.ts` | Authenticates Socket.io connections and wires all per-socket handlers. Requires JWT `name`. |
| `backend/src/sockets/rideSocket.ts` | Older socket implementation retained alongside the controller; not mounted by `index.ts`. |
| `backend/src/handlers/SessionHandler.ts` | Joins/leaves `group:<group_code>` channels after membership verification. Emits `name` where contract specifies `username`. |
| `backend/src/handlers/LocationHandler.ts` | Validates one live reading, persists it, and broadcasts it. It broadcasts even if the telemetry service absorbed a database-write failure. |
| `backend/src/handlers/BulkSyncHandler.ts` | Accepts bounded offline batches and returns confirmed local IDs via callback or event; does not validate individual readings. |
| `backend/src/handlers/CrashHandler.ts` | Records a countdown-expired SOS and broadcasts it to group sockets; candidate crashes are only logged. Payload uses `alarm_no` and `name`, not contract fields. |
| `backend/src/handlers/DisconnectHandler.ts` | Emits a peer's latest known coordinate on socket disconnect; lookup should be group scoped. |

### Domain services

| File | Responsibility / audit note |
|---|---|
| `backend/src/services/UserService.ts` | Registers users, hashes passwords, authenticates, and signs JWTs with `{ id, name }`. |
| `backend/src/services/RoomService.ts` | Generates group codes and implements membership/history over `active_riders` and `engine_heartbeat`. |
| `backend/src/services/TelemetryService.ts` | Saves live/bulk telemetry into `engine_heartbeat` with timestamp conflict upserts. |
| `backend/src/services/EmergencyAlertService.ts` | Creates, resolves, and queries alerts in `emergency_alarms`. |
| `backend/src/services/PresenceService.ts` | Reads a user's latest heartbeat for disconnect notifications. |

### Tests and demo

| File | Responsibility / audit note |
|---|---|
| `backend/tests/auth.test.ts` | Tests old `username` request/response fields; fails against mounted `name` router. |
| `backend/tests/rooms.test.ts` | Tests old room-token routes/messages; mostly fails against active group-code API. |
| `backend/tests/telemetry.test.ts` | Socket integration tests with `username` JWT payload and old room SQL assumptions; all three tests time out. |
| `backend/demo/simulate_client.ts` | Manual end-to-end client simulation. It should be reviewed after the contract decision because README promises the old model. |

### Mobile application and native support

| File/group | Responsibility |
|---|---|
| `mobile/App.tsx`, `mobile/index.js` | React Native application entry/UI. |
| `mobile/package.json`, `mobile/package-lock.json`, `mobile/tsconfig.json`, `mobile/babel.config.js`, `mobile/metro.config.js`, `mobile/jest.config.js`, `mobile/Gemfile`, `mobile/app.json`, `mobile/README.md` | Mobile build, tooling, metadata, and documentation. |
| `mobile/__tests__/App.test.tsx` | Mobile application test. |
| `mobile/android/**` | Android Gradle configuration, Kotlin native entry points, resources, launcher assets, and debug signing material. |
| `mobile/ios/**` | iOS CocoaPods/Xcode configuration, Swift native entry point, launch/privacy configuration, and app icon assets. |

## Verification performed

- `npm run build` in `backend/`: **failed** with `TS5103` (`ignoreDeprecations` value invalid for installed TypeScript).
- `npm test` in `backend/`: **failed** — 3 suites failed; 2/17 tests passed. Failures are consistent with the documented-versus-mounted API/JWT mismatch.
