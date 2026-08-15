# Crash Detection Validation Traces

This directory contains sensor trace files used to validate crash detection threshold parameters without requiring real-world crash testing.

## Purpose

Sensor traces allow controlled, repeatable testing of the crash detection algorithm by feeding recorded accelerometer, gyroscope, and GPS data through `CrashDetector` offline. This enables:

1. **Baseline False Positive Testing**: Record normal riding scenarios (potholes, speed bumps, emergency braking) and verify they don't trigger false detections
2. **Threshold Tuning**: Adjust detection parameters and immediately re-test against the full trace library
3. **Regression Testing**: Ensure code changes don't break detection behavior on known good/bad traces
4. **Reproducibility**: Share traces with other researchers or devices for independent validation

## Trace File Format

Each trace is a JSON file with the following structure:

```json
{
  "trace_id": "unique-kebab-case-identifier",
  "scenario": "Human-readable description of what was recorded",
  "ground_truth": "crash" | "not_a_crash",
  "device": {
    "model": "Device model name",
    "mount": "handlebar | pocket | backpack",
    "notes": "Optional notes about test conditions"
  },
  "readings": [
    {
      "timestamp_ms": 0,
      "accel_x": 0.2,
      "accel_y": 9.8,
      "accel_z": 0.1,
      "gyro_x": 0.05,
      "gyro_y": 0.03,
      "gyro_z": 0.02,
      "speed_kmh": 40.0,
      "latitude": 14.5123,
      "longitude": 121.0456,
      "accuracy_meters": 8.0
    },
    ...
  ]
}
```

### Field Definitions

**Top Level:**
- `trace_id`: Unique identifier (convention: `scenario-speed-date`, e.g., `pothole-40kmh-20260815`)
- `scenario`: What happened during this recording (e.g., "Highway pothole at 80 km/h", "Low-side crash at 30 km/h with tumbling")
- `ground_truth`: `"crash"` if this is a real crash, `"not_a_crash"` if it's normal riding
- `device`: Metadata about recording device and conditions

**Readings Array:**
- `timestamp_ms`: Milliseconds since trace start (first reading is 0)
- `accel_x`, `accel_y`, `accel_z`: Accelerometer readings in m/s² (device coordinate system: typically Y is "up" when phone is flat, ~9.8 at rest)
- `gyro_x`, `gyro_y`, `gyro_z`: Gyroscope readings in rad/s
- `speed_kmh`: GPS-derived speed in kilometers per hour
- `latitude`, `longitude`: GPS coordinates (decimal degrees)
- `accuracy_meters`: GPS horizontal accuracy estimate

**Coordinate System Conventions:**
- Acceleration is in **m/s²** (not g-forces). Convert to g by dividing by 9.8.
- Gyroscope is in **rad/s**. Convert to deg/s by multiplying by (180/π).
- Expected sample interval: **20ms** (50 Hz), but real-world traces may vary.

## Using the Trace Player

### Playing a Single Trace

```typescript
import { playTraceFile } from '../mobile/src/safety/crash/__tests__/crashDetectorTracePlayer';

const outcome = playTraceFile('docs/crash-validation-traces/example-pothole-40kmh.json');

console.log(`Trace: ${outcome.trace_id}`);
console.log(`Ground Truth: ${outcome.ground_truth}`);
console.log(`Detected: ${outcome.detected}`);
console.log(`False Positive: ${outcome.false_positive}`);
console.log(`Peak Accel: ${outcome.peak_values.accel_magnitude_g.toFixed(2)}g`);
```

### Running All Traces in a Directory

```typescript
import { runTraceDirectory, generateFalsePositiveReport } from '../mobile/src/safety/crash/__tests__/crashDetectorTracePlayer';

const results = runTraceDirectory('docs/crash-validation-traces/');
console.log(generateFalsePositiveReport(results));
```

Output example:
```
================================================================================
CRASH DETECTION TRACE VALIDATION REPORT
================================================================================

Total Traces: 12
  - Crash Traces: 3
  - Non-Crash Traces: 9

RESULTS:
  True Positives:  3 (crash correctly detected)
  True Negatives:  8 (non-crash correctly ignored)
  False Positives: 1 (non-crash incorrectly detected)
  False Negatives: 0 (crash missed)

METRICS:
  False Positive Rate: 11.11%
  True Positive Rate:  100.00% (Sensitivity)
  Accuracy:            91.67%

FALSE POSITIVES (Non-crash scenarios incorrectly detected as crashes):
--------------------------------------------------------------------------------
  [pothole-highway-80kmh] Highway pothole at 80 km/h
    Peak Accel: 4.2g
    Peak Jerk: 165 m/s³
    Peak Gyro: 220 deg/s
    Speed: 80.00 km/h
    Detection Time: 1250ms

================================================================================
VALIDATION STATUS: FAIL - False positive rate 11.11% exceeds 5% threshold
================================================================================
```

### Testing Custom Thresholds

```typescript
import { playTraceFile } from '../mobile/src/safety/crash/__tests__/crashDetectorTracePlayer';

const outcome = playTraceFile(
  'docs/crash-validation-traces/example-pothole-40kmh.json',
  {
    magnitudeThresholdG: 5.0,  // Increase from default 4.0
    jerkThreshold: 180,         // Increase from default 150
  }
);

console.log(`Detected with stricter thresholds: ${outcome.detected}`);
```

## Recording Real-World Traces

To record a trace during actual test rides:

