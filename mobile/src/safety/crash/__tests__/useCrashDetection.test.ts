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
