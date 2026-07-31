# Guardian Angel — Security & Architecture Audit: Flaws and Remediation

Generated from the automated audit suite (`.claude/skills/audit-guardianangel/`).
Run `bash .claude/skills/audit-guardianangel/driver.sh` to reproduce all findings.

---

## Critical

### 1. Hardcoded JWT Secret Fallback

**Flaw:** `src/middleware/auth.ts` and `src/routes/auth.ts` both fall back to
`'super_secret_jwt_key_change_me_in_production'` when `JWT_SECRET` is unset.
An attacker who reads the source code can forge valid tokens.

**Fix:**
- Remove the fallback entirely. If `JWT_SECRET` is missing, crash on startup with a clear error.
- Use a cryptographically random 256-bit secret in production (e.g. `openssl rand -base64 32`).

```typescript
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is required');
}
```

---

## High

### 2. No Rate Limiting on Authentication Endpoints

**Flaw:** `/api/auth/login` and `/api/auth/register` process unlimited requests.
An attacker can brute-force credentials at full network speed.

**Fix:**
- Add `express-rate-limit` middleware scoped to auth routes.
- Recommended: 5 login attempts per IP per 15 minutes, 3 registration attempts per IP per hour.

```typescript
import rateLimit from 'express-rate-limit';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' }
});

app.use('/api/auth/login', loginLimiter);
```

### 3. CORS Wildcard Origin

**Flaw:** Socket.io server is configured with `origin: '*'`, allowing any website
to make authenticated cross-origin requests if a user's browser holds a valid token.

**Fix:**
- Restrict to known frontend origins via environment variable.

```typescript
const io = new Server(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
    methods: ['GET', 'POST']
  }
});
```

---

## Medium

### 4. No Password Complexity Validation

**Flaw:** Registration accepts single-character passwords. Users can set trivially guessable credentials.

**Fix:**
- Enforce minimum 8 characters with at least one number and one letter.

```typescript
if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
  return res.status(400).json({ error: 'Password must be at least 8 characters with letters and numbers' });
}
```

### 5. No Input Length Limits

**Flaw:** Oversized payloads (100KB+ usernames) are processed without rejection.
The DB's `VARCHAR(50)` will reject them, but the server still burns CPU on bcrypt hashing
the oversized input before that happens.

**Fix:**
- Add express body-parser size limit and field-level length checks.

```typescript
app.use(express.json({ limit: '10kb' }));

// In register route:
if (username.length > 50 || password.length > 128 || phone.length > 20) {
  return res.status(400).json({ error: 'Input exceeds maximum length' });
}
```

### 6. Room Token Keyspace Too Small

**Flaw:** Room tokens are 6 hex characters (3 bytes = 16,777,216 possible values).
At 100 requests/second, the entire space is enumerable in ~46 hours.

**Fix:**
- Increase to 8 bytes (16 hex chars = 4.3 billion combinations).
- Add rate limiting on the `/api/rooms/join` endpoint.

```typescript
function generateRoomToken(): string {
  return crypto.randomBytes(8).toString('hex').toUpperCase();
}
```

### 7. No JWT Issuer/Audience Claims

**Flaw:** Tokens have no `iss` or `aud` claims. If another service shares the same
signing secret, its tokens are accepted here (and vice versa).

**Fix:**
- Add issuer and audience when signing and verify them on decode.

```typescript
const token = jwt.sign(
  { id: user.id, username: user.username },
  JWT_SECRET,
  { expiresIn: '24h', issuer: 'guardian-angel', audience: 'guardian-angel-api' }
);

// In verify:
jwt.verify(token, JWT_SECRET, { issuer: 'guardian-angel', audience: 'guardian-angel-api' }, callback);
```

### 8. No Bulk Sync Batch Size Limit

**Flaw:** The `telemetry:bulkSync` socket event accepts arbitrarily large arrays.
A malicious client can send millions of readings, exhausting server memory and
hammering the database.

**Fix:**
- Cap batch size at a reasonable limit (e.g. 500 readings per sync).

```typescript
const MAX_BULK_BATCH = 500;

if (data.readings.length > MAX_BULK_BATCH) {
  socket.emit('error', { message: `Batch too large. Maximum ${MAX_BULK_BATCH} readings per sync.` });
  return;
}
```

### 9. No Structured Audit Logging

