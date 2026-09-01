# Guardian Angel Security Audit Report

**Date:** 24 August 2026  
**Scope:** Static review of the React Native client, Express/Socket.IO API, PostgreSQL/PostGIS schema, deployment and Android/iOS configuration. Dependency manifests were checked with `npm audit`. This was not a live penetration test, source-code secret scan outside the repository, infrastructure review, or mobile binary assessment.

## Executive summary

Guardian Angel is a group-riding safety application. Riders create or join a code-protected room, share live location and telemetry, receive group-separation/weather information, and can report a crash, vehicle breakdown, or refuel request. The backend persists ride data in PostgreSQL/PostGIS, sends real-time events through Socket.IO, and has tables/endpoints for medical information and device tokens.

The code has a sound baseline in several important areas: passwords use bcrypt, SQL queries are parameterized, REST and Socket.IO connections require JWTs, room history is membership-gated, room codes are generated from six cryptographically random bytes, Android/iOS default to HTTPS, and administrative geofence changes require an admin role.

It is **not ready for a production safety service without remediation**. The most consequential risks are plaintext password persistence on the device, login protection that is disabled in normal deployments, database TLS that accepts any certificate in production, unbounded authenticated Socket.IO writes, and unauthenticated-by-validation crash/SOS input. These directly affect account compromise, emergency-signal integrity, availability, and sensitive location/medical data.

| Severity | Count | Primary themes |
|---|---:|---|
| Critical | 1 | Plaintext device password storage |
| High | 5 | Credential stuffing, database TLS, SOS integrity, Socket.IO DoS, vulnerable production dependencies |
| Medium | 5 | Sensitive logs, medical-data disclosure design, token lifetime/legacy JWT acceptance, weak mobile release hardening, insufficient field validation |
| Low | 3 | Room-operation state bypass, duplicate database pools, incomplete automated coverage |

Severity reflects the likely impact in this application's threat model, not merely a code smell.

## Confirmed findings

### GA-01 — Critical: biometric login stores the account password in AsyncStorage

**Evidence:** `mobile/src/ui/utils/SecureStore.ts` writes `BIOMETRIC_PASSWORD` to `@react-native-async-storage/async-storage` and `getBiometricCredentials()` returns it after only caller-enforced prompting.

AsyncStorage is application storage, not a keystore-backed secret vault. Android file-based encryption is not an application-level encryption or biometric-access control guarantee. A rooted device, malicious local code, backup/configuration mistake, or compromised app process can recover a reusable password. The helper’s name and comments overstate its protection, and any future caller can read the password without enforcing biometrics.

**Remediation:** Do not store passwords. Use `react-native-keychain` (or platform Keychain/Keystore) with `accessControl`/user-presence protection to store a refresh token, or preferably use a biometric-bound cryptographic key to authenticate a server-side challenge. Add token rotation, device revocation, and tests that assert no password is persisted.

### GA-02 — High: login rate limiting is disabled outside a specially enabled test

**Evidence:** `backend/src/routes/AuthRouter.ts` defines the five-attempt limiter but `authLimiter` calls it only when `ENABLE_AUTH_RATE_LIMIT_TEST === 'true'`; all normal environments call `next()`.

An attacker can make unlimited password guesses and credential-stuffing attempts. bcrypt slows individual guesses but does not replace distributed throttling or account/IP controls.

**Remediation:** Apply the limiter by default in production, key it on a carefully configured client IP plus normalized email/account, honor trusted proxies only after explicit configuration, and add progressive delays/account lock safeguards and monitoring. Keep any test bypass strictly test-only and fail closed for production.

### GA-03 — High: production PostgreSQL TLS disables certificate validation

**Evidence:** `backend/src/db.ts` and `backend/src/db/DatabasePool.ts` set `ssl: { rejectUnauthorized: false }` when `NODE_ENV === 'production'`.

The API can accept a forged database certificate, enabling a network attacker with a suitable position to intercept or alter user, location, medical, and password-hash data.

**Remediation:** Require certificate verification (`rejectUnauthorized: true`) and provide the deployment CA through a secret/configured trust store. Do not silently downgrade validation; fail startup if production TLS materials are absent.

### GA-04 — High: crash/SOS events trust arbitrary client location and time

**Evidence:** `backend/src/handlers/CrashHandler.ts` persists and broadcasts `crash:candidate` and `crash:countdownExpired` values without type, range, freshness, membership-state, or plausibility validation. The countdown-expired path has no event rate limit. It deliberately ignores supplied `user_id`, which is correct, but accepts caller-controlled coordinates and timestamps.

Any authenticated rider in a room can forge an SOS at an arbitrary location or generate repeated alerts. For a safety product this is both an integrity and operational-safety issue. The same fundamental limitation applies to location telemetry: the server validates ranges but cannot establish that GPS/sensor data is genuine.

