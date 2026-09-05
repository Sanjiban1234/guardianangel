# Telemetry reliability audit and implementation

## Baseline (before changes)
Branch integration/all-features; HEAD and origin: b8cc4c40e78db5ac556dc0b821aaa41ae8d369e5.
Existing unrelated work: modified .gitignore; untracked docs/guardian-angel-er-diagram.html and docs/guardian-angel-report-er-diagram.svg. Preserve these.

Android RideTrackingService uses fused location and location.time, emits RideTrackingLocation to React Native, then AndroidRideLocationProvider calls TelemetryModule. The foreground fallback uses community geolocation. Native service is START_NOT_STICKY and has no native spool: JS revalidates the ride before restart. It cannot record while the process is dead.

Production App constructs TelemetryModule without a database adapter, selecting InMemoryTelemetryDatabase. The unused OpSqlite adapter has no installed native dependency and silently does nothing when missing. Neither SQLite nor AsyncStorage currently durably stores telemetry. Offline rows contain UUID client_reading_id, timestamp, latitude, longitude, accuracy, nullable speed and synced; no room/user scope. Native heading/altitude are not exposed. Online samples bypass storage, omit their ID and emit without ACK. Offline reconnect uses 300-row bulk ACKs and marks confirmed IDs synced, retaining uploaded rows forever. Restart loses the in-memory queue. Recovery logic exists but cannot recover data after process death.

TelemetryService generates new IDs for live writes and upserts by room/user/device timestamp; bulk deduplicates by user/client ID, but RETURNING excludes duplicates, so lost ACKs stall recovery. device_timestamp_ms already records measurement time; received_at defaults to server time. The database trigger advances current locations for every inserted row, including bulk history. LocationHandler ignores saveTelemetry failure and broadcasts/evaluates coherence anyway.

Summary orders by device time, filters accuracy over 100m and implied speed over 180km/h, but bridges long gaps. It divides ALL geographic distance by ONLY moving intervals while maximum uses native/fallback speeds. Thus a long positional gap with low native speed can inflate the average beyond the maximum (the reported 274.4 versus 3.2); the actual ride dataset is not present to reproduce those exact numbers. Long low-speed gaps count as stopped. Flat routes draw false connectors. Mobile Number(null) converts unavailable speeds to zero. Pace benchmark is explicitly null, independent of these calculations.

## Implemented delivery model

Production App explicitly supplies DurableTelemetryDatabase, using the already-installed AsyncStorage 3.1 API (`setItem`, `getMany`, `removeMany`). Each sample is an atomic independent native value; no shared mutable JSON array or in-memory-only fallback. The unused op-sqlite adapter is not enabled because its native driver is absent. No dependencies or lockfiles changed.

Fields: UUID `client_reading_id`, `groupCode`, authenticated local `userId`, device `timestamp`, latitude, longitude, accuracy, nullable native speed, and pending `synced: false`. Native heading/altitude are not exposed. Negative/unavailable native speeds become null. Pending keys are per user and stable UUID. GPS callbacks retain their captured ride scope during lifecycle changes. Native starts/stops are serialized. Post-join one-shot/reconnect sends use the same durable ingestion, without replaying cached fixes into the local crash stream.

Capture -> validate coordinates/time/accuracy -> notify existing live safety stream -> reserve live delivery -> await native durable write -> send immediately if connected -> await persistence ACK. Live reservations prevent a backlog worker from consuming a newly persisted live sample. A storage failure emits a sanitized warning and does not send an unpersisted fix. No coordinates, credentials or medical data are logged by the new diagnostics.

`location:update` includes `client_reading_id` and `groupCode`; callback is `{ accepted, sampleId, permanent }`. Positive ACK means stored or already represented by the same rider/ride/device timestamp. Invalid payloads are permanently rejected; room-not-ready/database failures stay pending. Missing ACK times out after 10 seconds and retains the same identity. Late ACK deletion is idempotent.

