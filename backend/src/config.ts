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

export const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';
export const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
export const ROUTE_RECOMMENDATION = Object.freeze({
  corridorMeters: 2_000,
  maximumCorridorMeters: 3_500,
  searchPointIntervalMeters: 8_000,
  fuelIntervalMeters: 5_000,
  maximumRouteMeters: 1_000_000,
  maximumPolylineCharacters: 20_000,
  maximumSearchPoints: 20,
  maximumCandidatesPerCategory: 10,
  maximumResultsPerCategory: 6,
  cacheTtlMs: 15 * 60 * 1_000,
  maximumCacheEntries: 500,
  providerTimeoutMs: 5_000,
  deepSeekTimeoutMs: 6_000,
  distanceNormalizationMeters: 2_000,
  reviewLogNormalizationMaximum: 5,
  weights: Object.freeze({ distance: 0.45, rating: 0.35, reviews: 0.20 }),
});
