/**
 * Single source of truth for mobile backend API URL.
 *
 * Target resolution:
 * 1. process.env.API_BASE_URL (injected at build time from mobile/.env)
 * 2. Default fallback: https://joyful-growth-production.up.railway.app
 */
export function getApiBaseUrl(): string {
  const envUrl = typeof process !== 'undefined' && process.env ? process.env.API_BASE_URL : undefined;

  if (envUrl && typeof envUrl === 'string' && envUrl.trim().length > 0) {
    const url = envUrl.trim().replace(/\/+$/, '');

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      throw new Error(
        `[ENV] API_BASE_URL is missing protocol: "${url}". ` +
        `Value must start with http:// or https://. ` +
        `Fix your .env file: e.g. API_BASE_URL=https://joyful-growth-production.up.railway.app`
      );
    }
    if (url.startsWith('http://') && !__DEV__) {
      throw new Error('[ENV] Release builds require an HTTPS API_BASE_URL.');
    }

    return url;
  }

  return 'https://joyful-growth-production.up.railway.app';
}

export const API_BASE_URL = getApiBaseUrl();