`telemetry:bulkSync` carries `{ groupCode, readings }`; callback is `{ confirmedClientReadingIds, rejectedClientReadingIds }`. Membership is checked against the explicit room and authenticated socket user, including ended rooms, without joining/reactivating that room. One INSERT handles each batch, then a committed-row query confirms both new rows and retries. Existing database UUID and timestamp uniqueness constraints resolve retries. The alternate timestamp identity preserves compatibility with legacy live writes and repeated native fixes. Never use the supplied userId as server authorization.

Recovery runs on authenticated user restoration, successful room rejoin, connectivity recovery and a retry timer. Each batch contains at most 100 oldest eligible points for one room. One worker is in flight; sends are at least 12 seconds apart, respecting the existing six-batch/minute limiter. Transport failures back off to 24/48/60 seconds. Empty confirmations defer that room for 60 seconds so inaccessible history cannot starve another room. Fresh location updates run independently. Reads use 100-key native chunks and retain only the oldest requested candidates in memory. Logout suspends recovery; other users' samples are never selected. Ride end/room change stops sampling but keeps authenticated historical delivery alive. Pending records are never age/cap-purged; accepted records are deleted immediately. Revoked/deleted membership history remains local for that user rather than being silently reassigned or discarded.

## Database and live safety

Existing `device_timestamp_ms` is recordedAt; existing server-default `received_at` is receivedAt. The only added column is `is_historical`, via ADD COLUMN IF NOT EXISTS. Schema initialization replaces the trigger idempotently; no production migration was run. Backfills always set historical=true. Historical rows and live writes older than the existing 15-second presence freshness threshold or more than 5 seconds in the future cannot touch rider_current_locations. Current updates require strict `>` recorded-time ordering. The handler acknowledges stored history but returns before location broadcasts, Portal updates or coherence evaluation. Fresh accepted current points retain the existing live pipeline and all separation/reunion thresholds. Duplicate retries do not rebroadcast or reevaluate safety. Presence remains socket-based and freshness remains recent live-coordinate-based.

## Summary calculations and UX

Device timestamps order route analysis. Ride start/end bounds exclude pre-/post-ride points and make missing leading/trailing intervals unknown. Legacy rides without lifecycle clocks use the raw measured-time span, including poor-quality endpoints where timestamps exist.

Named thresholds reuse accuracy <=100m, plausible speed <=180km/h, moving >=3km/h and sustained stop >=10 seconds. A new 60-second maximum adjacent interval represents twelve missing nominal 5-second fixes. Invalid coordinates/accuracy interrupt continuity. Duplicate timestamps are removed; out-of-order uploads are sorted. Impossible spatial jumps and long intervals retain real endpoints but mark `gap_before`; no interpolated points are created. Native speeds are preferred, with geographic fallback restricted to valid adjacent nongap intervals. Distance excludes gaps. Zero native speed from legacy clients is accepted as stopped only with stationary geographic evidence.

Average moving speed is the elapsed-time-weighted mean of trustworthy moving interval speeds, not all route distance divided by partial moving time. Maximum uses accepted native/fallback speed observations, including individually trustworthy isolated native speeds; zero remains valid when observed. Thus average <= maximum by construction. Dense consecutive stationary intervals accumulate into sustained stop runs. Short ambiguous stop runs, missing/unreliable intervals and ride-edge gaps are unknown. Moving + stopped + unknown equals duration. Missing statistics remain null, including through mobile parsing.

The response retains bounded `route` with gap flags and adds `route_segments`, moving_time_ms, unknown_time_ms, telemetry_gap_count and has_low_data. Downsampling propagates skipped gap boundaries and never connects across one. Mobile draws separate colored polylines, shows gap/unrecorded notes and Unavailable for null stats. Unknown chart samples have no bar. Refresh summary fetches recovered history while uploads continue. Pace benchmark remains intentionally null; no unrelated benchmark/weather/TTS/AI behavior was changed.

## Physical device test plan (not executed here)

