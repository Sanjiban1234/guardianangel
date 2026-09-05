# Guardian Angel Database / ER Analysis

## 1. Database Overview

This report describes the schema created by `backend/src/db.ts` at commit `24f4b806657827120b21178bb0f4d5f590632c16`, branch `integration/all-features`. The runtime initializer defines 23 persistent PostgreSQL tables. `backend/sql/postgis_schema.sql` is a partial normalized bootstrap for a new database; it contains seven tables and explicitly does not migrate the legacy tables. `db.ts` is therefore the effective application source of truth.

There is no `presence` table. Socket connection presence and group-coherence state are process-memory state. Telemetry freshness and last known location use persisted telemetry/current-location rows.

## 2. Database Technology

- Engine: PostgreSQL; access uses `pg` (node-postgres), plus the project `DatabasePool` wrapper.
- Connection: `DATABASE_URL`, loaded via `dotenv`; TLS is configured by `getDatabaseSslConfig()`.
- PostgreSQL version: the supplied Docker database image is `postgres:16` and installs `postgresql-16-postgis-3`; the runtime initializer itself does not enforce a server version.
- Required extension: PostGIS, created outside the schema transaction.
- Attempted extensions: `pgcrypto` and `uuid-ossp`; UUID defaults use `gen_random_uuid()`.
- Initialization: `initDb()` runs `CREATE TABLE IF NOT EXISTS` and additive `ALTER TABLE` statements in a transaction. No versioned migrations directory was found.
- Schema sources: `backend/src/db.ts`; `backend/sql/postgis_schema.sql`; `backend/sql/init-postgis.sql`; `backend/fix-postgis.sql`. The latter two only enable/verify extensions.

## 3. Persistent Entities

Column notation: `PK`, `FK`, `UK`; omitted nullability means nullable unless `NOT NULL` is stated. Defaults are shown after `DEFAULT`.

### users

Accounts, authentication/profile data. `id UUID PK DEFAULT gen_random_uuid()`; `name VARCHAR(100) NOT NULL`; `email VARCHAR(255)`; `phone VARCHAR(20) NOT NULL`; `geohash VARCHAR(20)`; `password_hash VARCHAR(255) NOT NULL`; `role TEXT NOT NULL DEFAULT 'rider'` check `rider|admin`; `profile_complete BOOLEAN NOT NULL DEFAULT true`; `vehicle_model VARCHAR(100)`; `plate_number VARCHAR(50)`; `vehicle_color VARCHAR(50)`; `created_at TIMESTAMP DEFAULT NOW()`; additive `username VARCHAR(32)`. Partial unique indexes: `users_email_unique_idx` on `email` where non-null, and `users_username_normalized_unique_idx` on `lower(username)` where non-null. The legacy `users_name_key` is explicitly dropped.

### active_riders

Legacy group participation. `id UUID PK DEFAULT gen_random_uuid()`; `user_id UUID NOT NULL FK users(id) ON DELETE CASCADE`; `group_code VARCHAR(255) NOT NULL`; `include_id UUID FK users(id) ON DELETE SET NULL`; `geohash VARCHAR(20)`; `type_of_operation VARCHAR(50) DEFAULT 'ride'`; `status VARCHAR(20) NOT NULL DEFAULT 'active'`; `joined_at TIMESTAMP DEFAULT NOW()`. Unique `(user_id, group_code)`. Indexes `idx_active_riders_group_code`, `idx_active_riders_user_id`.

### notification_subdivision

Legacy notification-routing metadata. `id UUID PK DEFAULT gen_random_uuid()`; nullable `field_id`, `group_id`, `take_id`, `take_ofcl`, `type_area`, all `VARCHAR(100)`. No FK/index beyond the PK.

### emergency_alarms

SOS/emergency record. `alarm_no UUID PK DEFAULT gen_random_uuid()`; `user_id UUID NOT NULL FK users(id) ON DELETE CASCADE`; nullable `active_rider_id UUID FK active_riders(id) ON DELETE SET NULL`; nullable `notification_subdivision_id UUID FK notification_subdivision(id) ON DELETE SET NULL`; `correlation_id UUID DEFAULT gen_random_uuid()`; nullable `expire TIMESTAMP`, `join_id UUID`; `join_check_timestamp TIMESTAMP DEFAULT NOW()`; nullable `latitude DOUBLE PRECISION`, `longitude DOUBLE PRECISION`; `status VARCHAR(20) NOT NULL DEFAULT 'active'`; `created_at TIMESTAMP DEFAULT NOW()`; additive nullable `room_id UUID FK ride_rooms(id) ON DELETE SET NULL`. Index `idx_emergency_alarms_user`.

### engine_heartbeat

Legacy engine heartbeat/disconnect data. `id UUID PK DEFAULT gen_random_uuid()`; `log_id UUID DEFAULT gen_random_uuid()`; nullable `alarm_no UUID FK emergency_alarms(alarm_no) ON DELETE SET NULL`; `user_id UUID NOT NULL FK users(id) ON DELETE CASCADE`; nullable `group_code VARCHAR(255)`, `status_id VARCHAR(50) DEFAULT 'normal'`, `pulses INTEGER DEFAULT 0`, `seconds INTEGER DEFAULT 0`, `number_of_pulse INTEGER DEFAULT 0`, `latitude DOUBLE PRECISION`, `longitude DOUBLE PRECISION`, `accuracy REAL`, `speed REAL`; `device_timestamp BIGINT NOT NULL`; `created_at TIMESTAMP DEFAULT NOW()`. Unique `(user_id, device_timestamp)`. Indexes `idx_engine_heartbeat_user_ts` on `(user_id, device_timestamp DESC)` and `idx_engine_heartbeat_group`.

