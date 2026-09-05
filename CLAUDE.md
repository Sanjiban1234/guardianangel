# Guardian Angel Engineering Guide

For overview and setup, see [README.md](README.md). This guide defines the implementation rules for Guardian Angel V1.

## Project Purpose

Guardian Angel coordinates group motorcycle rides with deterministic safety workflows, live telemetry, emergency alerts, route/weather awareness, and private guardian observation. Preserve the boundary between safety authority and advisory features.

## Repository Layout

```text
backend/          Express REST API, Socket.IO handlers, services, repositories, schema
mobile/           React Native rider app, telemetry, safety UI, TTS
guardian-portal/  Vite/React observer experience
contracts/        Shared event, weather, and ride-summary contracts
docs/             Supporting engineering and Git-history documents
```

## Current V1 Architecture

Mobile communicates with the TypeScript Express/Socket.IO backend through REST and Socket.IO. PostgreSQL/PostGIS stores users, rides, telemetry, safety records, friends/invitations, Portal shares, and profiles. Open-Meteo supplies weather; Google Places supplies route candidates; DeepSeek may rank validated candidates. Guardian Portal uses the dedicated `/guardian-portal` Socket.IO namespace.

Use constructor-injected backend services and `QueryRunner` database access so tests can mock queries. Keep `contracts/` synchronized when wire shapes change.

## Core Invariants

- AI, UI state, and TTS must never be authoritative for safety decisions.
- Stale telemetry is not fresh. A disconnected rider must not participate as fresh input to separation calculations.
- Location freshness and presence are separate concepts.
- Medical disclosure remains restricted. Friendship does not grant location, medical, or ride-history access.
- Preserve room/member authorization on REST and Socket.IO paths.

## Safety-Critical Rules

`GroupCoherenceService` is backend authority for separation/reunion. Separation is nearest-neighbour distance greater than 500 m for at least 30 seconds; reunion is 300 m or less for at least 15 seconds. Preserve debounce/cooldown behaviour and deterministic midpoint/speed guidance. Never replace the predicate with centroid distance.

Crash sensing begins on mobile and continues through backend candidate/outcome handling and a rider cancellation countdown. SOS, crash, separation, reunion, presence, and weather thresholds must remain deterministic. Crash thresholds are provisional and need real-world validation before production claims.

## Authentication Rules

Registration/password login use email; display names and usernames are separate. JWT is required except explicitly public health/bootstrap paths. Do not remove login/biometric rate limits.

Biometric login uses registered server credentials and challenge/verify endpoints with the mobile biometric integration. Logout revokes the session and biometric credential. Vehicle profile persistence is `/api/users/profile`; medical information is separately scoped and disclosure-controlled.

## Ride Lifecycle

Rooms use group codes and membership validation. Preserve owner/member semantics, expiry/capacity checks, active/paused state, start/pause/resume/end controls, and reconnect/rejoin behaviour. Keep route and telemetry history for summaries: distance, duration, route history, and speed data.

## Telemetry and Presence

Android foreground/background tracking feeds telemetry. Production saves samples to native AsyncStorage before `location:update`; only positive persistence ACKs (or explicit permanent invalid rejection) remove pending data. Stable client UUIDs and room/user scope survive restarts. Historical bulk uploads are membership-authorized independently of the joined room and never update live location or trigger safety. Do not bypass coordinate, timestamp, membership, or batch validation.

Ride Summary uses device measurement time, quality filtering and route gap boundaries. Never derive speed/distance or stopped time across unknown intervals; preserve nullable metrics. Average and maximum use consistent trusted speeds. See `docs/telemetry-reliability.md` for thresholds, retry/retention policy and field tests.

Presence is connection state; freshness derives from telemetry recency. Disconnect logic retains last-known location, marks it stale, updates authorized observers, and excludes a disconnected rider from fresh safety inputs.

## Separation / Reunion Logic

Keep the backend deterministic and nearest-rider based. Thresholds are 500 m / 30 seconds for separation and 300 m / 15 seconds for reunion. TTS/UI consume backend events; neither produces safety state.

## Crash / SOS Logic

Mobile motion detection can raise a possible fall/crash, then the rider gets a cancellation countdown. Confirmed SOS is server-persisted and broadcast to the authorized group. Retain optional medical disclosure and resilient failure handling.

## Weather Safety