Use a development backend with the additive migration applied by its normal startup, two authenticated riders, and a Guardian Portal observer. Record the test room/user IDs privately. Inspect counts/timestamps/IDs only; avoid sharing coordinates or credentials in logs. A debug inspection of AsyncStorage keys beginning `@guardianangel/telemetry/v1/` establishes pending counts. Server logs give bulk started/completed counts. Database checks should compare total rows, distinct client_reading_id and recorded/receive timestamps for this rider/room.

### A. Offline ride

1. Start online and confirm a live sample appears in backend history/current location and the Portal.
2. Disable both Wi-Fi and mobile data; keep GPS enabled.
3. Walk/ride a controlled route for at least three minutes with the screen off for part of it.
4. Confirm new pending native storage keys accumulate while offline and GPS tracking notification remains present.
5. Reconnect. Confirm room rejoin, then historical batches of <=100 at >=12-second spacing. Verify recorded timestamps stay original while received_at reflects reconnect.
6. Check the second rider and Portal: current markers follow fresh points; no historical separation/reunion/SOS or freshness renewal occurs.
7. Wait for pending count to reach zero, or end the ride during delivery to exercise authenticated final flush.
8. Open summary and tap Refresh summary after remaining ACKs. Confirm recorded route shape, plausible average/max (average <= max), plausible stopped duration, and disclosed true missing intervals. There must be no giant connector across a missing interval.

### B. Disconnect during backlog

1. Accumulate at least 400 pending points (roughly 34 minutes at five-second cadence, or use a development injection harness).
2. Reconnect and interrupt network during the first batch/ACK window.
3. Reconnect again; repeat twice. Compare pending UUIDs with stored UUIDs.
4. Verify identical IDs on retry, one server row per identity/timestamp, <=1 batch in flight, continued fresh delivery, and eventual pending count zero. ACK-loss simulation must confirm duplicates rather than stall.

### C. Offline process restart

1. Start a validated active ride, go offline, and accumulate pending samples.
2. Kill the process, then reopen while offline. Inspect that previously saved keys remain.
3. Observe session validation behavior: tracking only restarts once the existing active-ride validation flow permits it. Do not expect points during process death or before validation.
4. Reconnect, restore the active ride, and confirm original pending IDs/time order upload. The killed interval must be unknown/segmented.
5. Separately end a ride with pending data, restart/login as the same rider and verify final history flush even without an active room. Log in as a different user and verify old data is neither sent as that user nor deleted.

### D. Live safety regression during replay

1. With two riders and Portal connected, capture a recent current marker, then replay older points located elsewhere.
2. Verify rider_current_locations.device_timestamp_ms never decreases and received-time freshness is not renewed by history.
3. Confirm no stale separation/reunion or SOS and no marker jump to old positions.
4. Move current riders across existing 500m/30s separation and 300m/15s reunion conditions; verify normal alerts still occur with current live samples while backlog is running.
5. Disconnect the rider's socket: Portal must show disconnected even if historical delivery/storage activity occurred recently.

## Limits

Native GPS collection while the process is dead is not provided by the existing START_NOT_STICKY service. Recovery preserves completed durable writes, not a fix interrupted before the native write completes. Storage exhaustion or native storage failure prevents saving that fix and is logged; pending history has no destructive cap. Native Android storage durability/performance, process-kill behavior, real PostGIS migration/trigger semantics and physical safety behavior require the field checks above. Automated database tests use injected query doubles and schema assertions, not a production database. No measured coordinates from the reported failing ride were available; the regression models its timing/speed/gap pattern. Old clients that ignore new gap flags can still draw a flat route; deploy the updated mobile summary with this backend. Historical rows saved before this migration cannot be retroactively identified as delayed uploads, and existing current-location projections are not destructively rebuilt.

## Final A-Z report