### ride_rooms

Persisted ride lifecycle/session. `id UUID PK DEFAULT gen_random_uuid()`; `token_hash TEXT NOT NULL UNIQUE`; nullable `group_code TEXT`; `creator_id UUID NOT NULL FK users(id) ON DELETE RESTRICT`; `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`; nullable `destination_latitude DOUBLE PRECISION`, `destination_longitude DOUBLE PRECISION`, `destination_label TEXT`, `ride_started_at TIMESTAMPTZ`, `ended_at TIMESTAMPTZ`; `status TEXT NOT NULL DEFAULT 'active'` check `active|ended`. New rooms store the original group code alongside its SHA-256 hash. The additive `ADD COLUMN IF NOT EXISTS group_code TEXT` migration leaves legacy rows NULL. Manual joins or verified-member reconnects can recover the original code, updating only NULL values. Invitation acceptance requires a stored/recovered code and fails before creating membership when it is unavailable. No NOT NULL, unique constraint, or dedicated index is defined on `group_code`; lookups continue to use the room primary key or unique `token_hash`.

### guardian_portal_shares

Expiring/revocable portal share. `id UUID PK DEFAULT gen_random_uuid()`; `room_id UUID NOT NULL FK ride_rooms(id) ON DELETE CASCADE`; `owner_user_id UUID NOT NULL FK users(id) ON DELETE CASCADE`; `token_hash TEXT NOT NULL UNIQUE`; `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`; `expires_at TIMESTAMPTZ NOT NULL`; nullable `revoked_at TIMESTAMPTZ`; `separation_state TEXT NOT NULL DEFAULT 'unknown'` check `unknown|separated|reunited`; nullable `separation_updated_at TIMESTAMPTZ`. Unique `(room_id, owner_user_id)` rotates one share per owner/room. Partial index `guardian_portal_shares_validity_idx` on `(token_hash, expires_at)` where not revoked.

### room_members

Room/user junction. `room_id UUID NOT NULL FK ride_rooms(id) ON DELETE CASCADE`; `user_id UUID NOT NULL FK users(id) ON DELETE CASCADE`; composite PK `(room_id, user_id)`; `role TEXT NOT NULL DEFAULT 'member'` check `owner|member|guardian`; `joined_at TIMESTAMPTZ NOT NULL DEFAULT now()`; `ride_state TEXT NOT NULL DEFAULT 'active'` check `active|paused`. Index `room_members_user_room_idx` on `(user_id, room_id)`.

### telemetry_readings

Accepted GPS history. `id UUID PK DEFAULT gen_random_uuid()`; `room_id UUID NOT NULL FK ride_rooms(id) ON DELETE CASCADE`; `user_id UUID NOT NULL FK users(id) ON DELETE CASCADE`; `device_timestamp_ms BIGINT NOT NULL` check `>= 1600000000000`; `location GEOGRAPHY(POINT,4326) NOT NULL`; `accuracy REAL NOT NULL` check `>= 0`; `speed REAL` nullable in the effective runtime schema because `db.ts` drops the original `NOT NULL`, with non-negative check retained; `synced BOOLEAN NOT NULL DEFAULT true`; `client_reading_id UUID NOT NULL`; `received_at TIMESTAMPTZ NOT NULL DEFAULT now()`. Unique `(user_id, client_reading_id)` and `(room_id, user_id, device_timestamp_ms)`. GiST index `telemetry_readings_location_gix`; B-tree `telemetry_readings_room_user_time_idx` on `(room_id, user_id, device_timestamp_ms)`. Bulk re-sync inserts are idempotent on the client-reading key; a live replay of the same room/user/timestamp updates its position, accuracy, and speed.

### rider_current_locations

Trigger-maintained latest location, one row per room/user. `room_id UUID NOT NULL FK ride_rooms(id) ON DELETE CASCADE`; `user_id UUID NOT NULL FK users(id) ON DELETE CASCADE`; `device_timestamp_ms BIGINT NOT NULL`; `location GEOGRAPHY(POINT,4326) NOT NULL`; `accuracy REAL NOT NULL`; `speed REAL NOT NULL`; composite PK `(room_id, user_id)`; GiST index `rider_current_locations_location_gix`. The `AFTER INSERT` telemetry trigger updates only with a newer/equal timestamp.

### geofences

Safety boundaries. `id UUID PK DEFAULT gen_random_uuid()`; `name TEXT NOT NULL`; `area GEOGRAPHY(POLYGON,4326) NOT NULL`; `type TEXT NOT NULL` check `hazard|dead_zone`; `is_active BOOLEAN NOT NULL DEFAULT true`; `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`. GiST `geofences_area_gix`; partial index `geofences_active_type_idx` on `type` where active.

### crash_candidates

Crash detection evidence/outcome. `id UUID PK DEFAULT gen_random_uuid()`; nullable `room_id UUID FK ride_rooms(id) ON DELETE SET NULL`; `user_id UUID NOT NULL FK users(id) ON DELETE CASCADE`; `device_timestamp_ms BIGINT NOT NULL`; `location GEOGRAPHY(POINT,4326) NOT NULL`; nullable `speed REAL`, `speed_reading_timestamp_ms BIGINT`; nullable `outcome TEXT` check `confirmed|false_alarm`; `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`. Index `crash_candidates_room_user_idx` on `(room_id, user_id, device_timestamp_ms DESC)`.

### vehicle_breakdowns

