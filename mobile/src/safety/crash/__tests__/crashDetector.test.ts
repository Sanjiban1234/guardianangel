// mobile/src/safety/crash/__tests__/crashDetector.test.ts
import { CrashDetector } from '../crashDetector';
import { fetchDetectionConfig } from '../fetchDetectionConfig';
import {
  AccelerometerReading,
  CrashCandidateEvent,
  DEFAULT_DETECTION_CONFIG,
  GyroscopeReading,
  TelemetryReading,
} from '../types';

// ────────────────────────────────────────────────────────────────────
// Helpers: generate synthetic sensor sequences for the real
// CrashDetector API (feedAccelerometer / feedGyroscope / feedTelemetry)
// ────────────────────────────────────────────────────────────────────

/** Normal riding: small noise around gravity baseline at ~50Hz (20ms intervals). */
function accelNormal(count: number, startTs: number, intervalMs = 20): AccelerometerReading[] {
  const readings: AccelerometerReading[] = [];
  for (let i = 0; i < count; i++) {
    readings.push({
      x: (Math.random() - 0.5) * 1.5,
      y: (Math.random() - 0.5) * 1.5,
      z: 9.8 + (Math.random() - 0.5) * 1.5,
      timestamp: startTs + i * intervalMs,
    });
  }
  return readings;
}

/** Impact spike: huge acceleration values that exceed jerk + magnitude thresholds. */
function accelSpike(ts: number): AccelerometerReading {
  return { x: 55, y: 40, z: 35, timestamp: ts };
}

/** Post-impact stillness at a given interval. */
function accelStill(count: number, startTs: number, intervalMs = 20): AccelerometerReading[] {
  const readings: AccelerometerReading[] = [];
  for (let i = 0; i < count; i++) {
    readings.push({
      x: 0.02 * (Math.random() - 0.5),
      y: 0.02 * (Math.random() - 0.5),
      z: 9.8,
      timestamp: startTs + i * intervalMs,
    });
  }
  return readings;
}

/** Telemetry that puts us above the speed gate (15 km/h). */
function telemetryMoving(ts: number): TelemetryReading {
  return { timestamp: ts, latitude: 27.7, longitude: 85.3, accuracy: 5, speed: 20 / 3.6 };
}

/** High gyro readings that exceed the 250 deg/s threshold (values in rad/s). */
function gyroHigh(count: number, startTs: number, intervalMs = 20): GyroscopeReading[] {
  const readings: GyroscopeReading[] = [];
  // 5 rad/s ≈ 286 deg/s — above the 250 threshold
  for (let i = 0; i < count; i++) {
    readings.push({ x: 3, y: 3, z: 2, timestamp: startTs + i * intervalMs });
  }
  return readings;
}

/**
 * Drive a full crash sequence through the detector and return the emitted candidate.
 * Uses the given `intervalMs` for accelerometer timestamps (default 20ms = 50Hz).
 */
function driveCrashSequence(
  detector: CrashDetector,
  options: { intervalMs?: number } = {},
): CrashCandidateEvent | null {
  const intervalMs = options.intervalMs ?? 20;
  let candidate: CrashCandidateEvent | null = null;
  detector.onCandidate((e) => { candidate = e; });

  const t0 = 1000;

  // 1. Establish speed gate
  detector.feedTelemetry(telemetryMoving(t0));

  // 2. Normal pre-ride readings to fill buffer
  const preRide = accelNormal(10, t0, intervalMs);
  preRide.forEach((r) => detector.feedAccelerometer(r));

  // 3. Impact spike
  const spikeTs = t0 + 10 * intervalMs;
  detector.feedAccelerometer(accelSpike(spikeTs));

  // 4. High gyro during post-event window
  const gyroReadings = gyroHigh(20, spikeTs + intervalMs, intervalMs);
  gyroReadings.forEach((r) => detector.feedGyroscope(r));

  // 5. Post-impact stillness readings spanning past the 4000ms post-event window
  const postCount = Math.ceil(5000 / intervalMs);
  const postReadings = accelStill(postCount, spikeTs + intervalMs, intervalMs);
  postReadings.forEach((r) => detector.feedAccelerometer(r));

  return candidate;
}

// ────────────────────────────────────────────────────────────────────
// Existing tests (preserved, adapted to correct API)
// ────────────────────────────────────────────────────────────────────

jest.useFakeTimers();

