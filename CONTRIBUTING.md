# Contributing

## Branch workflow
1. Clone `main`, create your own branch: `git checkout -b <name>/<module>`
   e.g. `pratyush/telemetry`, `sanjiban/backend`.
2. Commit small, commit often.
3. Open a PR into `main` every few days - not once at the end.
4. At least one teammate reviews before merge (interface match, no breakage -
   not a deep audit).
5. You merge your own PR once approved.
6. Pull `main` into your branch regularly so you're not stale.

## Module ownership
- Utsuk: mobile/src/telemetry - GPS, online/offline switch, SQLite cache
  (react-native-sqlite-storage)
- Pratyush: mobile/src/safety - crash detection, countdown, override
- Sanjiban: backend/ - sessions, sockets, DB (PostgreSQL), security
- Radium: mobile/src/ui - six screens, weather integration

## Mobile app scaffold
`mobile/` is a single React Native project - one `package.json`, one
`android/`, one `ios/`. Only one `react-native init` run, ever. Whoever sets
it up first pushes it to `main` before others branch off `mobile/`. Adding a
dependency to `mobile/package.json` affects everyone's build - flag it in
the group chat before merging.

## Shared contract rule
Changes to `contracts/websocket-events.md` must be flagged to the team
BEFORE merging, not silently updated. This file is the single source of
truth three modules depend on.

## Before merging any module
- Short README in your module folder: what it exposes, what it expects,
  what mock data you tested against.
- Passing unit tests using mocked inputs from other modules.
- A working demo against mocks (not just "it compiles").