Breakdown reports/resolution. `id UUID PK DEFAULT gen_random_uuid()`; nullable `room_id UUID FK ride_rooms(id) ON DELETE SET NULL`; `user_id UUID NOT NULL FK users(id) ON DELETE CASCADE`; nullable `reason TEXT` check `flat_tire|mechanical_failure|fuel|other`; nullable `note TEXT`; `location GEOGRAPHY(POINT,4326) NOT NULL`; `reported_at TIMESTAMPTZ NOT NULL DEFAULT now()`; nullable `resolved_at TIMESTAMPTZ`. Index `vehicle_breakdowns_room_user_idx` on `(room_id, user_id, reported_at DESC)`.

### refill_notifications

Refuel requests. `id UUID PK DEFAULT gen_random_uuid()`; `room_id UUID NOT NULL FK ride_rooms(id) ON DELETE CASCADE`; `rider_id UUID NOT NULL FK users(id) ON DELETE CASCADE`; nullable `note TEXT`; `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`. Index `refill_notifications_room_created_idx` on `(room_id, created_at DESC)`.

### device_tokens

Push device credentials. `user_id UUID NOT NULL FK users(id) ON DELETE CASCADE`; `token TEXT NOT NULL`; `platform TEXT NOT NULL` check `ios|android`; `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`; composite PK `(user_id, platform)`. Index `device_tokens_token_idx`.

### auth_sessions

JWT revocation state. `id UUID PK DEFAULT gen_random_uuid()`; `jti UUID NOT NULL UNIQUE`; `user_id UUID NOT NULL FK users(id) ON DELETE CASCADE`; `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`; `expires_at TIMESTAMPTZ NOT NULL`; nullable `revoked_at TIMESTAMPTZ`. Partial index `auth_sessions_active_idx` on `(jti, user_id)` where not revoked.

### biometric_credentials

Biometric public-key credentials. `id UUID PK` application-provided; `user_id UUID NOT NULL FK users(id) ON DELETE CASCADE`; `public_key TEXT NOT NULL`; nullable `challenge_hash TEXT`, `challenge_expires_at TIMESTAMPTZ`, `last_used_at TIMESTAMPTZ`, `revoked_at TIMESTAMPTZ`; `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`; `expires_at TIMESTAMPTZ NOT NULL`. Partial unique index `biometric_credentials_one_active_per_user_idx` on user where `revoked_at IS NULL`; partial challenge expiry index for unrevoked rows with a challenge hash.

### emergency_disclosure_audit

Emergency disclosure audit log. `id UUID PK DEFAULT gen_random_uuid()`; `subject_user_id UUID NOT NULL FK users(id) ON DELETE CASCADE`; nullable `room_id UUID FK ride_rooms(id) ON DELETE SET NULL`; `incident_type TEXT NOT NULL`; nullable `incident_id UUID`; `categories_disclosed JSONB NOT NULL`; `recipient_scope TEXT NOT NULL`; `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`. No additional index.

### medical_info

One-to-one medical/emergency contact profile. `user_id UUID PK/FK users(id) ON DELETE CASCADE`; nullable `blood_group VARCHAR(10)` check `A+|A-|B+|B-|AB+|AB-|O+|O-`; nullable `allergies TEXT`, `emergency_contact_name VARCHAR(100)`, `emergency_contact_phone VARCHAR(20)`, `notes TEXT`; `share_medical_during_emergency BOOLEAN NOT NULL DEFAULT false`; `share_emergency_contact_during_emergency BOOLEAN NOT NULL DEFAULT false`; `updated_at TIMESTAMP NOT NULL DEFAULT now()`.

### friend_requests

Directed requests. `id UUID PK DEFAULT gen_random_uuid()`; `sender_user_id UUID NOT NULL FK users(id) ON DELETE CASCADE`; `receiver_user_id UUID NOT NULL FK users(id) ON DELETE CASCADE`; `status TEXT NOT NULL DEFAULT 'pending'` check `pending|accepted|declined|cancelled`; `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`; nullable `responded_at TIMESTAMPTZ`; check sender differs from receiver. Partial unique canonical pair index while pending; sender/receiver status/time indexes.

### friendships

Accepted undirected friendship. `id UUID PK DEFAULT gen_random_uuid()`; `user_a_id UUID NOT NULL FK users(id) ON DELETE CASCADE`; `user_b_id UUID NOT NULL FK users(id) ON DELETE CASCADE`; `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`; check `user_a_id < user_b_id`; unique `(user_a_id,user_b_id)`. Endpoint indexes on both columns.

### user_blocks

Directed block. `blocker_user_id UUID NOT NULL FK users(id) ON DELETE CASCADE`; `blocked_user_id UUID NOT NULL FK users(id) ON DELETE CASCADE`; `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`; composite PK `(blocker_user_id, blocked_user_id)`; check endpoints differ; index `user_blocks_blocked_idx`.

### ride_invitations

Directed room invitation. `id UUID PK DEFAULT gen_random_uuid()`; `room_id UUID NOT NULL FK ride_rooms(id) ON DELETE CASCADE`; `inviter_user_id UUID NOT NULL FK users(id) ON DELETE CASCADE`; `invitee_user_id UUID NOT NULL FK users(id) ON DELETE CASCADE`; `status TEXT NOT NULL DEFAULT 'pending'` check `pending|accepted|declined|expired|cancelled`; `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`; `expires_at TIMESTAMPTZ NOT NULL`; nullable `responded_at TIMESTAMPTZ`; check inviter differs from invitee. Partial unique `(room_id, invitee_user_id)` while pending; index `ride_invitations_invitee_status_idx`.

### Runtime usage and retention