describe('CrashDetector', () => {
  it('stays IDLE on normal riding data', () => {
    const detector = new CrashDetector();
    accelNormal(30, 1000).forEach((r) => detector.feedAccelerometer(r));
    expect(detector.getState()).toBe('IDLE');
  });

  it('confirms a crash candidate with valid sensor data', () => {
    const detector = new CrashDetector();
    const candidate = driveCrashSequence(detector);

    expect(candidate).not.toBeNull();
    expect(detector.getState()).toBe('CANDIDATE_CONFIRMED');
  });

  it('resets to IDLE on manual reset (override button)', () => {
    const detector = new CrashDetector();
    driveCrashSequence(detector);
    detector.reset();
    expect(detector.getState()).toBe('IDLE');
  });

  // ────────────────────────────────────────────────────────────────
  // Fix 1 — Configurable detection thresholds (finding 5.5)
  // ────────────────────────────────────────────────────────────────

  describe('configurable detection thresholds (finding 5.5)', () => {
    it('updateConfig() overrides specific fields while preserving others', () => {
      const detector = new CrashDetector();
      const originalGravity = detector.getConfig().gravity;

      detector.updateConfig({ magnitudeThresholdG: 6.0 });

      expect(detector.getConfig().magnitudeThresholdG).toBe(6.0);
      expect(detector.getConfig().gravity).toBe(originalGravity); // unchanged
    });

    it('detector initialized with custom config uses those values', () => {
      const customConfig = { magnitudeThresholdG: 999 }; // impossibly high
      const detector = new CrashDetector(customConfig);

      expect(detector.getConfig().magnitudeThresholdG).toBe(999);
      // This detector should never fire a crash because the threshold is impossibly high
      const candidate = driveCrashSequence(detector);
      expect(candidate).toBeNull();
      expect(detector.getState()).toBe('IDLE');
    });

    it('updateConfig() does not reset detector state or buffers', () => {
      const detector = new CrashDetector();

      // Feed some readings to populate buffers
      accelNormal(5, 1000).forEach((r) => detector.feedAccelerometer(r));

      // Update config mid-stream
      detector.updateConfig({ jerkThreshold: 200 });

      // State should still be IDLE, not reset
      expect(detector.getState()).toBe('IDLE');
      expect(detector.getConfig().jerkThreshold).toBe(200);
    });

    it('fetchDetectionConfig returns defaults on network failure', async () => {
      // Mock fetch to simulate network failure
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const config = await fetchDetectionConfig('http://localhost:3000');

      expect(config).toEqual(DEFAULT_DETECTION_CONFIG);

      global.fetch = originalFetch;
    });

    it('fetchDetectionConfig merges partial server response with defaults', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ magnitudeThresholdG: 5.5, gravity: 9.81 }),
      });

      const config = await fetchDetectionConfig('http://localhost:3000');

      // Server-provided values override defaults
      expect(config.magnitudeThresholdG).toBe(5.5);
      expect(config.gravity).toBe(9.81);
      // Non-provided values remain as defaults
      expect(config.jerkThreshold).toBe(DEFAULT_DETECTION_CONFIG.jerkThreshold);
      expect(config.postEventWindowMs).toBe(DEFAULT_DETECTION_CONFIG.postEventWindowMs);

      global.fetch = originalFetch;
    });

    it('crash detection still functions after config fetch failure (fail-safe)', async () => {
      // This is the most important test: prove detection never silently disables.
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockRejectedValue(new Error('Server down'));

      const config = await fetchDetectionConfig('http://localhost:3000');
      const detector = new CrashDetector();
      detector.updateConfig(config); // Apply the fallback config

      // Detection should work exactly as with defaults
      const candidate = driveCrashSequence(detector);
      expect(candidate).not.toBeNull();
      expect(detector.getState()).toBe('CANDIDATE_CONFIRMED');

      global.fetch = originalFetch;
    });

    it('fetchDetectionConfig returns defaults on HTTP error status', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      const config = await fetchDetectionConfig('http://localhost:3000');
      expect(config).toEqual(DEFAULT_DETECTION_CONFIG);

      global.fetch = originalFetch;
    });

    it('fetchDetectionConfig returns defaults on malformed JSON', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve('not an object'),
      });

      const config = await fetchDetectionConfig('http://localhost:3000');
      expect(config).toEqual(DEFAULT_DETECTION_CONFIG);

      global.fetch = originalFetch;
    });

    it('fetchDetectionConfig ignores non-numeric fields from server', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          magnitudeThresholdG: 'invalid',
          jerkThreshold: 200,
          __proto__: { polluted: true },
        }),
      });

      const config = await fetchDetectionConfig('http://localhost:3000');
      // 'invalid' string should be ignored, keeping the default
      expect(config.magnitudeThresholdG).toBe(DEFAULT_DETECTION_CONFIG.magnitudeThresholdG);
      // Valid numeric value accepted
      expect(config.jerkThreshold).toBe(200);

      global.fetch = originalFetch;
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Fix 2 — Sample rate validation (finding 5.6)
  // ────────────────────────────────────────────────────────────────

  describe('sample rate health tracking (finding 5.6)', () => {
    it('reports healthy with no readings yet', () => {
      const detector = new CrashDetector();
      const health = detector.getSampleRateHealth();
      expect(health.isHealthy).toBe(true);
      expect(health.healthRatio).toBe(1);
    });

    it('reports healthy at normal ~50Hz sample rate (20ms intervals)', () => {
      const detector = new CrashDetector();
      // Feed 25 readings at 20ms intervals (50Hz)
      accelNormal(25, 1000, 20).forEach((r) => detector.feedAccelerometer(r));

      const health = detector.getSampleRateHealth();
      expect(health.isHealthy).toBe(true);
      expect(health.healthRatio).toBe(1);
      expect(health.lastIntervalMs).toBe(20);
    });

    it('reports unhealthy at consistently abnormal rate (e.g. 200ms / 5Hz)', () => {
      const detector = new CrashDetector();
      // Feed 25 readings at 200ms intervals (5Hz) — well outside 10–50ms range
      accelNormal(25, 1000, 200).forEach((r) => detector.feedAccelerometer(r));

      const health = detector.getSampleRateHealth();
      expect(health.isHealthy).toBe(false);
      expect(health.healthRatio).toBe(0); // all intervals outside range
      expect(health.lastIntervalMs).toBe(200);
    });

    it('single off-interval reading does not degrade health (noise tolerance)', () => {
      const detector = new CrashDetector();
      const t0 = 1000;

      // 20 normal readings at 20ms
      accelNormal(20, t0, 20).forEach((r) => detector.feedAccelerometer(r));

      // 1 abnormal reading at 200ms gap
      detector.feedAccelerometer({
        x: 0.1, y: 0.1, z: 9.8,
        timestamp: t0 + 20 * 20 + 200,
      });

      const health = detector.getSampleRateHealth();
      // 19 healthy intervals out of 20 = 0.95 > 0.6 threshold
      expect(health.isHealthy).toBe(true);
      expect(health.healthRatio).toBeGreaterThan(0.9);
    });

    it('crash with healthy sample rate → lowConfidence = false', () => {
      const detector = new CrashDetector();
      const candidate = driveCrashSequence(detector, { intervalMs: 20 });

      expect(candidate).not.toBeNull();
      expect(candidate!.lowConfidence).toBe(false);
    });

    it('crash with consistently abnormal sample rate → lowConfidence = true', () => {
      const detector = new CrashDetector();
      // Use 200ms intervals (5Hz) — consistently outside 10–50ms range
      const candidate = driveCrashSequence(detector, { intervalMs: 200 });

      expect(candidate).not.toBeNull();
      expect(candidate!.lowConfidence).toBe(true);
    });

    it('crash candidate is still emitted even with unhealthy sample rate (never suppressed)', () => {
      const detector = new CrashDetector();
      // Use very abnormal rate — detection must still fire, just flagged
      const candidate = driveCrashSequence(detector, { intervalMs: 200 });

      expect(candidate).not.toBeNull();
      expect(detector.getState()).toBe('CANDIDATE_CONFIRMED');
      // The key safety invariant: crash detection is never silently suppressed
      expect(candidate!.peakMagnitudeG).toBeGreaterThan(0);
      expect(candidate!.lowConfidence).toBe(true);
    });

    it('health ratio uses rolling window — old intervals age out', () => {
      const detector = new CrashDetector({ sampleHealthWindowSize: 5 });
      const t0 = 1000;

      // 5 abnormal readings (200ms)
      accelNormal(6, t0, 200).forEach((r) => detector.feedAccelerometer(r));
      expect(detector.getSampleRateHealth().isHealthy).toBe(false);

      // Now 6 normal readings (20ms) — the window holds only last 5 intervals
      const t1 = t0 + 6 * 200;
      accelNormal(6, t1, 20).forEach((r) => detector.feedAccelerometer(r));

      const health = detector.getSampleRateHealth();
      expect(health.isHealthy).toBe(true);
      expect(health.healthRatio).toBe(1); // window now contains only healthy intervals
    });
  });
});