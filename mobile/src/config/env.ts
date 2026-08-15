import { Platform } from 'react-native';

/**
 * Single source of truth for mobile backend API URL.
 *
 * Target resolution:
 * 1. process.env.API_BASE_URL (configured via mobile/.env or shell env variable)
 *    - Physical device over Wi-Fi/LAN: e.g. http://192.168.1.100:3000
 *    - Android emulator: http://10.0.2.2:3000
 * 2. Default fallback when not specified:
 *    - Android (emulator / default): http://10.0.2.2:3000
 *    - iOS simulator / other: http://localhost:3000
 */
export function getApiBaseUrl(): string {
  console.log('[ENV] Platform.OS:', Platform.OS);
  const envUrl = typeof process !== 'undefined' && process.env ? process.env.API_BASE_URL : undefined;
  console.log('[ENV] process.env.API_BASE_URL:', envUrl);

  if (envUrl && typeof envUrl === 'string' && envUrl.trim().length > 0) {
    console.log('[ENV] Using env variable:', envUrl.trim().replace(/\/+$/, ''));
    return envUrl.trim().replace(/\/+$/, '');
  }

  // Default: Android emulator uses 10.0.2.2 to reach host machine
  if (Platform.OS === 'android') {
    console.log('[ENV] Detected Android, using 10.0.2.2');
    return 'http://10.0.2.2:3000';
  }
  console.log('[ENV] Not Android, using localhost');
  return 'http://localhost:3000';
}

export const API_BASE_URL = getApiBaseUrl();
console.log('[ENV] Final API_BASE_URL:', API_BASE_URL);
