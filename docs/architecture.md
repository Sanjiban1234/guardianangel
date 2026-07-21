# Guardian Angel — Backend Architecture Reference

This document serves as the authoritative, up-to-date summary of the backend system for the Guardian Angel group-ride safety application.

---

## 1. Technology Stack

- **Runtime Environment:** Node.js (v18+)
- **Application Framework:** Express (TypeScript)
- **Real-Time Communication:** Socket.io (WebSocket)
- **Database:** PostgreSQL + PostGIS (spatial indexing for telemetry)
- **Authentication:** JSON Web Tokens (JWT) for secure REST and WebSocket handshakes

---

## 2. Database Schema (ER Diagram)

Below is the normalized relational schema design, including spatial data fields and the weather integration table:

### Table: `users`
Tracks registered motorcyclists.
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | Primary Key | Unique user identifier |
| `username` | VARCHAR(50) | Unique, NOT NULL | Nickname used in Ride Rooms |
| `password_hash` | VARCHAR(255) | NOT NULL | Bcrypt hashed password |
| `phone` | VARCHAR(20) | NOT NULL | Emergency contact / User phone |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Timestamp of account creation |

### Table: `ride_rooms`
Tracks active and historical Ride Room sessions.
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | Primary Key | Unique room identifier |
| `room_token` | VARCHAR(255) | Unique, NOT NULL | Short-lived, cryptographic token for joining |
| `creator_id` | UUID | FK references `users(id)` | User who initialized the room |
| `status` | VARCHAR(20) | NOT NULL | Status of ride (`active` or `ended`) |
| `created_at` | TIMESTAMP | DEFAULT NOW() | When room was created |
| `ended_at` | TIMESTAMP | NULLABLE | When room session was terminated |

### Table: `room_members`
Many-to-many relationship mapping users to ride rooms.
| Column | Type | Constraints | Description |
|---|---|---|---|
| `room_id` | UUID | FK references `ride_rooms(id)` ON DELETE CASCADE | Target ride room |
| `user_id` | UUID | FK references `users(id)` ON DELETE CASCADE | Target user |
| `joined_at` | TIMESTAMP | DEFAULT NOW() | When user joined the session |
| *Composite PK* | `(room_id, user_id)` | Primary Key | Enforces unique memberships |

### Table: `telemetry_readings`
Stores location and sensor telemetry. Includes a spatial `geom` field for PostGIS queries.
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | Primary Key | Unique reading identifier |
| `room_id` | UUID | FK references `ride_rooms(id)` ON DELETE CASCADE | Associated room session |
| `user_id` | UUID | FK references `users(id)` ON DELETE CASCADE | Sending user |
| `device_timestamp`| BIGINT | NOT NULL | Unix epoch (milliseconds) recorded on device |
| `latitude` | DOUBLE PRECISION| NOT NULL | Coordinate lat |
| `longitude` | DOUBLE PRECISION| NOT NULL | Coordinate lng |
| `accuracy` | REAL | NOT NULL | GPS accuracy in meters |
| `speed` | REAL | NOT NULL | Instantaneous speed in m/s |
| `geom` | GEOMETRY(Point, 4326)| INDEXED | PostGIS geometry point for spatial queries |
| *Unique Const* | `(user_id, device_timestamp)`| Unique | Resolves re-sync conflict / duplicate prevention |

### Table: `emergency_alerts`
SOS alerts triggered by manual emergency buttons or countdown expirations.
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | Primary Key | Unique alert identifier |
| `room_id` | UUID | FK references `ride_rooms(id)` ON DELETE CASCADE | Associated room |
| `user_id` | UUID | FK references `users(id)` ON DELETE CASCADE | Impacted rider |
| `timestamp` | BIGINT | NOT NULL | Unix epoch (ms) when incident occurred |
| `status` | VARCHAR(20) | NOT NULL | State (`active`, `resolved`, `false_alarm`) |
| `latitude` | DOUBLE PRECISION| NOT NULL | Coordinate lat |
| `longitude` | DOUBLE PRECISION| NOT NULL | Coordinate lng |

### Table: `weather_reports`
Stores periodic weather data fetched for ride rooms during the session.
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | Primary Key | Unique report identifier |
| `room_id` | UUID | FK references `ride_rooms(id)` ON DELETE CASCADE | Room this report applies to |
| `latitude` | DOUBLE PRECISION| NOT NULL | Weather reading location latitude |
| `longitude` | DOUBLE PRECISION| NOT NULL | Weather reading location longitude |
| `condition` | VARCHAR(50) | NOT NULL | Description (e.g. `Rainy`, `Clear`, `Windy`) |
| `temperature` | REAL | NOT NULL | Temperature in Celsius |
| `timestamp` | BIGINT | NOT NULL | Time of query |

---

## 3. WebSocket Event Contract (Shared Document)