`db.ts` creates every table above. Runtime references were traced in `backend/src` as follows: `UserService` and the profile/medical/friend routes use `users`; `MedicalInfoService` reads, upserts, and explicitly deletes `medical_info`; `RoomService` creates/joins/leaves/pauses/ends `ride_rooms` and `room_members`, and reads `telemetry_readings` for room history; `TelemetryService` writes `telemetry_readings`; its trigger maintains `rider_current_locations`. `PresenceService`, `GuardianPortalShareService`, `VehicleBreakdownService`, `WeatherService`, and the PostGIS repositories read current-location rows; `GuardianPortalShareService` writes/revokes/reads `guardian_portal_shares`; `EmergencyAlertService` writes `emergency_alarms`; and `CrashCandidateRepository`/`SafetyRouter` use `crash_candidates`.

`VehicleBreakdownService` writes and marks `vehicle_breakdowns` resolved; `RefillNotificationService` writes `refill_notifications`; `FcmPushService` upserts/reads `device_tokens`; `AuthSessionService` uses `auth_sessions`; `BiometricCredentialService` uses `biometric_credentials`; `EmergencyDisclosureAuditService` inserts `emergency_disclosure_audit`; `FriendService` uses `friend_requests`, `friendships`, and `user_blocks`; and `RideInvitationService` uses `ride_invitations` (also consulting friendship/block state). `GeofenceRouter` and `PostgisTelemetryRepository` use `geofences`. `active_riders`, `notification_subdivision`, and `engine_heartbeat` have no runtime references outside schema initialization in the current TypeScript backend, so they are legacy persisted tables. The schema declares no general retention/purge job. Explicit lifecycle changes include medical-profile deletion, a non-owner leaving a room (membership deletion), friendship/block deletion, and status/revocation/resolution timestamps; FK cascades apply if a parent is deleted.

## 4. Complete Schema Table

| Entity | Purpose | Primary Key | Important Foreign Keys | Relationship Summary | Include in Main ER Diagram? |
|---|---|---|---|---|---|
| users | Accounts | id | none | Parent entity | YES |
| medical_info | Medical profile | user_id | users | 1:0..1 | YES |
| ride_rooms | Ride lifecycle | id | creator -> users | 1:N children | YES |
| room_members | Room junction | room_id,user_id | room,user | Users N:M rooms | YES |
| telemetry_readings | GPS history | id | room,user | 1:N | YES |
| rider_current_locations | Latest GPS projection | room_id,user_id | room,user | 1:1 per room/user | YES |
| guardian_portal_shares | Portal credentials | id | room,user | 1:N; one owner share/room | YES |
| emergency_alarms | SOS | alarm_no | user, room, legacy refs | 1:N user | YES |
| crash_candidates | Crash evidence | id | user, nullable room | 1:N | YES |
| vehicle_breakdowns | Breakdowns | id | user, nullable room | 1:N | YES |
| friendships | Accepted social links | id | users twice | N:M users | YES |
| friend_requests | Directed requests | id | users twice | 1:N endpoints | YES |
| ride_invitations | Directed room invites | id | room, users twice | 1:N endpoints | YES |
| auth_sessions | JWT state | id | user | 1:N | OPTIONAL |
| biometric_credentials | Biometric state | id | user | 1:N, one active | OPTIONAL |
| device_tokens | Push devices | user_id,platform | user | 1:N | OPTIONAL |
| refill_notifications | Refuel requests | id | room,user | 1:N | OPTIONAL |
| emergency_disclosure_audit | Disclosure audit | id | user, nullable room | 1:N | OPTIONAL |
| geofences | Safety boundaries | id | none | Independent | OPTIONAL |
| user_blocks | Directed blocks | blocker,blocked | users twice | directed N:M | OPTIONAL |
| active_riders | Legacy groups | id | users twice | Legacy 1:N | OPTIONAL |
| engine_heartbeat | Legacy heartbeat | id | user, alarm | Legacy 1:N | OPTIONAL |
| notification_subdivision | Legacy routing | id | none | Optional alarm reference | NO |

## 5. Primary Keys

Generated UUID PKs use `gen_random_uuid()` for all UUID-id tables except `biometric_credentials.id`, which is application-provided. `emergency_alarms` uses `alarm_no` rather than `id`. Composite PKs are `room_members(room_id,user_id)`, `rider_current_locations(room_id,user_id)`, `device_tokens(user_id,platform)`, and `user_blocks(blocker_user_id,blocked_user_id)`. `medical_info.user_id` is both PK and FK.

## 6. Foreign Keys

There are 38 FK columns/relationships:

```text
active_riders.user_id -> users.id CASCADE
active_riders.include_id -> users.id SET NULL
emergency_alarms.user_id -> users.id CASCADE
emergency_alarms.active_rider_id -> active_riders.id SET NULL
emergency_alarms.notification_subdivision_id -> notification_subdivision.id SET NULL
emergency_alarms.room_id -> ride_rooms.id SET NULL
engine_heartbeat.alarm_no -> emergency_alarms.alarm_no SET NULL
engine_heartbeat.user_id -> users.id CASCADE
ride_rooms.creator_id -> users.id RESTRICT
guardian_portal_shares.room_id -> ride_rooms.id CASCADE
guardian_portal_shares.owner_user_id -> users.id CASCADE
room_members.room_id -> ride_rooms.id CASCADE
room_members.user_id -> users.id CASCADE
telemetry_readings.room_id -> ride_rooms.id CASCADE
telemetry_readings.user_id -> users.id CASCADE
rider_current_locations.room_id -> ride_rooms.id CASCADE
rider_current_locations.user_id -> users.id CASCADE
crash_candidates.room_id -> ride_rooms.id SET NULL
crash_candidates.user_id -> users.id CASCADE
vehicle_breakdowns.room_id -> ride_rooms.id SET NULL
vehicle_breakdowns.user_id -> users.id CASCADE
refill_notifications.room_id -> ride_rooms.id CASCADE
refill_notifications.rider_id -> users.id CASCADE
device_tokens.user_id -> users.id CASCADE
auth_sessions.user_id -> users.id CASCADE
biometric_credentials.user_id -> users.id CASCADE
emergency_disclosure_audit.subject_user_id -> users.id CASCADE
emergency_disclosure_audit.room_id -> ride_rooms.id SET NULL
medical_info.user_id -> users.id CASCADE
friend_requests.sender_user_id -> users.id CASCADE
friend_requests.receiver_user_id -> users.id CASCADE
friendships.user_a_id -> users.id CASCADE
friendships.user_b_id -> users.id CASCADE
user_blocks.blocker_user_id -> users.id CASCADE
user_blocks.blocked_user_id -> users.id CASCADE
ride_invitations.room_id -> ride_rooms.id CASCADE
ride_invitations.inviter_user_id -> users.id CASCADE
ride_invitations.invitee_user_id -> users.id CASCADE
```

