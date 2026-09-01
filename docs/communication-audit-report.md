# Guardian Angel — End-to-End Communication Audit Report

**Date:** 2026-08-16
**Scope:** Read-only audit. No files were modified; no speculative fixes applied.
**Environment audited:** `integration/full-merge` @ `38d16da` ("Error correction"), clean working tree.
**Live backend:** `https://joyful-growth-production.up.railway.app` — `/api/health` returns 200; `/api/safety/config` and `/api/rooms` return 401 without a JWT (confirms the deployed build matches the repo's auth gate).

---

## 1. Executive Summary

The system **compiles and passes its test suites, and a healthy backend is deployed** — but **the core ride feature does not actually stream location**. A single root cause (the backend never acknowledging `session:join`) blocks the mobile telemetry pipeline during an active ride: `TelemetryModule.start()` awaits `joinSession()` forever and therefore never starts the GPS provider. Every rider appears on the map only via `location:broadcast` from *other* riders — so a single-rider or all-rider room shows an empty map.

Beyond that, the Google Maps API key is a build-time placeholder (native map tiles, Places search, and reverse geocoding all fail at runtime), remote crash-detection tuning is dead (`/api/safety/config` requires a JWT the app never sends), and several safety broadcasts are either never emitted (`vehicle:breakdown`) or never listened to (`sos:broadcast`). None of this is caught by the Jest suites because the tests mock the DB/socket layers.

Verdict: **🔴 NOT field-ready.** Core tracking and SOS visibility to other riders are broken; crash-threshold tuning and Maps are inert; several features are wired on one side only.

---

## 2. Communication Map

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │                        React Native App (Android)                     │
 │  mobile/App.tsx · TelemetryModule · SocketClient · screens            │
 │                                                                        │
 │  REST (fetch, Bearer JWT)          Socket.IO (auth:{token}, websocket)│
 │  ┌──────────────────────────┐      ┌───────────────────────────────┐  │
 │  │ POST /api/auth/register  │      │ session:join  (client→server) │  │
 │  │ POST /api/auth/login     │      │ location:update               │  │
 │  │ POST /api/rooms          │      │ telemetry:bulkSync            │  │
 │  │ POST /api/rooms/join     │      │ crash:candidate               │  │
 │  │ GET  /api/rooms/:g/hist  │──────┤ crash:countdownExpired        │  │
 │  │ GET  /api/rooms/:g/summ  │      │ crash:cancelled               │  │
 │  │ POST /api/users/med-info │      │ refill:requested              │  │
 │  │ GET  /api/safety/config* │      │ (vehicle:breakdown ✗ NEVER)   │  │
 │  └──────────────┬───────────┘      └──────────────┬────────────────┘  │
 │                 │                                 │                   │
 │  Google Maps    │ (✗ placeholder key)             │                   │
 │  ┌──────────────┼──────────┐   Server→Client:      │                   │
 │  │ Maps SDK ✗   │          │   session:joined       │                   │
 │  │ Places ✗     │          │   session:member_joined│                   │
 │  │ Geocode ✗    │          │   session:member_left  │                   │
 │  └──────────────┴──────────┘   location:broadcast    │                   │
 │                               refill:notified        │                   │
 │                               group:separationAlert  │                   │
 │                               group:reunited         │                   │
 │                               (sos:broadcast ✗ NOT listened)            │
 │                               (vehicle:breakdownReported ✗ NOT listened)│
 └──────────────┬──────────────────────┬───────────────────────────────────┘
                │ REST                  │ Socket.IO (default namespace,
                ▼                       │  io.use(AuthMiddleware))
 ┌────────────────────────────────────────────────────────────────────┐
 │                    Backend — Node/Express/Socket.IO                 │
 │  backend/src/index.ts (composition root)                           │
 │  routes: AuthRouter, RoomRouter, SafetyRouter, WeatherRouter,       │
 │          GeofenceRouter, DeviceRouter, MedicalInfoRouter            │
 │  sockets: RideSocketController → Session/Location/BulkSync/Crash/  │
 │           Disconnect/VehicleBreakdown/RefillNotification handlers  │
 │  services: User, Room, Telemetry, EmergencyAlert, Presence,         │
 │            Weather, GroupCoherence, FcmPush, VehicleBreakdown,      │
 │            MedicalInfo, RefillNotification                          │
 │  QueryRunner (pg.Pool) → PostGIS                                   │
 └───────┬────────────────────────────────────────────────────────────┘
         │
         ▼
 ┌────────────────────────────────────────────────────────────────────┐
 │  PostgreSQL + PostGIS                                              │
 │  users, ride_rooms, room_members, telemetry_readings,             │
 │  rider_current_locations (trigger), crash_candidates,             │
 │  emergency_alarms, geofences, medical_info, device_tokens,        │
 │  vehicle_breakdowns, refill_notifications                          │
 └────────────────────────────────────────────────────────────────────┘
```

### Flows that are live end-to-end
1. **Auth:** register → login → JWT (issuer/audience verified, legacy-fallback accepted). ✅
2. **Room lifecycle:** create (owner auto-added) / join (expiry + capacity + dup checks) via REST. ✅
3. **Member roster:** `session:join` → server joins `group:${group_code}` room, emits `session:joined` + `session:member_joined`. ✅ *Server side.* ❌ **Ack never returned** (see Finding 1).
4. **Live location:** `location:update` → PostGIS insert + `location:broadcast` to others. ✅ *Contract matches.* ❌ **Never triggered in a ride** (see Finding 1).
5. **Offline resync:** `telemetry:bulkSync` → `jsonb_to_recordset` batch insert → ack `{confirmedClientReadingIds}` → mobile marks synced. ✅
6. **Crash:** candidate persist → countdown → confirm (SOS) / cancel (false_alarm), 3/min rate limit. ✅ *Outbound.* ❌ *Inbound SOS to other riders not rendered* (see Finding 6).
7. **Refill:** `refill:requested` → persisted + FCM targets + `refill:notified` broadcast → mobile banner. ✅
8. **Coherence:** separation/reunion alerts → mobile banners. ✅ (dependent on live location feed).

### Flows that are inert (wired on one side only or keyed to a placeholder)
- **Google Maps** (native + Places + Geocode): placeholder API key. ❌
- **Vehicle breakdown** (`vehicle:breakdown`): mobile never emits; never listens to the broadcasts. ❌
- **Weather** (`GET /api/rooms/:groupCode/weather`): backend complete, mobile never calls it.
- **FCM pushes** (`POST /api/devices/register`): backend complete, mobile never registers a token → refill/breakdown push targets are empty in practice.
- **Remote crash tuning** (`GET /api/safety/config`): 401 for the unauthenticated mobile fetch.
- **`peer:lastKnown`** (server→room on disconnect): no mobile listener.

---

## 3. REST Contract Verification

| Endpoint | Mobile caller (file:line) | Backend handler | Payload match | Verdict |
|---|---|---|---|---|
| `POST /api/auth/register` `{name,email,password,phone}` → `{id,name,email}` | `RegistrationGateScreen.tsx:130` | `AuthRouter` → `UserService.register` | ✓ (`normalizeNepaliPhone` → E.164 matches server regex) | 🟢 |
| `POST /api/auth/login` `{email,password}` → `{token,user:{id,name,email,profile_complete}}` | `LoginScreen`, `App.tsx:315` (auto-login) | `UserService.login` | ✓ (`App.tsx:291-300` consumes shape) | 🟢 |
| `POST /api/rooms` `{destination:{latitude,longitude,label}}` → `{room_id,group_code,creator_id,destination}` (201) | `CreateRideDestinationScreen.tsx:298-325` | `RoomRouter.handleCreateRoom` → `RoomService.createRoom` | ✓ (reads `body.group_code`; destination fields map 1:1) | 🟢 |
| `POST /api/rooms/join` `{group_code}` → `{message,room_id}` | `JoinRideScreen.tsx:79-112` | `RoomRouter.handleJoinRoom` → `RoomService.joinRoom` | ✓ (`ALREADY_MEMBER` handled as success path) | 🟢 |
| `GET /api/rooms/:groupCode/history` (auth) | `useRideSummary.ts` | `RoomRouter.handleGetHistory` → `getRoomHistory` (PostGIS `ST_X/ST_Y`) | ✓ | 🟢 |
| `GET /api/rooms/:groupCode/summary` (auth) → `{total_distance_meters,duration_ms,...}` | `useRideSummary.ts` | `RoomRouter.handleGetSummary` → `PostgisTelemetryRepository` | ✓ (field names match shared `contracts/ride-summary.ts`) | 🟢 |
| `GET /api/safety/config` | `fetchDetectionConfig.ts:30` — **no Authorization header** | `SafetyRouter` → requires `authenticateJWT` | ✗ always **401** → defaults used | 🔴 Finding 3 |
| `POST /api/users/medical-info` `{blood_group,allergies,emergency_contact_name,emergency_contact_phone,notes}` | `RiderProfileScreen.tsx:90-100` | `MedicalInfoRouter` → `MedicalInfoService` | ✓ (E.164 parse `\+[1-9]\d{1,14}` matches server) | 🟢 |
| `GET /api/rooms/:groupCode/weather` | **never called** | `WeatherRouter` | — | 🟡 |
| `POST /api/devices/register` | **never called** | `DeviceRouter` → `FcmPushService` | — | 🟡 |
| `GET /api/health` | `TelemetryModule` ConnectivityManager probe | `RoomRouter` health | ✓ | 🟢 |

---

## 4. WebSocket Event Verification

Socket auth path matches: mobile connects `io(API_BASE_URL, {auth:{token}, transports:['websocket']})` (default namespace); backend `io.use(AuthMiddleware.authenticateSocket)` reads `handshake.auth.token` (with Bearer-strip fallback) and sets `socket.user={id,name,role}`.

| # | Event | Direction | Mobile (send / listen) | Backend (recv / emit) | Match |
|---|---|---|---|---|---|
| 1 | `session:join` | C→S | `SocketClient.joinSession` `:152` — **sends ack callback**, waits forever | `SessionHandler.handleJoin` — signature `(data)`, **never invokes ack** | 🔴 **Finding 1** |
| 2 | `session:joined` | S→C | `App.tsx:181` maps `members[].user_id/name` (+ reads `latitude/longitude` that don't exist) | `SessionHandler` → `getMembers` returns `{user_id,name}` only | 🟠 Finding 7 |
| 3 | `session:member_joined` | S→C | `App.tsx:194` | `{user_id,name}` | 🟢 |
| 4 | `session:leave` | C→S | **never emitted** (no `leaveSession` API on client) | handled | 🟡 |
| 5 | `session:member_left` | S→C | `App.tsx:202` | `{user_id,name}` | 🟢 |
| 6 | `location:update` | C→S | `emitLocationUpdate` `{timestamp,latitude,longitude,accuracy,speed}` | `LocationHandler` → save + broadcast | 🟢 contract — but **never fires in a ride** (Finding 1 blocks provider) |
| 7 | `location:broadcast` | S→C | `App.tsx:207` (others-only, upserts roster) | `{user_id,name,timestamp,latitude,longitude,accuracy,speed}` to others | 🟢 |
| 8 | `telemetry:bulkSync` | C→S | `emitBulkSync` `{readings:[...]}`, ack cb, 10s timeout | `BulkSyncHandler` → batch insert + ack `{confirmedClientReadingIds}` | 🟢 |
| 9 | `crash:candidate` | C→S | `App.tsx:271` `{timestamp,latitude,longitude}` | `CrashHandler` → `crashRepo.insert` + rate limit | 🟢 |
| 10 | `crash:countdownExpired` | C→S | `App.tsx:284` `{timestamp,latitude,longitude}` | → outcome `confirmed` + `EmergencyAlertService.createAlert` + emit `sos:broadcast` | 🟢 outbound |
| 11 | `sos:broadcast` | S→C | **not listened** | `{alarm_no,user_id,name,timestamp,latitude,longitude,medical_info}` | 🟠 Finding 6 |
| 12 | `crash:cancelled` | C→S | `App.tsx:371` (no payload) | → outcome `false_alarm` | 🟢 |
| 13 | `refill:requested` | C→S | `App.tsx:359` `{group_code,note}` | `RefillNotificationHandler` → persist + FCM + emit `refill:notified` | 🟢 |
| 14 | `refill:notified` | S→C | `App.tsx:231` (banner) | `{refill_id,user_id,name,group_code,note,timestamp}` | 🟢 |
| 15 | `vehicle:breakdown` | C→S | **never emitted** (`triggerBreakdownReport` sets local state only) | `VehicleBreakdownHandler` | 🟠 Finding 5 |
| 16 | `vehicle:breakdownReported` | S→C | **not listened** | `{breakdown_id,user_id,name,reason,note,latitude,longitude,reported_at,medical_info}` | 🟠 Finding 5/6 |
| 17 | `vehicle:breakdownResolved` | S→C | **not listened / never requested** | `{breakdown_id,user_id,name,resolved_at}` | 🟠 Finding 5/6 |
| 18 | `group:separationAlert` | S→C | `App.tsx:236` (role via `separated_rider.name`) | `{separated_rider:{user_id,name,current_speed,recommended_speed,distance_from_nearest_meters}, meeting_point:{latitude,longitude,is_approximate}, group_recommendation:{recommended_speed}, timestamp}` | 🟢 |
| 19 | `group:reunited` | S→C | `App.tsx:244` (checks `payload.user_id`) | `{user_id,name,timestamp}` | 🟢 |
| 20 | `peer:lastKnown` | S→C | **not listened** | `DisconnectHandler` | 🟡 |
| 21 | `error` | S→C | **not listened** | `{message}` (server-side failures) | 🟡 |

---

## 5. Findings by Severity

### 🔴 BROKEN — must fix

**Finding 1 — `session:join` ack never fires ⇒ no location streaming during a ride.**
- *Send:* `mobile/src/telemetry/socket/SocketClient.ts:146-160` — `joinSession` emits `session:join` with an ack callback and returns a promise that resolves only when the callback fires.
- *Receive:* `backend/src/handlers/SessionHandler.ts:24` — `handleJoin(data)` signature has no callback parameter; the server never invokes the Socket.IO ack.
- *Why it breaks:* `mobile/src/telemetry/TelemetryModule.ts:84-86` does `if (options.groupCode) await this.socketClient.joinSession(options.groupCode);` and `locationProvider.start()` follows at line 100. In `App.tsx`, `activeRoomCode` is empty on the first effect run (login), so the first run works — but the *second* run (after room create/join sets `activeRoomCode`) hangs at line 85 forever, and **the GPS provider never starts**: no `handleIncomingReading`, no `location:update`, no `currentLocation` for the map, no crash telemetry feed, no coherence evaluation.
- *Also:* `App.tsx:180` `joinSession(activeRoomCode).catch(() => setConnection('offline'))` never settles either — the catch that would flip the UI to offline never fires.
- *What to change:* (a) backend — `handleJoin(data, cb)` call `cb(null)`/`cb({ok:true})` after the room join; (b) mobile — make `joinSession` best-effort/non-blocking (do not gate `locationProvider.start()` on it); rely on `session:joined` as the real signal.

**Finding 2 — Double/leaked Socket.IO connections per effect run.**
- `mobile/App.tsx:252` calls `socketRef.current.connect(API_BASE_URL, authToken)` **and** line 253 passes the same client into `telemetryModuleRef.current.start({...})`, which calls `connect()` again at `TelemetryModule.ts:83`. Each `connect()` creates a new `io()` and discards the previous socket handle without disconnecting it (`SocketClient.ts:108-132`). Every effect run (login, create ride, join ride, each auth change) leaks one more connection.
- *What to change:* single owner of the connection lifecycle; make `SocketClient.connect` idempotent (disconnect any existing socket first), and drop one of the two call sites.

**Finding 3 — `/api/safety/config` always returns 401 ⇒ remote crash-tuning dead.**
- *Send:* `mobile/src/safety/crash/fetchDetectionConfig.ts:30` — `fetch(`${baseUrl}/api/safety/config`, {signal})` with **no Authorization header**.
- *Receive:* `backend/src/routes/SafetyRouter.ts:17` — requires `AuthMiddleware.authenticateJWT`. Verified live: 401.
- *Effect:* every device uses hardcoded `DEFAULT_DETECTION_CONFIG`; the 13 tunable parameters can never be tuned without an app rebuild. (Fail-safe, not fail-open — defaults apply, so detection still works.)
- *What to change:* pass `authToken` into `fetchDetectionConfig` and send `Authorization: Bearer <token>`, or relax the endpoint to public (it exposes no sensitive data).

**Finding 4 — Google Maps key is a build-time placeholder.**
- `mobile/android/gradle.properties`, `mobile/android/local.properties`: `GOOGLE_MAPS_API_KEY=YOUR_GOOGLE_MAPS_API_KEY_HERE`; injected into `AndroidManifest.xml:22-24` (`com.google.android.geo.API_KEY`). `CreateRideDestinationScreen` guards JS-side calls against the placeholder, so the map renders blank and Places/Geocode silently return nothing.
- *What to change:* real key in `local.properties` (native meta-data) **and** `mobile/.env` (JS `process.env.GOOGLE_MAPS_API_KEY`, consumed by babel.config.js). Enable required Maps/Places/Geocoding APIs in Google Cloud.

### 🟠 MISMATCH / one-sided wiring

**Finding 5 — Vehicle breakdown is UI-local; never transmitted.**
- `mobile/App.tsx:375-381` `triggerBreakdownReport` only sets local state (`setBreakdownActive(true)`); no `socketRef.current.emitEvent('vehicle:breakdown', …)`. The backend handlers (`VehicleBreakdownHandler`) and broadcast payloads exist and are complete. `onResolveBreakdown` (`App.tsx:520`) is also local-only.
- *What to change:* emit `vehicle:breakdown` `{reason,note,latitude,longitude}` (reuse `readCurrentLocation()`), listen for `vehicle:breakdownReported`/`vehicle:breakdownResolved`, and emit `vehicle:breakdownResolved` on resolve.

**Finding 6 — Inbound safety broadcasts are not listened to.**
- `sos:broadcast` (crash confirm of another rider), `vehicle:breakdownReported`, `vehicle:breakdownResolved`, and `peer:lastKnown` have no listeners registered in `App.tsx`'s `onConnect` block (`App.tsx:178-251`). A rider in the group sees **nothing** when another member triggers an SOS, even though the backend persists and broadcasts it. The SOS screen (`App.tsx:529-535`) only reflects the local rider's own alert.
- *What to change:* register handlers for `sos:broadcast` (show emergency modal/banner), `vehicle:breakdownReported` (show breakdown banner), and optionally `peer:lastKnown` (graceful roster update).

**Finding 7 — `session:joined` members carry no coordinates.**
- Backend `SessionHandler` → `RoomService.getMembers` returns only `{user_id,name}`; mobile `App.tsx:184-190` reads `m.latitude/m.longitude` → `undefined` → mapped to `0` (`App.tsx:490-491`) → filtered by `LiveMapView`. Roster entries get coordinates only after each rider's first `location:broadcast`. Harmless in a working feed, but the roster is coordinate-less until then.
- *What to change (optional):* left-join `rider_current_locations` in `getMembers`, or leave as-is since broadcasts populate it.

### 🟡 MINOR / notable

- **Stale bundled JS:** committed `mobile/android/app/src/main/assets/index.android.bundle` (last written 8/16 09:16) predates `src/telemetry/index.ts` (09:52) and source commits `1f8b054`/`38d16da`. Any APK built from the committed bundle ships older logic than HEAD.
- **No ride-end lifecycle:** the app never calls a room-end path; backend `ride_rooms.status` stays `active` (summary/history still work; `weather` endpoint stays reachable; nothing cleans up).
- **No `session:leave`:** client has no leave API; membership cleanup relies on socket disconnect (`DisconnectHandler`).
- **`error` events unhandled:** backend rate-limit/refill/breakdown failures emit `error` with no mobile listener (silent failures).
- **Profile gate is nominal:** `UserService.register` always sets `profile_complete=true`, so the `profile_complete===false` → registration redirect in `App.tsx:299` effectively never triggers for app-registered users.
- **`peer:lastKnown`** has no listener (roster entry just disappears on peer disconnect — acceptable).

### 🟢 Verified correct (contracts match, both ends wired)
- All REST flows in §3 except `/api/safety/config`.
- Socket auth + namespace; `location:update`/`location:broadcast`; `telemetry:bulkSync` ack; `crash:*` emits + rate limit; `refill:requested`/`refill:notified`; `group:separationAlert`/`group:reunited` payloads; `session:joined`/`member_joined`/`member_left` names; backend medical-info snapshot attached to SOS/breakdown; live backend health.

---

## 6. Google Maps / Android Native Layer

| Item | Status | Evidence |
|---|---|---|
| `applicationId`/namespace | `com.guardianangelmobile`, minSdk 24, target/compile 36 | `android/app/build.gradle` |
| Maps SDK key (native) | ❌ placeholder `YOUR_GOOGLE_MAPS_API_KEY_HERE` | `gradle.properties`, `local.properties`, `AndroidManifest.xml:22-24` |
| JS Maps/Places/Geocode key | ❌ no `mobile/.env`; `process.env.GOOGLE_MAPS_API_KEY` unset at build | `babel.config.js:34-53` |
| Permissions | ✅ INTERNET, FINE/COARSE/BACKGROUND location, FOREGROUND_SERVICE(+LOCATION) | `AndroidManifest.xml:3-8` |
| Cleartext/network config | wired via `networkSecurityConfig` (backend is HTTPS so fine) | `AndroidManifest.xml:17-18` |
| Bundle freshness | ❌ committed bundle stale vs HEAD source | git log vs mtime |
| Background geo | license-gated `react-native-background-geolocation`; falls back to foreground Geolocation | `LocationProvider.ts:174-272` |

---

## 7. Verdict Lists (A–F)

**A. Definitely working (verified by source diff + live probe)**
1. Auth register/login, JWT issuance & verification.
2. Room create / join REST (expiry, capacity, dup, profile-gate guards).
3. Socket JWT auth (handshake `auth.token`), default-namespace match.
4. `session:join` server-side membership (room join + member events) — ack aside.
5. `location:update` → PostGIS persist → `location:broadcast` payload contract.
6. `telemetry:bulkSync` batch insert + `{confirmedClientReadingIds}` ack + client mark-synced loop.
7. `crash:candidate` persist + `crash:countdownExpired`→SOS/`crash:cancelled`→false_alarm, 3/min rate limit.
8. `refill:requested`→`refill:notified` (persist + room broadcast + FCM targeting).
9. `group:separationAlert` / `group:reunited` payload shapes consumed by mobile banners.
10. Medical-info upsert + snapshot attachment on SOS/breakdown.

**B. Definitely broken**
1. Live location streaming during a ride (joinSession ack hang blocks the GPS provider) — **core feature**.
2. Double/leaked socket connections per effect run.
3. Remote crash-config tuning (`/api/safety/config` 401).
4. Google Maps rendering, Places search, reverse geocode (placeholder key, native + JS).
5. Committed Android bundle out of date with HEAD source.

**C. Probably broken / feature-dead (single-sided wiring)**
1. Vehicle breakdown alerts: mobile never emits, never renders inbound.
2. Inbound SOS (`sos:broadcast`) — other riders' emergencies invisible on-device.
3. `peer:lastKnown` roster handling on peer disconnect.
4. Weather display in app (endpoint unused).
5. FCM push delivery in practice (no `device_tokens` rows — mobile never registers).
6. Ride-end lifecycle (backend rooms stay `active`).

**D. Unverifiable without device/DB access**
1. PostGIS query correctness against the live schema (queries reviewed; no row-level run).
2. Real two-device group ride (roster/broadcast behavior under load).
3. Background geolocation on-device (BGGeo license validation).
4. Crash detection false-positive rate (thresholds explicitly unvalidated per README).
5. FCM end-to-end delivery.

**E. Minimum fixes to reach a working live demo**
1. Backend: `SessionHandler.handleJoin(data, cb)` → invoke ack (`SessionHandler.ts`).
2. Mobile: don't gate `locationProvider.start()` on `joinSession`; make `joinSession` best-effort (`TelemetryModule.ts:84-86`).
3. Mobile: single connection owner; idempotent `SocketClient.connect` (`App.tsx:252`, `TelemetryModule.ts:83`).
4. Mobile: send `Authorization: Bearer` in `fetchDetectionConfig` (`fetchDetectionConfig.ts:30`).
5. Wire `vehicle:breakdown` emit + listen for `sos:broadcast` / `vehicle:breakdownReported` (`App.tsx`).
6. Real Google Maps key in `local.properties` + `mobile/.env`; rebuild bundle.
7. Rebuild `index.android.bundle` from HEAD.

**F. Recommended fix order**
1. **Finding 1** (ack) — one-line backend change; unblocks core tracking.
2. **Finding 1b** (mobile gating) — unblock GPS provider regardless of ack behavior.
3. **Finding 2** (single connect) — removes leaks and race between two `connect()` calls.
4. **Finding 3** (config auth header) — restores remote tuning.
5. **Finding 5/6** (breakdown + SOS visibility) — safety parity for the demo.
6. **Finding 4** (Maps key) + bundle rebuild — required before any on-device demo of the map screen.
7. Nice-to-have: `session:joined` with coords, ride-end call, `session:leave`, `error` listener, weather/FCM wiring.

---

## 8. Root-Cause Trace (Finding 1 in full)

```
App.tsx:176 useEffect([authToken, activeRoomCode])
 ├─ run 1 (login, activeRoomCode='')
 │    socketRef.current.connect()          → io #1 (listeners registered)
 │    telemetryModule.start()              → connect() again → io #2 (orphaned)
 │        options.groupCode='' → skip join → locationProvider.start() ✓ (works)
 ├─ run 2 (ride created/joined, activeRoomCode='ABC123')
 │    cleanup: disconnect() + telemetryModule.stop() (sets started=false)
 │    socketRef.current.connect()          → io #3
 │    telemetryModule.start()              → connect() → io #4 (orphaned)
 │        options.groupCode='ABC123' → await joinSession('ABC123')
 │            socket.emit('session:join', {group_code}, ackCb)
 │            backend handleJoin(data)  ← no callback invoked
 │            → promise NEVER settles → locationProvider.start() NEVER runs
 │            → no GPS, no location:update, no currentLocation, no crash telemetry
 └─ App.tsx:180 joinSession(...).catch(...)  ← also never settles
```
The server side is correct (the socket does join `group:ABC123` and emits `session:joined`); only the ack is missing. Because `session:joined` populates the roster, the app looks "connected" while silently streaming nothing.

---

## 9. Open Questions

1. Should `/api/safety/config` be public or authenticated? (Fix differs.)
2. Is the `sos:broadcast` UX expected as an in-app modal, banner, or push only?
3. Is the Google Maps key available for field-testing (native + Places/Geocode), or is a marker-free map acceptable for the demo?
4. Who can register an FCM device token, and should the app prompt for notification permission?

---

## 10. Source of Truth (files referenced)

- `mobile/App.tsx` — app state machine, socket wiring, crash/refuel/breakdown emits.
- `mobile/src/telemetry/TelemetryModule.ts`, `mobile/src/telemetry/socket/SocketClient.ts` — telemetry pipeline & ack logic.
- `mobile/src/safety/crash/fetchDetectionConfig.ts` — unauthenticated config fetch.
- `mobile/src/ui/{CreateRideDestinationScreen,JoinRideScreen,RiderProfileScreen,RegistrationGateScreen,useRideSummary}.tsx` — REST payloads.
- `backend/src/index.ts`, `backend/src/sockets/RideSocketController.ts` — composition, socket registration.
- `backend/src/handlers/*` — event contract source.
- `backend/src/routes/{AuthRouter,RoomRouter,SafetyRouter}.ts` — REST contract source.
- `backend/src/services/{RoomService,TelemetryService,UserService,GroupCoherenceService}.ts` — DB columns & payload shapes.
- `mobile/android/{gradle.properties,local.properties,app/src/main/AndroidManifest.xml}` — Maps key + permissions.
- `contracts/websocket-events.ts`, `contracts/ride-summary.ts` — canonical shared contracts.