**Flaw:** Security events (failed logins, token rejections, forbidden access) are only
logged to `console.error` with no persistence or structure. In production, there is no
way to investigate a breach after the fact.

**Fix:**
- Add a structured logger (e.g. `pino` or `winston`) with JSON output.
- Log security events with severity, user ID, IP, and timestamp.
- In production, ship logs to a persistent store (CloudWatch, Datadog, etc.).

```typescript
import pino from 'pino';
const logger = pino({ level: 'info' });

// On failed login:
logger.warn({ event: 'auth_failure', username, ip: req.ip }, 'Failed login attempt');
```

### 10. No Graceful Shutdown Handler

**Flaw:** The server has no `SIGTERM`/`SIGINT` handler. In containerized deployments
(Docker, K8s), the process is killed mid-flight, potentially losing in-progress
bulk sync operations.

**Fix:**

```typescript
const shutdown = async () => {
  console.log('Shutting down gracefully...');
  io.close();
  server.close(() => {
    pool.end().then(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10000); // Force exit after 10s
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

### 11. Duplicated JWT_SECRET References

**Flaw:** `src/middleware/auth.ts` and `src/routes/auth.ts` both independently read
`process.env.JWT_SECRET` with the same fallback. If one is updated and the other isn't,
tokens signed by one module won't verify in the other.

**Fix:**
- Create a single `src/config.ts` that exports all shared configuration.

```typescript
// src/config.ts
export const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET is required');
export const PORT = process.env.PORT || 3000;
```

---

## Low

### 12. No Telemetry Coordinate Bounds Validation

**Flaw:** `location:update` accepts latitude=999, longitude=-999, negative speed/accuracy.
Invalid data is stored and broadcast to other riders.

**Fix:**

```typescript
if (reading.latitude < -90 || reading.latitude > 90 ||
    reading.longitude < -180 || reading.longitude > 180 ||
    reading.speed < 0 || reading.accuracy < 0) {
  socket.emit('error', { message: 'Invalid coordinate values' });
  return;
}
```

### 13. No Timestamp Bounds Validation

**Flaw:** Telemetry readings accept timestamps from the year 3000 or negative values.

**Fix:**
- Reject timestamps more than 5 minutes in the future or before a reasonable epoch.

```typescript
const now = Date.now();
if (reading.timestamp > now + 300000 || reading.timestamp < 1600000000000) {
  socket.emit('error', { message: 'Invalid timestamp' });
  return;
}
```

### 14. No Phone Number Format Validation

**Flaw:** Registration accepts any string as a phone number (e.g. `"not-a-phone!!!"`).

**Fix:**
- Validate against E.164 format or at minimum require digits only with length check.

```typescript
const phoneRegex = /^\+?[1-9]\d{7,14}$/;
if (!phoneRegex.test(phone)) {
  return res.status(400).json({ error: 'Invalid phone number format' });
}
```

### 15. No UUID Format Validation on Route Params

**Flaw:** `/api/rooms/:roomId/history` passes arbitrary strings to SQL queries.
While parameterized queries prevent injection, invalid UUIDs waste a DB round-trip.

**Fix:**

```typescript
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!UUID_REGEX.test(roomId)) {
  return res.status(400).json({ error: 'Invalid room ID format' });
}
```

---

## Informational

### 16. SQL Injection Strings Reach Query Layer

**Observation:** The application passes unsanitized user input directly to the `query()`
function. This is **not exploitable** because the `pg` driver uses parameterized queries
(`$1`, `$2`) which escape all values server-side. However, defense-in-depth suggests
adding input sanitization as an additional layer.

**Recommendation:** No immediate action required. The parameterized query pattern is the
correct defense. Optionally add input validation (alphanumeric usernames, etc.) to reject
obviously malicious inputs early.

---

## Implementation Priority

| Priority | Items | Effort |
|----------|-------|--------|
| Do first | #1 (JWT secret), #2 (rate limit), #3 (CORS) | 1-2 hours |
| Do next | #4 (password), #5 (input limits), #8 (batch limit) | 1-2 hours |
| Plan for | #6 (token size), #7 (JWT claims), #9 (logging), #10 (shutdown) | 3-4 hours |
| Backlog | #11-15 (validation, config) | 2-3 hours |

Total estimated effort: ~1 day of focused work to address all 16 findings.