No `ON UPDATE` action is declared, so PostgreSQL default behavior applies. Constraint names are not explicitly supplied; PostgreSQL generates them.

## 7. Relationships and Cardinalities

- `USERS 1 ----- 0..1 MEDICAL_INFO` via `medical_info.user_id`.
- `USERS 1 ----- N RIDE_ROOMS` via `ride_rooms.creator_id`.
- `USERS N ----- M RIDE_ROOMS` via `room_members`; its composite PK prevents duplicate membership.
- `RIDE_ROOMS 1 ----- N ROOM_MEMBERS, TELEMETRY_READINGS, RIDER_CURRENT_LOCATIONS, GUARDIAN_PORTAL_SHARES, CRASH_CANDIDATES, VEHICLE_BREAKDOWNS, REFILL_NOTIFICATIONS, EMERGENCY_ALARMS, EMERGENCY_DISCLOSURE_AUDIT, RIDE_INVITATIONS`.
- `USERS 1 ----- N AUTH_SESSIONS, BIOMETRIC_CREDENTIALS, DEVICE_TOKENS, TELEMETRY_READINGS, RIDER_CURRENT_LOCATIONS, CRASH_CANDIDATES, VEHICLE_BREAKDOWNS, REFILL_NOTIFICATIONS, EMERGENCY_ALARMS, EMERGENCY_DISCLOSURE_AUDIT, ACTIVE_RIDERS, ENGINE_HEARTBEAT, GUARDIAN_PORTAL_SHARES`.
- `USERS N ----- M USERS` via canonical `friendships`, directed `user_blocks`, and directed `friend_requests`.
- `EMERGENCY_ALARMS 1 ----- N ENGINE_HEARTBEAT` is optional at the child side.

## 8. Spatial/PostGIS Fields

| Table | Column | Exact type | Index/use |
|---|---|---|---|
| telemetry_readings | location | `GEOGRAPHY(POINT,4326)` | GiST; distance/radius and track calculations |
| rider_current_locations | location | `GEOGRAPHY(POINT,4326)` | GiST; current-rider proximity |
| geofences | area | `GEOGRAPHY(POLYGON,4326)` | GiST; point coverage |
| crash_candidates | location | `GEOGRAPHY(POINT,4326)` | No spatial index defined |
| vehicle_breakdowns | location | `GEOGRAPHY(POINT,4326)` | No spatial index defined |

SRID 4326 is WGS84. Queries construct points as longitude, latitude. `ST_DWithin`, `ST_Distance`, `ST_Length`, and geofence coverage are used. Telemetry distance/duration summaries are derived from `telemetry_readings`; current location is a trigger-maintained projection.

## 9. Authentication Model

`users.password_hash` stores password-derived credential material. `auth_sessions` persists JTI revocation, expiry, and timestamps. JWT claims themselves are not tables. `biometric_credentials` persists public keys and optional challenge hash/expiry; transient request state may exist in the biometric flow. Portal observer JWTs are temporary claims validated against hashed `guardian_portal_shares` credentials. No raw token, secret, URL, key, or real user data is included here.

## 10. Ride and Telemetry Model

Rooms, membership, host/creator, lifecycle, start/end, destination, and hashed group credential are persisted. `activeRoute`, Socket.IO room assignment, socket IDs, handler `RoomState`, and ride summary objects are not relational entities. No ride-summary/history table exists. Telemetry is append-only history; `rider_current_locations` stores one latest row per room/rider.

## 11. Social Model

Requests are directional. Accepted friendships use canonical ordering (`user_a_id < user_b_id`) and a unique pair. Blocks are directional. Invitations are directional and room-scoped; one pending invitation per room/invitee is allowed.

## 12. Guardian Portal Model

Share creation persists owner, room, hash, expiry, revocation, and separation state. Share rows are rotated by the `(room_id, owner_user_id)` uniqueness rule. Observer JWTs, Socket.IO observer connections, emitted events, and browser event lists are transient. Separation/reunion state is persisted in the share row when updated by the portal service.

## 13. Persistent vs Transient State

| Feature | Classification |
|---|---|
| users/password/session revocation | Persistent: `users`, `auth_sessions` |
| biometric public credential | Persistent: `biometric_credentials` |
| rooms/membership/lifecycle | Persistent: `ride_rooms`, `room_members` |
| accepted telemetry/history | Persistent: `telemetry_readings` |
| latest location | Persistent projection: `rider_current_locations` |
| connection presence | Transient: `PresenceService.socketsByGroup`; no table |
| telemetry freshness | Derived from persisted `received_at`/device timestamp |
| SOS/crash candidate | Persistent: `emergency_alarms`, `crash_candidates` |
| breakdown/refuel | Persistent: `vehicle_breakdowns`, `refill_notifications` |
| separation/reunion | Mixed: portal state persisted; coherence state/events transient |
| disconnect/reconnect | Transient event/state; last location queried from DB |
| weather | Transient TTL maps in `WeatherService`; no table |
| AI route/recommendation | Derived/transient; no table |
| TTS announcements, active route, live Socket.IO rooms | Transient; no tables |

