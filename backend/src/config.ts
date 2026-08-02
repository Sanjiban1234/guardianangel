import dotenv from 'dotenv';

dotenv.config();

const configuredJwtSecret = process.env.JWT_SECRET;

if (!configuredJwtSecret && process.env.NODE_ENV !== 'test') {
  throw new Error('FATAL: JWT_SECRET environment variable is required');
}

const fallbackJwtSecret = configuredJwtSecret || 'super_secret_jwt_key_change_me_in_production';

export const JWT_SECRET = fallbackJwtSecret;
export const JWT_ISSUER = process.env.JWT_ISSUER || 'guardian-angel';
export const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'guardian-angel-api';
export const PORT = Number(process.env.PORT || 3000);
export const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
export const MAX_BODY_SIZE = process.env.MAX_BODY_SIZE || '10kb';
export const MAX_BULK_BATCH = Number(process.env.MAX_BULK_BATCH || 500);