**Remediation:** Validate finite coordinates, timestamps, bounds, event sequencing, active ride state, and rate-limit all crash event types. Cross-check the claimed crash position/time against the user's latest server-recorded telemetry and reject implausible deviations. Make alerts idempotent and require an explicit resolution workflow. Treat device attestation/root/jailbreak signals and sensor anti-spoofing as defence-in-depth, not proof.

### GA-05 — High: Socket.IO payload/message rates are not constrained

**Evidence:** `backend/src/index.ts` creates Socket.IO without a `maxHttpBufferSize` or connection throttles. `LocationHandler` writes every valid `location:update` to the database and runs group-coherence evaluation; `BulkSyncHandler` caps a batch at 500 but imposes no rate/frequency limit; most event types have no limit.

An authenticated account can rapidly send small valid events, causing database writes, broadcasts, CPU work, and log growth. Socket.IO 4.8.3 resolves the specifically flagged parser vulnerability below, but it does not provide the application-level quotas required here.

**Remediation:** Set a conservative Socket.IO payload limit, enforce per-user/per-IP connection and event token-bucket limits, coalesce location updates, queue and cap expensive coherence work, and monitor/reject abusive sessions. Put API/WebSocket traffic behind a reverse proxy/WAF with request and connection limits.

### GA-06 — High: dependency audit reports vulnerable backend production packages

**Evidence:** `npm audit --package-lock-only --omit=dev` in `backend` reports four high-severity entries. Installed versions include `socket.io@4.8.3` → `socket.io-parser@4.2.6`, which is in the advisory range for zero-attachment memory exhaustion (`<4.2.7`); and `express-rate-limit@8.5.2` → `ip-address@10.2.0`, which is in reported trust-boundary/SSRF parsing ranges.

**Remediation:** Upgrade/override to patched dependency chains (at minimum `socket.io-parser >= 4.2.7` and a non-affected `ip-address` release compatible with express-rate-limit), regenerate the lockfile, and make a production dependency audit a CI release gate. Re-run audit after every update; the report reflects the audit database available on the review date.

### GA-07 — Medium: logs expose live precise location, identity, room code, and diagnostic details

**Evidence:** `RideSocketController.ts`, `LocationHandler.ts`, `DisconnectHandler.ts`, `VehicleBreakdownHandler.ts`, and `mobile/src/telemetry/socket/SocketClient.ts` use `console.log` for user IDs/names, socket IDs, group codes, latitude and longitude. Some error paths print raw error objects.

These records are sensitive location data. Broadly accessible platform logs, device logs, support bundles, or log aggregators can turn routine observability into a privacy breach.

**Remediation:** Remove verbose production diagnostics; use structured logging with redaction, short retention, access controls, and a documented purpose. Do not log precise coordinates, JWTs, passwords, device tokens, group codes, or medical details. Add a log-scrubbing test/lint rule.

### GA-08 — Medium: medical data is shared automatically with every active room member during incidents

**Evidence:** `CrashHandler.ts` and `VehicleBreakdownHandler.ts` attach `getMedicalInfoSnapshot()`—blood group, allergies, emergency-contact name/phone, and notes—to broadcasts sent to all sockets in `group:<code>`.

Membership authorizes the sockets technically, but this is sensitive health and contact data. The code has no granular consent flag, recipient/guardian role restriction, minimization by incident type, audit trail, or retention/deletion policy. It may be inappropriate for local privacy/health-data obligations.

**Remediation:** Make emergency sharing explicit, informed, and revocable; share the minimum needed data only to designated recipients/responders, not all riders by default. Record access/audit events, encrypt sensitive database backups, define retention/deletion, and conduct a privacy/legal review appropriate to deployment geography.

### GA-09 — Medium: JWT compatibility fallback weakens token policy and revocation is absent

**Evidence:** `backend/src/middleware/AuthMiddleware.ts` first verifies issuer/audience then falls back to verifying the same token without either claim. `UserService.ts` issues a single 24-hour bearer token; there is no refresh-token, logout revocation, device/session list, or key rotation mechanism.

The fallback accepts any correctly signed legacy token regardless of issuer/audience. A stolen token remains valid for up to 24 hours and cannot be selectively revoked.

**Remediation:** Retire legacy tokens on a defined migration date; then enforce issuer, audience, algorithm allow-list, `exp`, and unique token ID on every request/socket. Use short-lived access tokens with rotated, securely stored refresh tokens and server-side revocation/device management. Rotate JWT signing keys and expose a documented incident procedure.

### GA-10 — Medium: mobile release hardening is disabled or unsafe by default

**Evidence:** `mobile/android/app/build.gradle` sets `enableProguardInReleaseBuilds = false` and falls back to the public Android debug signing key when release signing material is missing. `mobile/src/config/env.ts` accepts a build-time `http://` `API_BASE_URL` without rejecting it for release.

This raises reverse-engineering/tampering exposure and risks distributing a debug-signed release. The manifest's HTTPS default and cleartext configuration are positive controls, but release build failure should be mandatory rather than fallback.