## 14. Recommended Main ER Diagram

Recommended main report scope: `USERS`, `MEDICAL_INFO`, `RIDE_ROOMS`, `ROOM_MEMBERS`, `TELEMETRY_READINGS`, `RIDER_CURRENT_LOCATIONS`, `GUARDIAN_PORTAL_SHARES`, `EMERGENCY_ALARMS`, `CRASH_CANDIDATES`, `VEHICLE_BREAKDOWNS`, `FRIEND_REQUESTS`, `FRIENDSHIPS`, and `RIDE_INVITATIONS`. Add `GEOFENCES` if spatial safety is central. Put auth/support/audit and legacy tables in the technical appendix.

## 15. Mermaid ER Diagram — Report Version

```mermaid
erDiagram
    USERS ||--o| MEDICAL_INFO : has
    USERS ||--o{ RIDE_ROOMS : creates
    USERS ||--o{ ROOM_MEMBERS : joins
    RIDE_ROOMS ||--o{ ROOM_MEMBERS : contains
    USERS ||--o{ TELEMETRY_READINGS : records
    RIDE_ROOMS ||--o{ TELEMETRY_READINGS : contains
    USERS ||--o{ RIDER_CURRENT_LOCATIONS : owns
    RIDE_ROOMS ||--o{ RIDER_CURRENT_LOCATIONS : projects
    USERS ||--o{ GUARDIAN_PORTAL_SHARES : owns
    RIDE_ROOMS ||--o{ GUARDIAN_PORTAL_SHARES : exposes
    USERS ||--o{ EMERGENCY_ALARMS : raises
    RIDE_ROOMS ||--o{ EMERGENCY_ALARMS : contextualizes
    USERS ||--o{ CRASH_CANDIDATES : produces
    RIDE_ROOMS ||--o{ CRASH_CANDIDATES : contains
    USERS ||--o{ VEHICLE_BREAKDOWNS : reports
    RIDE_ROOMS ||--o{ VEHICLE_BREAKDOWNS : contains
    USERS ||--o{ FRIEND_REQUESTS : participates
    USERS ||--o{ FRIENDSHIPS : connects
    USERS ||--o{ RIDE_INVITATIONS : participates
    RIDE_ROOMS ||--o{ RIDE_INVITATIONS : contains
    USERS { uuid id PK; varchar name; varchar username UK; varchar email UK; varchar phone; text role }
    MEDICAL_INFO { uuid user_id PK,FK; varchar blood_group; text allergies; boolean share_medical_during_emergency }
    RIDE_ROOMS { uuid id PK; text token_hash UK; text group_code; uuid creator_id FK; text status; timestamptz ride_started_at }
    ROOM_MEMBERS { uuid room_id PK,FK; uuid user_id PK,FK; text role; text ride_state }
    TELEMETRY_READINGS { uuid id PK; uuid room_id FK; uuid user_id FK; geography location; bigint device_timestamp_ms; real speed }
    RIDER_CURRENT_LOCATIONS { uuid room_id PK,FK; uuid user_id PK,FK; geography location; bigint device_timestamp_ms }
    GUARDIAN_PORTAL_SHARES { uuid id PK; uuid room_id FK; uuid owner_user_id FK; text token_hash UK; timestamptz expires_at; text separation_state }
    EMERGENCY_ALARMS { uuid alarm_no PK; uuid user_id FK; uuid room_id FK; text status }
    CRASH_CANDIDATES { uuid id PK; uuid room_id FK; uuid user_id FK; text outcome }
    VEHICLE_BREAKDOWNS { uuid id PK; uuid room_id FK; uuid user_id FK; text reason; timestamptz resolved_at }
    FRIEND_REQUESTS { uuid id PK; uuid sender_user_id FK; uuid receiver_user_id FK; text status }
    FRIENDSHIPS { uuid id PK; uuid user_a_id FK; uuid user_b_id FK }
    RIDE_INVITATIONS { uuid id PK; uuid room_id FK; uuid inviter_user_id FK; uuid invitee_user_id FK; text status }
```

## 16. Mermaid ER Diagram — Full Technical Version