The weather endpoint samples current/start, destination, and bounded route points with Open-Meteo. It normalizes data and derives deterministic rain, wind/gust, visibility, thunderstorm, and temperature advisories. Provider errors must be isolated from safety traffic; partial results are valid. The app must label failed-refresh retained weather as stale.

## TTS Policy

`GuardianAngelTTS` is Android system TTS and notification-only. Persist the master Voice Alerts toggle, rate, and selected system voice.

- Deduplicate semantic keys and clear separation transition state on reunion.
- Weather has an active/clear model: announce first summary/new hazards, clear dedupe on hazard clear, and suppress stale-weather speech.
- SOS/fall is emergency priority. High-priority separation/selected weather may interrupt lower speech. Ordinary speech drops while active; V1 has no generic speech queue.
- Keep coverage aligned with ride start/end, separation/reunion, SOS/fall, breakdown/refuel, reconnect/disconnect, and weather alerts.

## Guardian Portal

Portal shares are rider-controlled private links and can be revoked. Observers receive scoped location, presence, and separation events; do not expose general rider or medical data.

| Presence | Location | UI |
| --- | --- | --- |
| `CONNECTED` | fresh | `LIVE` / Live ride |
| `CONNECTED` | stale | `ONLINE` / Online — showing last known location |
| `DISCONNECTED` | last-known | `TEMPORARILY OFFLINE` / Temporarily offline — showing last known location |
| any | ride ended | Ride ended |

Never regress to “stale location means offline.”

## AI Route Recommendations

The advisory path is active route → corridor sampling → Google Places discovery → deterministic scoring → optional DeepSeek ranking/reason → validated mobile markers. Categories are fuel, food, and workshop.

DeepSeek errors, timeouts, malformed output, or unsafe results must preserve deterministic fallback. AI must never control SOS, crash detection, separation, reunion, presence, or weather rules.

## Friends / Invitations

Friend requests, friendships, blocking, and ride invitations are supported. Preserve authorization and invitation state transitions; social relationships must not silently expand tracking, medical, or history access.

Manual joins and invitation acceptance share `RoomService.joinMembership` and mobile `handleJoinedRoomConfirm`. Acceptance consumes the invitation and establishes membership in one transaction, returns the canonical room payload, and activates the existing socket session without a second REST join. Same-room retries restore existing membership; another active room causes `ACTIVE_ROOM_CONFLICT`. An accepted invitation is not a new membership grant after leaving.

Keep `ride_rooms.group_code TEXT` nullable for legacy rows. New rooms persist the original code; recovery updates only NULL values after code/hash validation (and membership verification on reconnect). Missing codes cause `ROOM_CODE_UNAVAILABLE` before membership insertion. Do not generate replacement codes or infer a NOT NULL/unique constraint on this column.

## Backend Conventions

- Prefer services/repositories over route-handler business logic.
- Validate REST/Socket.IO input and preserve CORS, rate limits, and timeouts.
- External-provider failures must not block safety-critical paths.
- Keep schema changes additive/idempotent and update tests with contract changes.

## Mobile Conventions

- Keep telemetry resilient to offline/reconnect cases and preserve Android permission/background tracking flows.
- UI and spoken alerts consume authoritative events, not produce them.
- Use configured API URLs; release endpoints require HTTPS.

## Testing Requirements

```bash
cd mobile && npx tsc --noEmit && npm test -- --runInBand
cd backend && npx tsc --noEmit && npm test -- --runInBand
cd guardian-portal && npm run build && npm test
```

Run affected package typechecks/tests at minimum. Do not state test totals without rerunning them.

## Git / Branch Rules

Current V1 is `integration/all-features` at `8e997d31575bd52ae79d2f4616ea806f289613d0`, following `main` → `integration/full-merge` → `integration/all-features`. Preserve unrelated changes, do not commit secrets, and never rewrite history without explicit authorization. See [docs/git-branch-history-report.md](docs/git-branch-history-report.md).

## Known Limitations

- Android is the primary tested platform; background GPS/audio routing need physical-device/OEM validation.
- Network quality affects live telemetry and Portal updates.
- Crash thresholds are not real-world validated.
- Nearest-neighbour separation does not detect every subgroup topology.

## V2 / Deferred Features

Do not present these as V1: rider-to-rider voice communication/push-to-talk, a richer generic TTS queue, road-aware subgroup graph separation and advanced regroup optimization, or broader fully tested platform support.