1. **Enable Debug Logging**: Add sensor data export to `CrashDetector` or `TelemetryModule`
2. **Record Ride Session**: Capture all accelerometer, gyroscope, and GPS readings to a local file
3. **Post-Process**: Convert binary/CSV sensor logs to JSON trace format
4. **Label Ground Truth**: Manually annotate each trace with `"crash"` or `"not_a_crash"`
5. **Document Conditions**: Fill in device, mount, and scenario metadata

**Privacy Note:** GPS coordinates in traces may reveal rider locations. Obfuscate or offset coordinates if sharing publicly.

## Example Traces

### example-pothole-40kmh.json
- **Scenario:** Moderate pothole hit at 40 km/h
- **Ground Truth:** `not_a_crash`
- **Purpose:** Baseline normal riding conditions
- **Expected Outcome:** Should NOT trigger detection (peak accel ~1.8g, jerk ~120 m/s³)

### example-lowside-crash-30kmh.json
- **Scenario:** Low-side crash at 30 km/h with tumbling
- **Ground Truth:** `crash`
- **Purpose:** Validate detection sensitivity
- **Expected Outcome:** SHOULD trigger detection (peak accel ~4.3g, jerk ~180 m/s³, tumbling evident)

## Trace Collection Guidelines

### What to Record

**Non-Crash Traces (for false positive testing):**
- Smooth city riding (20-40 km/h)
- Highway riding (60-100 km/h)
- Pothole hits (various speeds)
- Speed bumps (10-20 km/h)
- Emergency braking (no actual crash)
- Gravel/unpaved roads
- Railroad crossing bumps
- Parking lot maneuvering
- Phone drop from pocket during ride

**Crash Traces (if safely obtainable):**
- Controlled low-speed tipovers (<10 km/h, in parking lot)
- Simulated crash with crash test dummy (if resources available)
- Public crash datasets from research institutions
- DO NOT intentionally crash at speed for data collection

### Minimum Trace Requirements

- **Duration:** At least 1 second before peak event, 5 seconds after
- **Sample Rate:** 20-50ms intervals (20-50 Hz)
- **GPS Quality:** Accuracy <15m for speed readings
- **Metadata:** Device model, mount location, road conditions

### File Naming Convention

```
{scenario}-{speed}-{date}.json

Examples:
pothole-highway-80kmh-20260815.json
lowside-crash-30kmh-20260820.json
speedbump-slow-15kmh-20260822.json
emergency-brake-60kmh-20260825.json
```

## Trace Library Goals

### Phase 1 (Bench Testing)
- [ ] 5 drop test traces (stationary, various heights)
- [ ] 3 shake rig traces (stationary vehicle vibration)
- [ ] Example synthetic traces (pothole, crash) ✓

### Phase 2 (Baseline Collection)
- [ ] 10 smooth city riding traces
- [ ] 10 pothole/rough road traces
- [ ] 5 highway riding traces
- [ ] 10 speed bump traces
- [ ] 5 emergency braking traces
- [ ] 5 edge case traces (phone drop, gravel slide, etc.)

### Phase 3 (Crash Validation)
- [ ] 3+ controlled low-speed crash traces (if obtainable)
- [ ] Public dataset traces (if available)

**Target:** 50+ non-crash traces, 3-5 crash traces for robust validation

## Data Storage

**Local Development:**
- Store traces in this directory (`docs/crash-validation-traces/`)
- DO NOT commit large trace files (>100KB each) to git
- Use `.gitignore` to exclude: `*.json` except example traces

**Archive Storage:**
- Compress trace library: `tar -czf crash-traces-YYYYMMDD.tar.gz *.json`
- Store archive externally (Google Drive, institutional storage)
- Document archive location in `crash-validation-test-report.md`

## Known Limitations

1. **Synthetic Traces:** Example traces in this directory are synthetic (hand-authored), not real sensor recordings. Real-world traces will have noisier signals and irregular timing.

2. **Device Variance:** Sensor characteristics vary by device (noise floor, sample rate jitter, coordinate systems). Traces from one device may not perfectly represent behavior on another.

3. **Mount Position:** Handlebar-mounted traces have different vibration profiles than pocket-mounted. Label mount position in trace metadata.

4. **Speed Accuracy:** GPS speed can lag or be inaccurate, especially in urban canyons or under tree cover. Speed gate validation should account for GPS error.

5. **No Replay Environment Simulation:** Trace player feeds data to `CrashDetector` in ideal conditions (perfect timing, no CPU load). Real-world detection may differ due to sensor timing jitter or CPU throttling.

## Validation Acceptance Criteria

Per `docs/crash-threshold-validation-protocol.md`:

- **Gate 1 (Bench):** False positive rate < 5% on non-crash traces
- **Gate 2 (Baseline):** False positive rate < 1% across 2 hours of test rides
- **Gate 3 (Speed):** Speed gate correctly blocks all detections below 15 km/h

Traces failing these criteria indicate threshold re-tuning is required.

## Contributing Traces

If you record additional traces during testing:

1. Convert to JSON format (template above)
2. Validate JSON structure: `node -e "JSON.parse(require('fs').readFileSync('your-trace.json'))"`
3. Test with trace player: `playTraceFile('your-trace.json')`
4. Document in test report: `docs/crash-validation-test-report.md`
5. DO NOT commit if trace contains sensitive location data (obfuscate coordinates first)

## References

- Crash detection algorithm: `mobile/src/safety/crash/crashDetector.ts`
- Trace player implementation: `mobile/src/safety/crash/__tests__/crashDetectorTracePlayer.ts`
- Validation protocol: `docs/crash-threshold-validation-protocol.md`
- Test report template: `docs/crash-validation-test-report.md`

---

**Last Updated:** 2026-08-15  
**Maintained By:** Guardian Angel Safety Team
