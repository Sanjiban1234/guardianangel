import dotenv from 'dotenv';

dotenv.config();

const configuredJwtSecret = process.env.JWT_SECRET;

if (!configuredJwtSecret) {
  throw new Error('FATAL: JWT_SECRET environment variable is required');
}

export const JWT_SECRET = configuredJwtSecret;
export const JWT_ISSUER = process.env.JWT_ISSUER || 'guardian-angel';
export const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'guardian-angel-api';
export const PORT = Number(process.env.PORT || 3000);
export const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
export const MAX_BODY_SIZE = process.env.MAX_BODY_SIZE || '10kb';
const configuredMaxBulkBatch = Number(process.env.MAX_BULK_BATCH || 300);
// A full telemetry reading is roughly 150 bytes on the wire. Keep an entire
// batch comfortably below Socket.IO's 64 KiB transport cap.
export const MAX_BULK_BATCH = Number.isFinite(configuredMaxBulkBatch) && configuredMaxBulkBatch > 0
  ? Math.min(Math.floor(configuredMaxBulkBatch), 300)
  : 300;
export const SOCKET_MAX_HTTP_BUFFER_SIZE = Number(process.env.SOCKET_MAX_HTTP_BUFFER_SIZE || 64 * 1024);
export const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
export const GUARDIAN_PORTAL_BASE_URL = (process.env.GUARDIAN_PORTAL_BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
export const GUARDIAN_PORTAL_ALLOWED_ORIGIN = process.env.GUARDIAN_PORTAL_ALLOWED_ORIGIN || 'http://localhost:5173';
export const GUARDIAN_PORTAL_SHARE_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const GUARDIAN_PORTAL_OBSERVER_SECRET = process.env.GUARDIAN_PORTAL_OBSERVER_SECRET || JWT_SECRET;
export const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';
export const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
export const ROUTE_RECOMMENDATION = Object.freeze({ corridorMeters: 2_000, maximumRoutePoints: 500, maximumRouteMeters: 1_000_000, maximumCandidates: 10, maximumResults: 6, cacheTtlMs: 15 * 60_000, maximumCacheEntries: 500, providerTimeoutMs: 5_000, deepSeekTimeoutMs: 6_000 });