```mermaid
erDiagram
    USERS ||--o{ ACTIVE_RIDERS : has
    USERS ||--o{ EMERGENCY_ALARMS : raises
    ACTIVE_RIDERS |o--o{ EMERGENCY_ALARMS : references
    NOTIFICATION_SUBDIVISION |o--o{ EMERGENCY_ALARMS : routes
    EMERGENCY_ALARMS |o--o{ ENGINE_HEARTBEAT : links
    USERS ||--o{ ENGINE_HEARTBEAT : emits
    USERS ||--o{ RIDE_ROOMS : creates
    USERS ||--o{ ROOM_MEMBERS : joins
    RIDE_ROOMS ||--o{ ROOM_MEMBERS : contains
    USERS ||--o{ GUARDIAN_PORTAL_SHARES : owns
    RIDE_ROOMS ||--o{ GUARDIAN_PORTAL_SHARES : shares
    USERS ||--o{ TELEMETRY_READINGS : records
    RIDE_ROOMS ||--o{ TELEMETRY_READINGS : contains
    USERS ||--o{ RIDER_CURRENT_LOCATIONS : owns
    RIDE_ROOMS ||--o{ RIDER_CURRENT_LOCATIONS : projects
    USERS ||--o{ CRASH_CANDIDATES : produces
    RIDE_ROOMS |o--o{ CRASH_CANDIDATES : contextualizes
    USERS ||--o{ VEHICLE_BREAKDOWNS : reports
    RIDE_ROOMS |o--o{ VEHICLE_BREAKDOWNS : contextualizes
    USERS ||--o{ REFILL_NOTIFICATIONS : requests
    RIDE_ROOMS ||--o{ REFILL_NOTIFICATIONS : contains
    USERS ||--o{ DEVICE_TOKENS : registers
    USERS ||--o{ AUTH_SESSIONS : owns
    USERS ||--o{ BIOMETRIC_CREDENTIALS : owns
    USERS ||--o{ EMERGENCY_DISCLOSURE_AUDIT : subject
    RIDE_ROOMS |o--o{ EMERGENCY_DISCLOSURE_AUDIT : records
    USERS ||--o| MEDICAL_INFO : has
    USERS ||--o{ FRIEND_REQUESTS : participates
    USERS ||--o{ FRIENDSHIPS : connects
    USERS ||--o{ USER_BLOCKS : blocks
    USERS ||--o{ RIDE_INVITATIONS : participates
    RIDE_ROOMS ||--o{ RIDE_INVITATIONS : contains
    USERS { uuid id PK; varchar name; varchar email UK; varchar username UK; varchar phone; varchar geohash; varchar password_hash; text role; boolean profile_complete; varchar vehicle_model; varchar plate_number; varchar vehicle_color; timestamp created_at }
    ACTIVE_RIDERS { uuid id PK; uuid user_id FK; varchar group_code; uuid include_id FK; varchar geohash; varchar type_of_operation; varchar status; timestamp joined_at }
    NOTIFICATION_SUBDIVISION { uuid id PK; varchar field_id; varchar group_id; varchar take_id; varchar take_ofcl; varchar type_area }
    EMERGENCY_ALARMS { uuid alarm_no PK; uuid user_id FK; uuid active_rider_id FK; uuid notification_subdivision_id FK; uuid room_id FK; uuid correlation_id; timestamp expire; uuid join_id; timestamp join_check_timestamp; float latitude; float longitude; varchar status; timestamp created_at }
    ENGINE_HEARTBEAT { uuid id PK; uuid log_id; uuid alarm_no FK; uuid user_id FK; varchar group_code; varchar status_id; int pulses; int seconds; int number_of_pulse; float latitude; float longitude; real accuracy; real speed; bigint device_timestamp; timestamp created_at }
    RIDE_ROOMS { uuid id PK; text token_hash UK; text group_code; uuid creator_id FK; timestamptz created_at; float destination_latitude; float destination_longitude; text destination_label; timestamptz ride_started_at; text status; timestamptz ended_at }
    GUARDIAN_PORTAL_SHARES { uuid id PK; uuid room_id FK; uuid owner_user_id FK; text token_hash UK; timestamptz created_at; timestamptz expires_at; timestamptz revoked_at; text separation_state; timestamptz separation_updated_at }
    ROOM_MEMBERS { uuid room_id PK,FK; uuid user_id PK,FK; text role; timestamptz joined_at; text ride_state }
    TELEMETRY_READINGS { uuid id PK; uuid room_id FK; uuid user_id FK; bigint device_timestamp_ms; geography location; real accuracy; real speed; boolean synced; uuid client_reading_id; timestamptz received_at }
    RIDER_CURRENT_LOCATIONS { uuid room_id PK,FK; uuid user_id PK,FK; bigint device_timestamp_ms; geography location; real accuracy; real speed }
    GEOFENCES { uuid id PK; text name; geography area; text type; boolean is_active; timestamptz created_at }
    CRASH_CANDIDATES { uuid id PK; uuid room_id FK; uuid user_id FK; bigint device_timestamp_ms; geography location; real speed; bigint speed_reading_timestamp_ms; text outcome; timestamptz created_at }
    VEHICLE_BREAKDOWNS { uuid id PK; uuid room_id FK; uuid user_id FK; text reason; text note; geography location; timestamptz reported_at; timestamptz resolved_at }
    REFILL_NOTIFICATIONS { uuid id PK; uuid room_id FK; uuid rider_id FK; text note; timestamptz created_at }
    DEVICE_TOKENS { uuid user_id PK,FK; text token; text platform PK; timestamptz updated_at }
    AUTH_SESSIONS { uuid id PK; uuid jti UK; uuid user_id FK; timestamptz created_at; timestamptz expires_at; timestamptz revoked_at }
    BIOMETRIC_CREDENTIALS { uuid id PK; uuid user_id FK; text public_key; text challenge_hash; timestamptz challenge_expires_at; timestamptz created_at; timestamptz last_used_at; timestamptz expires_at; timestamptz revoked_at }
    EMERGENCY_DISCLOSURE_AUDIT { uuid id PK; uuid subject_user_id FK; uuid room_id FK; text incident_type; uuid incident_id; jsonb categories_disclosed; text recipient_scope; timestamptz created_at }
    MEDICAL_INFO { uuid user_id PK,FK; varchar blood_group; text allergies; varchar emergency_contact_name; varchar emergency_contact_phone; text notes; boolean share_medical_during_emergency; boolean share_emergency_contact_during_emergency; timestamp updated_at }
    FRIEND_REQUESTS { uuid id PK; uuid sender_user_id FK; uuid receiver_user_id FK; text status; timestamp created_at; timestamp responded_at }
    FRIENDSHIPS { uuid id PK; uuid user_a_id FK; uuid user_b_id FK; timestamp created_at }
    USER_BLOCKS { uuid blocker_user_id PK,FK; uuid blocked_user_id PK,FK; timestamp created_at }
    RIDE_INVITATIONS { uuid id PK; uuid room_id FK; uuid inviter_user_id FK; uuid invitee_user_id FK; text status; timestamp created_at; timestamp expires_at; timestamp responded_at }
```

