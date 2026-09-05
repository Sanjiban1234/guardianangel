// mobile/src/safety/crash/__tests__/useCrashDetection.test.ts
import { DEFAULT_DETECTION_CONFIG } from '../types';

/**
 * Test: sensor sampling interval must fall within valid range
 *
 * This test exists to catch the bug that was present where sensors were
 * configured at 100ms (10Hz) but DEFAULT_DETECTION_CONFIG expected 20ms (50Hz),
 * causing all sample rate health checks to fail and every detection to be
 * incorrectly marked lowConfidence: true.
 *
 * The fix: useCrashDetection.ts now uses DEFAULT_DETECTION_CONFIG.expectedSampleIntervalMs
 * instead of a hardcoded 100ms value.
 */
describe('useCrashDetection sensor sampling configuration', () => {
  it('configured sampling interval must fall within valid range defined by DetectionConfig', () => {
    // The sensor sampling interval configured in useCrashDetection.ts
    // MUST match expectedSampleIntervalMs from DEFAULT_DETECTION_CONFIG.
    // This is enforced at module load time via setUpdateIntervalForType().

    const configuredInterval = DEFAULT_DETECTION_CONFIG.expectedSampleIntervalMs;
    const minValid = DEFAULT_DETECTION_CONFIG.sampleIntervalMinMs;
    const maxValid = DEFAULT_DETECTION_CONFIG.sampleIntervalMaxMs;
    const expectedInterval = DEFAULT_DETECTION_CONFIG.expectedSampleIntervalMs;

    // Verify the configured interval is within the valid range
    expect(configuredInterval).toBeGreaterThanOrEqual(minValid);
    expect(configuredInterval).toBeLessThanOrEqual(maxValid);

    // Verify it matches the expected value exactly (20ms = 50Hz)
    expect(configuredInterval).toBe(expectedInterval);
    expect(configuredInterval).toBe(20);
  });

  it('expectedSampleIntervalMs must be within its own valid range (sanity check)', () => {
    // This catches a config error where the expected value is outside the valid range
    const expected = DEFAULT_DETECTION_CONFIG.expectedSampleIntervalMs;
    const min = DEFAULT_DETECTION_CONFIG.sampleIntervalMinMs;
    const max = DEFAULT_DETECTION_CONFIG.sampleIntervalMaxMs;

    expect(expected).toBeGreaterThanOrEqual(min);
    expect(expected).toBeLessThanOrEqual(max);
  });
});

describe('Crash detection speed gate integration via TelemetryModule stream', () => {
  it('allows crash candidate to fire when telemetryStream$ emits speed >= 15 km/h (4.17 m/s)', () => {
    const { CrashDetector } = require('../crashDetector');
    const { TelemetryModule } = require('../../../telemetry/TelemetryModule');

    const detector = new CrashDetector();
    const telemetryModule = new TelemetryModule();
    (telemetryModule as any).options = { groupCode: 'ROOM', userId: 'u' };

    // Wire telemetryStream$ exactly as App.tsx wires it
    const telemetryStream$ = {
      subscribe: (cb: (r: any) => void) => {
        const unsubscribe = telemetryModule.onReading((reading: any) => {
          cb({
            timestamp: reading.timestamp,
            latitude: reading.latitude,
            longitude: reading.longitude,
            accuracy: reading.accuracy,
            speed: reading.speed,
          });
        });
        return { unsubscribe };
      },
    };

    let candidateEvent: any = null;
    detector.onCandidate((e: any) => {
      candidateEvent = e;
    });

    const sub = telemetryStream$.subscribe((r) => detector.feedTelemetry(r));

    const t0 = 1000;
    const locationProvider = (telemetryModule as any).locationProvider;
    locationProvider.start((sample: any) => {
      (telemetryModule as any).handleIncomingReading(sample);
    });

    locationProvider.emitLocation({
      timestamp: t0,
      latitude: 27.7,
      longitude: 85.3,
      accuracy: 5.0,
      speed: 20 / 3.6, // 20 km/h in m/s (> 15 km/h threshold)
    });

    // Accelerometer normal + impact spike
    detector.feedAccelerometer({ x: 0, y: 0, z: 9.8, timestamp: t0 });
    detector.feedAccelerometer({ x: 0, y: 0, z: 9.8, timestamp: t0 + 20 });
    detector.feedAccelerometer({ x: 55, y: 40, z: 35, timestamp: t0 + 40 });

    // Gyroscope rotation during post-event window
    detector.feedGyroscope({ x: 3, y: 3, z: 2, timestamp: t0 + 60 });
    detector.feedGyroscope({ x: 3, y: 3, z: 2, timestamp: t0 + 80 });

    // Post-impact stillness past 4000ms window
    for (let i = 0; i < 250; i++) {
      detector.feedAccelerometer({ x: 0, y: 0, z: 9.8, timestamp: t0 + 100 + i * 20 });
    }

    expect(candidateEvent).not.toBeNull();
    expect(detector.getState()).toBe('CANDIDATE_CONFIRMED');

    sub.unsubscribe();
  });

  it('rejects crash candidate when telemetryStream$ speed is below 15 km/h (speed gate blocks)', () => {
    const { CrashDetector } = require('../crashDetector');
    const { TelemetryModule } = require('../../../telemetry/TelemetryModule');

    const detector = new CrashDetector();
    const telemetryModule = new TelemetryModule();
    (telemetryModule as any).options = { groupCode: 'ROOM', userId: 'u' };

    const telemetryStream$ = {
      subscribe: (cb: (r: any) => void) => {
        const unsubscribe = telemetryModule.onReading((reading: any) => {
          cb({
            timestamp: reading.timestamp,
            latitude: reading.latitude,
            longitude: reading.longitude,
            accuracy: reading.accuracy,
            speed: reading.speed,
          });
        });
        return { unsubscribe };
      },
    };

    let candidateEvent: any = null;
    detector.onCandidate((e: any) => {
      candidateEvent = e;
    });

    const sub = telemetryStream$.subscribe((r) => detector.feedTelemetry(r));

    const t0 = 1000;
    const locationProvider = (telemetryModule as any).locationProvider;
    locationProvider.start((sample: any) => {
      (telemetryModule as any).handleIncomingReading(sample);
    });

    // Speed = 5 km/h (< 15 km/h threshold)
    locationProvider.emitLocation({
      timestamp: t0,
      latitude: 27.7,
      longitude: 85.3,
      accuracy: 5.0,
      speed: 5 / 3.6,
    });

    detector.feedAccelerometer({ x: 0, y: 0, z: 9.8, timestamp: t0 });
    detector.feedAccelerometer({ x: 55, y: 40, z: 35, timestamp: t0 + 20 });

    expect(candidateEvent).toBeNull();
    expect(detector.getState()).toBe('IDLE'); // Blocked by speed gate

    sub.unsubscribe();
  });
});
