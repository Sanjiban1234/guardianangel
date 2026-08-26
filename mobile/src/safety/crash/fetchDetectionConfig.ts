// mobile/src/safety/crash/fetchDetectionConfig.ts
//
// Fetches detection thresholds from the backend (finding 5.5).
// Mirrors the WeatherService fail-soft pattern: AbortController timeout,
// returns safe defaults on any failure, never blocks crash detection.

import { DetectionConfig, DEFAULT_DETECTION_CONFIG } from './types';

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Fetches crash detection config from `GET /api/safety/config`.
 *
 * - On success: merges response with DEFAULT_DETECTION_CONFIG (backend can
 *   send a sparse override — missing fields use hardcoded defaults).
 * - On failure (network error, timeout, non-200, malformed JSON): returns
 *   DEFAULT_DETECTION_CONFIG unchanged — fail safe, not fail open.
 *
 * Never throws. Always returns a usable DetectionConfig.
 */
export async function fetchDetectionConfig(
  baseUrl: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<DetectionConfig> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${baseUrl}/api/safety/config`, {
        signal: controller.signal,
      });

      if (!response.ok) {
        console.warn(
          `Safety config fetch failed: HTTP ${response.status}. Using defaults.`,
        );
        return { ...DEFAULT_DETECTION_CONFIG };
      }

      const body = await response.json();

      if (typeof body !== 'object' || body === null) {
        console.warn('Safety config fetch: invalid response shape. Using defaults.');
        return { ...DEFAULT_DETECTION_CONFIG };
      }

      // Merge: backend values override defaults, missing fields keep defaults.
      // Only accept keys that exist in DetectionConfig to prevent pollution.
      const merged = { ...DEFAULT_DETECTION_CONFIG };
      for (const key of Object.keys(DEFAULT_DETECTION_CONFIG) as (keyof DetectionConfig)[]) {
        if (key in body && typeof body[key] === 'number') {
          (merged as Record<string, number>)[key] = body[key];
        }
      }

      return merged;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error: unknown) {
    // AbortError (timeout), TypeError (network failure), SyntaxError (bad JSON), etc.
    const message = error instanceof Error ? error.message : String(error);
    console.warn('Safety config fetch failed. Using defaults.');
    return { ...DEFAULT_DETECTION_CONFIG };
  }
}