| Item | Result |
|---|---|
| A. Root cause | In-memory offline queue, unacknowledged online sends, duplicate-excluding bulk ACKs, current-location trigger on history; summary divided all distance by partial moving time and bridged missing intervals. |
| B. Previous buffering | Unscoped in-memory offline rows only; process restart lost them; confirmed rows remained forever. |
| C. New architecture | Save first, ACKed live delivery plus independent bounded historical recovery. |
| D. Persistence | Existing native AsyncStorage 3.1, one atomic value per user/UUID; no new native dependency. |
| E. Identity/deduplication | Stable client UUID; existing user/UUID and room/user/device-time database uniqueness; committed retry confirmation. |
| F. ACK | Live accepted/sampleId/permanent; bulk confirmed and permanently rejected ID lists; temporary failures remain pending. |
| G. Reconnect | Auth/session recovery and timers; oldest-first scoped batches; one worker, <=100 samples, >=12-second spacing, bounded backoff. |
| H. Timestamps | device_timestamp_ms is measurement time; received_at remains the server acceptance clock. |
| I. Historical/live | Historical inserts bypass current markers, Portal updates, coherence and live alerts. |
| J. Ordering | Strictly newer device time required for current projection; handler checks that inserted live time remains current. |
| K. Quality | Coordinate/accuracy/time validity, duplicate-time removal, chronological sorting, plausible interval speed. |
| L. Route gaps | >60 seconds, bad-point interruption or >180km/h implied jump; explicit boundaries propagated through downsampling and separate mobile polylines. |
| M. Duration classes | Trusted moving intervals; >=10 seconds accumulated stationary evidence; everything unobserved/ambiguous is unknown, including missing ride edges. |
| N. Speed | Native preferred, adjacent nongap geographic fallback; weighted moving mean <= maximum by construction. |
| O. Unavailable | Null remains null through mobile parsing; Unavailable text, sparse-data explanation and unrecorded duration. |
| P. Migration | Additive idempotent is_historical column and guarded trigger replacement in normal db.ts initialization; not applied to production. |
| Q. Files | Complete task-owned file list below; unrelated baseline work preserved. |
| R. Tests | 23 backend and 16 mobile tests added; existing mocks/expectations updated for acknowledged results and segmented traces. |
| S. Backend | npx tsc --noEmit: exit 0. npm test -- --runInBand: exit 0; 43/43 suites, 317/317 tests, 0 snapshots, 11.321 seconds reported by Jest. |
| T. Mobile | npx tsc --noEmit: exit 0. npm test -- --runInBand --silent: exit 0; 32/32 suites, 261/261 tests, 0 snapshots, 5.426 seconds reported by Jest. Jest emitted its delayed-shutdown warning, then exited normally; no forceExit used. |
| U. Performance | Synthetic 400-point backlog drained as four ordered 100-point batches over 36 seconds of virtual retry time; fresh live ACK delivery completed while first batch was held; one batch in flight. This is a mocked-storage scheduling test, not device throughput measurement. |
| V. Documentation | README, CLAUDE, telemetry README, websocket/summary contracts and database ER analysis updated; this report preserves audit and field instructions. |
| W. Device checklist | Exact A-D plans above: offline collection/resync, repeated disconnect mid-flush, offline process restart and live-safety/Portal regression. Not physically executed. |
| X. Limits | No native collection while process dead; native disk exhaustion cannot guarantee a save; revoked-membership history is retained; actual PostGIS/device checks pending; original failing ride data unavailable. |
| Y. Diff check | git diff --check: exit 0, no whitespace errors. Reviewed git diff and diff stat; no staged changes. |
| Z. Status | Exact git status --short below. Branch and HEAD remain integration/all-features / b8cc4c40e78db5ac556dc0b821aaa41ae8d369e5. No stage/commit/push. |

### Changed files