All real-time actions occur over Socket.io. Below is a mirrored reference of [contracts/websocket-events.md](file:///c:/Users/VICTUS/Desktop/guardianangel/guardianangel/contracts/websocket-events.md). Formal TypeScript interfaces are defined in [contracts/websocket-events.ts](file:///c:/Users/VICTUS/Desktop/guardianangel/guardianangel/contracts/websocket-events.ts) for easy type-safe importing across modules.

| Event Name | Direction | Payload Shape | Description |
|---|---|---|---|
| `session:join` | Client -> Server | `{ room_token: string }` | Requests to join an active Ride Room using its short-lived join token. |
| `session:joined` | Server -> Client | `{ room_id: string, members: Array<{ user_id: string, username: string }> }` | Emitted only to the joining client with metadata and members list on success. |
| `session:member_joined` | Server -> Room | `{ user_id: string, username: string }` | Broadcast to all room members when a new rider joins. |
| `session:leave` | Client -> Server | `{}` | Requests to cleanly exit the current Ride Room. |
| `session:member_left` | Server -> Room | `{ user_id: string, username: string }` | Broadcast to room members when a rider leaves. |
| `location:update` | Client -> Server | `{ timestamp: number, latitude: number, longitude: number, accuracy: number, speed: number }` | Sends a single live telemetry point (State A). |
| `location:broadcast` | Server -> Room | `{ user_id: string, username: string, timestamp: number, latitude: number, longitude: number, accuracy: number, speed: number }` | Broadcasts rider's live position to others in the room. |
| `telemetry:bulkSync` | Client -> Server | `{ readings: Array<{ client_reading_id: string, timestamp: number, latitude: number, longitude: number, accuracy: number, speed: number }> }` | Batch push of cached offline readings (State B) upon reconnection. |
| `telemetry:bulkSyncAck` | Server -> Client | `{ confirmedClientReadingIds: Array<string> }` | Acknowledgment of bulk upload containing successfully processed client reading IDs. |
| `crash:candidate` | Client -> Server | `{ timestamp: number, latitude: number, longitude: number }` | Informs backend that a potential crash was detected and the 15s countdown has started. |
| `crash:countdownExpired`| Client -> Server | `{ timestamp: number, latitude: number, longitude: number }` | Confirms the countdown expired without rider cancellation; triggers an immediate SOS. |
| `sos:broadcast` | Server -> Room | `{ alert_id: string, user_id: string, username: string, timestamp: number, latitude: number, longitude: number }` | Broadcasts SOS alert to all room members and the web portal. |
| `peer:lastKnown` | Server -> Room | `{ user_id: string, username: string, timestamp: number, latitude: number, longitude: number }` | Broadcast when a rider suddenly disconnects from the socket. |

---

## 4. REST Endpoints

All endpoints except `POST /api/auth/register` and `POST /api/auth/login` require a bearer JWT header (`Authorization: Bearer <token>`).

### Auth Endpoints

#### `POST /api/auth/register`
Creates a new user profile.
- **Request:** `{ username: "sanjiban", password: "securepassword", phone: "+9779812345678" }`
- **Response (201):** `{ message: "User registered successfully", user: { id: "uuid", username: "sanjiban" } }`

#### `POST /api/auth/login`
Authenticates a user and generates a JWT.
- **Request:** `{ username: "sanjiban", password: "securepassword" }`
- **Response (200):** `{ token: "jwt-token-string", user: { id: "uuid", username: "sanjiban" } }`

### Ride Room Endpoints

#### `POST /api/rooms`
Creates a new Ride Room and generates a join token.
- **Request:** `{}`
- **Response (201):** `{ room_id: "uuid", room_token: "cryptographic-short-token", creator_id: "uuid" }`

#### `POST /api/rooms/join`
Joins a Ride Room by token REST-side (authorizes the member to join the socket room).
- **Request:** `{ room_token: "cryptographic-short-token" }`
- **Response (200):** `{ message: "Successfully joined room", room_id: "uuid" }`

#### `GET /api/rooms/:roomId/history`
Gets the location history for a specific room. Only authorized members of the target room can query this.
- **Request Parameters:** `roomId` (UUID)
- **Response (200):** `[ { user_id: "uuid", username: "sanjiban", device_timestamp: 1720958400000, latitude: 28.2096, longitude: 83.9856, accuracy: 8.0, speed: 12.5 }, ... ]`

#### `GET /api/health`
Connectivity status health check. Used by `ConnectivityWatcher` on mobile.
- **Request:** `{}`
- **Response (200):** `{ status: "healthy", timestamp: 1720958400000 }`

---

## 5. Session and Ride-Room Token Flow

1. **Room Creation:**
   - A rider calls `POST /api/rooms`. The server creates a `ride_rooms` row with a status of `active` and generates a secure random alphanumeric token (`room_token`).
   - The creator is automatically added as a member in `room_members`.
2. **Room Joining:**
   - Other riders submit the token via `POST /api/rooms/join`. The server verifies that the room is `active`, and adds the joining user to `room_members`.
   - The riders then open a WebSocket connection. In the WebSocket handshake, they pass their JWT in the headers/auth payload.
   - Upon connection, the client emits `session:join` containing their room token. The server verifies room membership, maps the user to their socket connection, and subscribes the socket to the room's room-specific channel (`room:<roomId>`).
3. **Leaving/Teardown:**
   - A client emits `session:leave` or disconnects. The server removes the socket from the room channel and broadcasts `session:member_left` or `peer:lastKnown` to the room.

---

## 6. Bulk Re-sync Conflict-Resolution Strategy

When a rider drops offline (entering State B), their device caches location telemetry in SQLite. On regaining connection, the device sends the backlog via `telemetry:bulkSync`.

### Conflict-Resolution Mechanism: Last-Write-Wins (LWW) by Device Timestamp

- **The Strategy:** The server processes telemetry points using the hardware-generated `device_timestamp` from the client.
- **Why it was chosen:** GPS readings represent physical truth at a specific instant. Device timestamps are the most reliable monotonically increasing references. Re-ordered packets or network delay should not alter the sequence of recorded telemetry.
- **Implementation:**
  - The database enforces a `UNIQUE(user_id, device_timestamp)` constraint on the `telemetry_readings` table.
  - When batch items are pushed, the server attempts to insert them.
  - If a conflict occurs on `(user_id, device_timestamp)`, the database executes an `ON CONFLICT (user_id, device_timestamp) DO NOTHING` or `DO UPDATE` (last-write-wins by update if data differs, though usually duplicate timestamps carry the identical coordinates, making `DO NOTHING` equivalent and highly performant).
  - The server builds a list of successfully saved reading UUIDs/client-provided IDs and responds to the client with `telemetry:bulkSyncAck`. The client can safely purge these specific records from its local SQLite cache.

---

## 7. Security Decisions

1. **Transport Layer Security (TLS):** 
   - Express server expects to sit behind a reverse proxy (e.g. Nginx, Cloudflare, or AWS ALB) terminating TLS. The proxy forwards traffic to the backend over HTTP/WS. In development/testing, HTTPS is simulated or handled via localhost.
2. **Access Control:**
   - JWT authentication middleware verifies tokens for all REST routes and Socket.io connections.
   - For any operations reading or writing telemetry, room details, or SOS events (including `GET /api/rooms/:roomId/history` and socket broadcasts), the backend performs an explicit verification: the authenticated user's ID must exist in `room_members` for the targeted `room_id`.
3. **SQL Injection & Data Validation:**
   - Prepared statements/parameterized queries are used for all PostgreSQL operations.
   - Strict validation schemas verify input format (coordinates, timestamps, identifiers) before processing.

---

## 8. Modular Software & Fault-Isolation Architecture

To ensure the system is highly modular and a failure in one area does not impact another (fault isolation), the backend has been structured using a class-based architecture where every domain and responsibility is decoupled and instantiated via Dependency Injection:

### 1. Database and Query Routing
- `DatabasePool` (Class): Manages the Postgres connection pool and errors.
- `MockDatabase` (Class): A standalone in-memory SQL mock database engine.
- `QueryRunner` (Class): Coordinates query execution, implementing automated fallback logic to the mock database if the Postgres connection fails.

### 2. Service Layer (Domain Logic)
Each domain is isolated to its own service class:
- `UserService` (Class): Handles registration, encryption, password comparison, and authentication token generation.
- `RoomService` (Class): Manages Ride Room session lifecycle (create, join, fetch members, check memberships).
- `TelemetryService` (Class): Saves live tracking points and bulk-sync catches with PostGIS and standard SQL fallbacks.
- `EmergencyAlertService` (Class): Handles crash confirmation logging and SOS alerting.
- `PresenceService` (Class): Retrieves the last known coordinate updates for disconnected clients.

### 3. Socket Handler Layer
WebSocket event scopes are isolated into distinct handler classes:
- `SessionHandler`: Socket events `session:join` and `session:leave`.
- `LocationHandler`: Socket event `location:update`.
- `BulkSyncHandler`: Socket event `telemetry:bulkSync` (State B -> State A Catch-up).
- `CrashHandler`: Socket events `crash:candidate` and `crash:countdownExpired`.
- `DisconnectHandler`: Socket event `disconnect` handling.

*Isolation Benefit:* Each socket event handler is wrapped in its own `try/catch` block. If `EmergencyAlertService` encounters a query error, it only affects the specific crash reporting client, ensuring location streaming and session management persist unimpeded for all other riders.

---

## 9. Changelog

- **2026-07-15:** Refactored entire backend to a highly modular, class-based dependency injection architecture. Separated routes into `AuthRouter`/`RoomRouter`, sockets into `RideSocketController`, and created individual socket handlers (`SessionHandler`, `LocationHandler`, `BulkSyncHandler`, `CrashHandler`, `DisconnectHandler`) and services to provide fault isolation and self-contained error boundaries.
- **2026-07-14:** Implemented full backend engine, JWT authentication middleware, REST routes, Socket.io sockets, and telemetry services. Integrated a fallback in-memory SQL mock engine into `db.ts`, 16 Jest unit/integration tests, and an end-to-end client simulation demo.
- **2026-07-14:** Initial architecture documentation drafted and finalized.