## 17. DBML / Diagram Tool Input

```dbml
Table users { id uuid [pk]; name varchar; username varchar; email varchar; phone varchar; password_hash varchar; role text; created_at timestamp }
Table medical_info { user_id uuid [pk, ref: > users.id]; blood_group varchar; allergies text; emergency_contact_name varchar; emergency_contact_phone varchar; notes text }
Table ride_rooms { id uuid [pk]; token_hash text [unique]; group_code text [null]; creator_id uuid [ref: > users.id]; status text; ride_started_at timestamptz; ended_at timestamptz }
Table room_members { room_id uuid [pk, ref: > ride_rooms.id]; user_id uuid [pk, ref: > users.id]; role text; ride_state text; joined_at timestamptz }
Table telemetry_readings { id uuid [pk]; room_id uuid [ref: > ride_rooms.id]; user_id uuid [ref: > users.id]; device_timestamp_ms bigint; location geography; accuracy real; speed real; client_reading_id uuid; received_at timestamptz }
Table rider_current_locations { room_id uuid [pk, ref: > ride_rooms.id]; user_id uuid [pk, ref: > users.id]; device_timestamp_ms bigint; location geography; accuracy real; speed real }
Table guardian_portal_shares { id uuid [pk]; room_id uuid [ref: > ride_rooms.id]; owner_user_id uuid [ref: > users.id]; token_hash text [unique]; expires_at timestamptz; revoked_at timestamptz; separation_state text }
Table emergency_alarms { alarm_no uuid [pk]; user_id uuid [ref: > users.id]; room_id uuid [ref: > ride_rooms.id]; active_rider_id uuid; status varchar; created_at timestamp }
Table crash_candidates { id uuid [pk]; room_id uuid [ref: > ride_rooms.id]; user_id uuid [ref: > users.id]; location geography; outcome text; created_at timestamptz }
Table vehicle_breakdowns { id uuid [pk]; room_id uuid [ref: > ride_rooms.id]; user_id uuid [ref: > users.id]; reason text; location geography; reported_at timestamptz; resolved_at timestamptz }
Table friendships { id uuid [pk]; user_a_id uuid [ref: > users.id]; user_b_id uuid [ref: > users.id]; created_at timestamptz }
Table friend_requests { id uuid [pk]; sender_user_id uuid [ref: > users.id]; receiver_user_id uuid [ref: > users.id]; status text; created_at timestamp }
Table ride_invitations { id uuid [pk]; room_id uuid [ref: > ride_rooms.id]; inviter_user_id uuid [ref: > users.id]; invitee_user_id uuid [ref: > users.id]; status text; expires_at timestamp }
Table auth_sessions { id uuid [pk]; jti uuid [unique]; user_id uuid [ref: > users.id]; expires_at timestamptz; revoked_at timestamptz }
Table refill_notifications { id uuid [pk]; room_id uuid [ref: > ride_rooms.id]; rider_id uuid [ref: > users.id]; created_at timestamptz }
Table geofences { id uuid [pk]; name text; area geography; type text; is_active boolean }
Table active_riders { id uuid [pk]; user_id uuid [ref: > users.id]; include_id uuid [ref: > users.id]; group_code varchar; status varchar }
Table engine_heartbeat { id uuid [pk]; alarm_no uuid [ref: > emergency_alarms.alarm_no]; user_id uuid [ref: > users.id]; device_timestamp bigint }
Table notification_subdivision { id uuid [pk] }
Table device_tokens { user_id uuid [pk, ref: > users.id]; platform text [pk]; token text }
Table biometric_credentials { id uuid [pk]; user_id uuid [ref: > users.id]; public_key text; expires_at timestamptz; revoked_at timestamptz }
Table emergency_disclosure_audit { id uuid [pk]; subject_user_id uuid [ref: > users.id]; room_id uuid [ref: > ride_rooms.id]; incident_type text; created_at timestamptz }
Table user_blocks { blocker_user_id uuid [pk, ref: > users.id]; blocked_user_id uuid [pk, ref: > users.id]; created_at timestamptz }
```

## 18. Known Schema Limitations / Ambiguities

1. `db.ts` is idempotent but not versioned. `CREATE TABLE IF NOT EXISTS` does not retrofit every prior definition; this report follows its explicit additive alters.
2. `backend/sql/postgis_schema.sql` omits users, legacy, auth, social, emergency, and portal tables and assumes prerequisite `users`; it is not the full runtime schema.
3. Older docs describe `users.name UNIQUE` and room role `rider`; current runtime drops the name constraint and enforces `owner|member|guardian`.
4. Runtime drops telemetry `speed NOT NULL`; the standalone SQL still shows speed required. Effective runtime speed is nullable.
5. Email and username unique indexes are partial, so multiple NULLs are allowed; username comparison is case-insensitive.
6. The bundled Docker image pins PostgreSQL 16 with the distribution's PostGIS 3 package; the runtime schema does not enforce a server or extension version for non-Docker deployments.
7. No retention policy is defined for most history/audit tables. No weather, route, recommendation, ride-summary, or presence table was found.

## Final Validation

Compared against `backend/src/db.ts` and `backend/sql/postgis_schema.sql`. This documentation reflects the ride-invitation activation migration at the source commit identified above; no manual database backfill is required.
