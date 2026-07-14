# Guardian Angel

Group-ride safety app for motorcyclists - crash detection, live group
tracking, offline resilience. Minor project, ENCT-654, Tribhuvan University.

## Structure
- `mobile/` - React Native app, TypeScript, bare CLI (telemetry, crash detection, UI)
- `backend/` - Node.js/Express + Socket.io (sessions, sync)
- `contracts/` - shared WebSocket event contract (read before touching sockets)
- `docs/` - architecture, ER diagram, SRS mapping

## Setup
See CONTRIBUTING.md for branch workflow and module ownership.