**Remediation:** Enable R8/ProGuard with tested rules, require release signing configuration and abort release builds without it, and enforce HTTPS-only production API URLs at build and runtime. Ensure the Maps key is application-restricted by package name and signing certificate in Google Cloud.

### GA-11 — Medium: medical/profile/device input validation is incomplete

**Evidence:** `MedicalInfoService.ts` calls `.trim()` on `allergies`, contact name/phone, and notes without first requiring strings and has no length bounds for text fields. `DeviceRouter.ts` accepts any non-empty device token with no maximum size. `VehicleBreakdownService.ts` accepts `note` as text without a limit (the API body cap limits REST, but this arrives via Socket.IO).

Malformed objects can yield server errors and overly long values can cause storage, notification, or logging problems.

**Remediation:** Validate complete schemas at each REST and Socket.IO boundary: type, finite number, string length, normalized content, and allowed fields. Reject unknown fields and return stable 4xx errors. Use shared schemas/contracts and fuzz/property tests.

### GA-12 — Low: refill request does not require the socket to be joined to the room

**Evidence:** `RefillNotificationHandler.ts` takes `data.group_code` instead of `roomState.currentGroupCode`. `RefillNotificationService.ts` checks historical active membership, so it prevents an unrelated account but lets a member notify an active group from a socket that never joined that session.

**Remediation:** Derive the group from `roomState`, require it to match the event payload if one is retained, and apply rate limits/idempotency to notifications.

### GA-13 — Low: database lifecycle owns two independent pools but closes one

**Evidence:** `backend/src/db.ts` uses both `DatabasePool` (`_dbPool`, used by `query` and schema initialization) and a separately constructed exported `Pool` (used by the telemetry repository). Shutdown only calls `pool.end()`.

The first pool can retain connections during shutdown and creates operational ambiguity.

**Remediation:** Use one injected pool instance throughout the application and close it once during graceful shutdown. Add a shutdown/integration test that detects remaining handles.

### GA-14 — Low: test coverage is substantial but the mobile configuration suite fails

**Evidence:** `npm test -- --runInBand --silent` in `mobile` reported 16 passing suites / 77 tests, but `src/config/__tests__/env.test.ts` failed during Babel transformation: its replacement plugin tries to replace `process.env.API_BASE_URL` when it is an assignment target. The backend test suite passed 18 suites / 151 tests.

**Remediation:** Fix the Babel plugin to replace only read expressions, then test release builds, TLS-only endpoint validation, credential storage, login throttling, socket abuse limits, malformed event data, authorization at every event boundary, and dependency-audit gating.

## Security testing performed

| Test | Result |
|---|---|
| Manual static data-flow and authorization review | Completed for REST routes, socket handlers, persistence/services, mobile credential/configuration paths, and platform deployment files. |
| Backend automated tests | Passed: 18 suites, 151 tests. |
| Mobile automated tests | Partially passed: 16 suites, 77 tests; 1 suite failed before execution as described in GA-14. |
| Backend production dependency audit | 4 high-severity entries; see GA-06. |
| Mobile dependency audit | 35 entries (30 high, 5 moderate) across the React Native/Metro/Jest dependency graph. Many are development/build-chain transitive dependencies; triage against the shipped release artifact and upgrade the React Native toolchain. |
| Dynamic penetration test, DB/cloud configuration test, binary/mobile device test | Not performed; require a safe deployed environment and explicit test authorization. |

## Prioritized remediation plan

1. **Before any production use:** fix GA-01, GA-02, GA-03, GA-04, GA-05, and GA-06; rotate JWT/database credentials if they have been used in an exposed environment.
2. **Next release:** fix GA-07 through GA-11; add privacy consent, data-retention, monitoring, and incident-response controls.
3. **Engineering hardening:** fix GA-12 through GA-14; enforce CI for tests, lint, lockfile audit, secret scanning, and release signing.

## Positive controls observed

- Passwords are hashed using bcrypt; plaintext hashes are not returned by registration/login APIs.
- API and Socket.IO authentication both verify JWT signatures; room REST history/summary access checks membership.
- SQL statements use parameter placeholders rather than interpolating request values.
- Room codes use `crypto.randomBytes(6)` and database stores a SHA-256 hash rather than the code itself.
- Geofence write/delete operations are authenticated and restricted to `admin`.
- Android disallows backups, and Android/iOS network policy defaults to HTTPS.
- Request JSON bodies are capped at 10 KB; telemetry coordinate/speed/time ranges and bulk batch size have some validation.

## Scope limitations

This report records code-evidenced conditions as of the stated date. It does not prove exploitability in a particular hosted environment, assess secrets held in CI/cloud dashboards, verify OS/runtime patch levels, review legal compliance, or replace an independent penetration test. Safety detection thresholds should also be validated through controlled real-world testing before being relied on for emergency response.