- `CLAUDE.md`
- `README.md`
- `backend/src/db.ts`
- `backend/src/handlers/BulkSyncHandler.ts`
- `backend/src/handlers/LocationHandler.ts`
- `backend/src/routes/RoomRouter.ts`
- `backend/src/services/RideSummaryTelemetry.ts`
- `backend/src/services/RoomService.ts`
- `backend/src/services/TelemetryService.ts`
- `backend/tests/guardian-portal-socket.test.ts`
- `backend/tests/ride-summary-telemetry.test.ts`
- `backend/tests/telemetry.test.ts`
- `contracts/ride-summary.ts`
- `contracts/websocket-events.md`
- `contracts/websocket-events.ts`
- `docs/database-er-analysis.md`
- `mobile/App.tsx`
- `mobile/__tests__/AppLogout.test.tsx`
- `mobile/__tests__/RideInvitationActivation.test.tsx`
- `mobile/src/safety/crash/__tests__/useCrashDetection.test.ts`
- `mobile/src/telemetry/README.md`
- `mobile/src/telemetry/TelemetryModule.ts`
- `mobile/src/telemetry/database/TelemetryDatabase.ts`
- `mobile/src/telemetry/location/postJoinLocation.ts`
- `mobile/src/telemetry/socket/SocketClient.ts`
- `mobile/src/telemetry/types.ts`
- `mobile/src/ui/RideSummaryScreen.tsx`
- `mobile/src/ui/__tests__/RideSummaryScreen.test.ts`
- `mobile/src/ui/__tests__/rideSummaryRoute.test.ts`
- `mobile/src/ui/__tests__/useRideSummary.test.ts`
- `mobile/src/ui/rideSummaryRoute.ts`
- `mobile/src/ui/useRideSummary.ts`
- `backend/tests/summary-reliability.test.ts`
- `backend/tests/telemetry-reliability.test.ts`
- `docs/telemetry-reliability.md`
- `mobile/__tests__/TelemetryReliability.test.ts`
- `mobile/src/telemetry/database/DurableTelemetryDatabase.ts`

### Final git status --short

```text
 M .gitignore
 M CLAUDE.md
 M README.md
 M backend/src/db.ts
 M backend/src/handlers/BulkSyncHandler.ts
 M backend/src/handlers/LocationHandler.ts
 M backend/src/routes/RoomRouter.ts
 M backend/src/services/RideSummaryTelemetry.ts
 M backend/src/services/RoomService.ts
 M backend/src/services/TelemetryService.ts
 M backend/tests/guardian-portal-socket.test.ts
 M backend/tests/ride-summary-telemetry.test.ts
 M backend/tests/telemetry.test.ts
 M contracts/ride-summary.ts
 M contracts/websocket-events.md
 M contracts/websocket-events.ts
 M docs/database-er-analysis.md
 M mobile/App.tsx
 M mobile/__tests__/AppLogout.test.tsx
 M mobile/__tests__/RideInvitationActivation.test.tsx
 M mobile/src/safety/crash/__tests__/useCrashDetection.test.ts
 M mobile/src/telemetry/README.md
 M mobile/src/telemetry/TelemetryModule.ts
 M mobile/src/telemetry/database/TelemetryDatabase.ts
 M mobile/src/telemetry/location/postJoinLocation.ts
 M mobile/src/telemetry/socket/SocketClient.ts
 M mobile/src/telemetry/types.ts
 M mobile/src/ui/RideSummaryScreen.tsx
 M mobile/src/ui/__tests__/RideSummaryScreen.test.ts
 M mobile/src/ui/__tests__/rideSummaryRoute.test.ts
 M mobile/src/ui/__tests__/useRideSummary.test.ts
 M mobile/src/ui/rideSummaryRoute.ts
 M mobile/src/ui/useRideSummary.ts
?? backend/tests/summary-reliability.test.ts
?? backend/tests/telemetry-reliability.test.ts
?? docs/guardian-angel-er-diagram.html
?? docs/guardian-angel-report-er-diagram.svg
?? docs/telemetry-reliability.md
?? mobile/__tests__/TelemetryReliability.test.ts
?? mobile/src/telemetry/database/DurableTelemetryDatabase.ts
```
