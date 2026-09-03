# Guardian Angel

Guardian Angel is a group motorcycle-ride safety platform for live coordination, separation detection, emergency response, route awareness, and private guardian observation.

This documents the current V1 system. Safety state is deterministic and service-backed; AI and voice output assist riders but never decide safety state.

## Features

### Account and Rider Profile

- Email/password registration and login, plus biometric credential login on supported devices.
- Display name, unique username, persisted vehicle profile, and voluntary medical/emergency information.
- Medical information is disclosed in emergency payloads only according to rider-configured choices.

### Group Ride Rooms and Live Map

- Create or join rooms with a group code, owner/member roles, capacity and expiry checks.
- Start, pause, resume, end, reconnect, and rejoin flows.
- Live rider markers, route/destination, last-known locations, live statistics, and post-ride distance, duration, route history, and speed information.

### Location and Telemetry

- Android foreground/background tracking, Socket.IO telemetry, local offline buffering, bulk re-sync, and reconnect handling.
- Backend presence is distinct from last-known location freshness.

### Separation and Reunion Safety

The backend is authoritative. Separation is nearest-other-rider distance above **500 m** for at least **30 seconds**; reunion is **300 m or less** for at least **15 seconds**. The deterministic service provides midpoint guidance and capped speed recommendations, with TTS alerts.

### Crash, SOS, and Vehicle Assistance

- Motion-based possible fall/crash detection, a 15-second cancellation countdown, and SOS broadcast with location.
- Applicable alerts can include optional medical snapshot, rider identity, and vehicle information.
- Breakdown report/resolve and fuel/refuel notifications for the group.

### Weather Safety

Open-Meteo supplies current, destination, and sampled-route conditions. The backend produces deterministic heavy-rain, wind/gust, low-visibility, thunderstorm, and extreme-temperature advisories. Partial failures are isolated; retained weather is labelled stale rather than current.

### Voice Alerts

Android system TTS announces ride start/end, separation/reunion, possible falls and SOS, breakdown/refuel, disconnect/reconnect, weather summaries, and newly active severe weather alerts. Rider Profile contains a Voice Alerts toggle, system voice selection, and speech-rate selection. Speech uses semantic deduplication and emergency/high-priority interruption.

### Friends, Invitations, and AI Recommendations

Friend requests, friendships, blocking, and ride invitations are implemented. Friendship alone does not grant location, medical, or ride-history access.

For an active route, the backend samples a corridor, finds Google Places candidates for fuel, food, or workshops, scores them deterministically, and may add an optional DeepSeek ranking/reason. Only validated markers are returned; deterministic recommendations remain when DeepSeek fails. AI is advisory only and does not decide separation, reunion, SOS, crash detection, presence, or weather thresholds.

### Guardian Portal

Riders can create and revoke private live-share links. The browser observer uses Google Maps and a dedicated Socket.IO namespace with sanitized observer credentials.

| State | Portal display |
| --- | --- |
| Connected + fresh location | Live ride |
| Connected + stale location | Online — showing last known location |
| Disconnected | Temporarily offline — showing last known location |
| Ride ended | Ride ended |

Location freshness is deliberately separate from presence: a stale location does not mean the rider is offline.

## Architecture

```text
React Native mobile app
        | REST + Socket.IO
        v
Node.js / Express / Socket.IO backend
        |-- PostgreSQL + PostGIS
        |-- Open-Meteo
        |-- Google Places
        |-- DeepSeek (optional ranking)
        `-- Guardian Portal Socket.IO --> Vite Guardian Portal
```

Mobile uses React Native and TypeScript; backend uses Node.js, TypeScript, Express, and Socket.IO; the database is PostgreSQL/PostGIS; the Portal is Vite/React. Deployment configuration targets Railway for the backend and Vercel for the Portal: <https://guardian-angel-portal.vercel.app>.

### Data flows

```text
Android location service -> mobile -> Socket.IO location:update
-> backend telemetry/presence -> riders and Guardian Portal

Route/current location -> weather endpoint -> Open-Meteo
-> normalized advisories -> visual alert + TTS

Active route -> recommendation endpoint -> corridor -> Google Places
-> deterministic score -> optional DeepSeek rank -> mobile markers
```

## Safety design

Safety-critical state is deterministic. AI cannot override separation, reunion, SOS, crash detection, presence, or weather safety rules. TTS is a downstream notification layer only.

## Project structure

```text
guardianangel/
├── backend/          Express, Socket.IO, services, repositories, PostGIS access
├── mobile/           React Native rider application
├── guardian-portal/  Vite/React observer application
├── contracts/        Shared TypeScript contracts
├── docs/             Engineering and Git-history documents
├── railway.json      Backend deployment configuration
└── README.md
```

## Setup

Install dependencies in each package. The mobile package specifies Node 22.11+.

```bash
cd backend && npm ci && npm run dev
cd mobile && npm ci && npm run android
cd guardian-portal && npm ci && npm run dev
```

The backend requires PostgreSQL with PostGIS. Use `npm install` if a lockfile-based install is unsuitable. Do not commit environment files or secrets.

### Environment variable names

| Component | Variables |
| --- | --- |
| Backend | `DATABASE_URL`, `JWT_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE`, `PORT`, `ALLOWED_ORIGINS`, `MAX_BODY_SIZE`, `MAX_BULK_BATCH`, `SOCKET_MAX_HTTP_BUFFER_SIZE`, `TRUST_PROXY`, `GUARDIAN_PORTAL_BASE_URL`, `GUARDIAN_PORTAL_ALLOWED_ORIGIN`, `GUARDIAN_PORTAL_OBSERVER_SECRET`, `GOOGLE_PLACES_API_KEY`, `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` |
| Mobile | `API_BASE_URL`, `GOOGLE_MAPS_API_KEY` |
| Portal | `VITE_API_BASE_URL`, `VITE_GOOGLE_MAPS_API_KEY` |

Release `API_BASE_URL` values must use HTTPS. The server-only Places key is separate from the mobile Maps key.

## Validation

```bash
cd mobile && npx tsc --noEmit && npm test -- --runInBand
cd backend && npx tsc --noEmit && npm test -- --runInBand
cd guardian-portal && npm run build && npm test
```

Exact test totals are not hard-coded because suites evolve.

## Deployment and V1 boundaries

- Backend: Railway (`railway.json`); Portal: Vercel at <https://guardian-angel-portal.vercel.app>.
- Android release APK work is under `mobile/android`; signing credentials are not documented here.
- Android is the primary tested platform. Device/OEM background GPS and Bluetooth/audio routing require physical-device testing.
- Crash thresholds are provisional and need real-world validation before production safety claims.
- V1 has no rider-to-rider voice communication. Nearest-neighbour separation does not model every subgroup split, and network quality affects live telemetry.

## Git history

V1 follows `main` → `integration/full-merge` → `integration/all-features`, with integrated feature branches. See the [Git branch history report](docs/git-branch-history-report.md) and [interactive history visualization](docs/git-branch-history-visualization.html).

## Engineering guide

See [CLAUDE.md](CLAUDE.md) for safe implementation rules and invariants.

## License

MIT License.
