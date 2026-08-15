# Crash Threshold Validation Protocol

**Status:** Draft v1.0  
**Date:** 2026-08-15  
**Author:** Guardian Angel Team  
**Purpose:** Establish controlled testing methodology to validate unvalidated crash detection thresholds before supervised road testing

---

## 1. Executive Summary

All crash detection threshold values in Guardian Angel are **currently unvalidated**. The values in `DEFAULT_DETECTION_CONFIG` (mobile/src/safety/crash/types.ts) are engineering estimates based on literature review, not validated against actual motorcycle crash data.

This protocol defines a **three-phase controlled testing approach** to collect validation data for 13 tunable parameters before any real-speed road testing:

1. **Phase 1**: Bench/controlled tests (drop tests, shake rigs, recorded traces)
2. **Phase 2**: Baseline false positive collection (normal riding scenarios)
3. **Phase 3**: Go/no-go criteria assessment

**Critical Safety Constraint:** No real-speed crash testing. No unsupervised road use until Phase 3 criteria are met.

---

## 2. Threshold Parameters Requiring Validation

### 2.1 Primary Detection Thresholds

| Parameter | Current Value | Unit | Purpose |
|-----------|---------------|------|---------|
| `magnitudeThresholdG` | 4.0 | g-forces | Peak acceleration spike during impact |
| `jerkThreshold` | 150 | m/s³ | Rate of acceleration change |
| `gyroRotationThresholdDegPerSec` | 250 | deg/s | Rotational velocity during tumbling |
| `speedGateKmh` | 15 | km/h | Minimum pre-event speed to consider detection |

### 2.2 Post-Event Analysis Thresholds

| Parameter | Current Value | Unit | Purpose |
|-----------|---------------|------|---------|
| `postEventWindowMs` | 4000 | ms | Duration to watch for post-impact stillness/tumbling |
| `stillnessThresholdG` | 0.3 | g-forces | Threshold for "still" (potential unconsciousness) |
| `roughnessRatioThreshold` | 2.5 | ratio | Variance ratio for post-event roughness detection |

### 2.3 Cross-Check & Sampling

| Parameter | Current Value | Unit | Purpose |
|-----------|---------------|------|---------|
| `speedCrossCheckToleranceKmh` | 10 | km/h | Tolerance for speed consistency check |
| `sensorSampleRateMs` | 20 | ms | Expected sensor reading interval |
| `sensorSampleRateToleranceMs` | 30 | ms | Tolerance for irregular sensor timing |
| `maxGapToleranceMs` | 100 | ms | Maximum gap before sensor buffer reset |
| `bufferDepthReadings` | 300 | count | Number of readings to retain in memory |
| `minBufferForDetection` | 50 | count | Minimum readings required before detection can trigger |

---

## 3. Phase 1: Controlled/Bench Testing

### 3.1 Low-Speed Drop Tests

**Objective:** Simulate motorcycle tipover/parking lot falls (0-20 km/h) to validate impact spike thresholds without real-speed danger.

**Equipment:**
- Test device (Android phone running Guardian Angel debug APK)
- Foam padding or crash mat
- Video camera for post-analysis
- Measuring tape

**Test Scenarios:**

| Test ID | Scenario | Expected Outcome | Data to Collect |
|---------|----------|------------------|-----------------|
| DS-01 | Device in pocket, drop from 1m onto foam mat | NO detection (below magnitude threshold) | Peak accel, jerk, rotation |
| DS-02 | Device in pocket, drop from 1.5m onto foam mat | NO detection (no pre-event speed) | Peak accel, jerk, rotation |
| DS-03 | Device on simulated handlebar mount, drop from 1m at 0 km/h | NO detection (speed gate) | Peak accel, jerk, rotation, speed |
| DS-04 | Device on simulated handlebar mount, drop from 1.5m at 0 km/h | NO detection (speed gate) | Peak accel, jerk, rotation, speed |
| DS-05 | Device in running vehicle (stationary with engine on), shake vigorously | NO detection | Peak accel, jerk, rotation, speed |

**Success Criteria:** All DS-01 through DS-05 must produce NO false positives. If any trigger detection, `magnitudeThresholdG` or `speedGateKmh` must be adjusted upward.

### 3.2 Shake Rig / Vibration Tests

**Objective:** Simulate rough road conditions, potholes, speed bumps to establish baseline for normal riding vibration.

**Equipment:**
- Motorcycle on center stand or stationary
- Test device mounted on handlebars
- Helper to induce controlled shaking

**Test Scenarios:**

| Test ID | Scenario | Expected Outcome | Data to Collect |
|---------|----------|------------------|-----------------|
| SR-01 | Engine running, handlebar shake (mild) | NO detection | Peak accel, jerk, sustained duration |
| SR-02 | Engine running, handlebar shake (aggressive) | NO detection | Peak accel, jerk, sustained duration |
| SR-03 | Engine off, drop handlebar-mounted device from 10cm | NO detection (speed gate) | Peak accel, jerk, rotation |

**Success Criteria:** All SR-01 through SR-03 must produce NO false positives.

### 3.3 Recorded Sensor Trace Playback

**Objective:** Replay recorded sensor data from known crash scenarios (if available from open datasets or research partners) through crash detector.

**Data Sources:**
- Academic motorcycle crash datasets (if available)
- Recorded traces from prior test rides (normal riding, potholes, speed bumps)
- Synthetic crash traces (generated based on crash dynamics literature)

**Test Harness:**
Create `crashDetectorTracePlayer.ts` that:
1. Reads JSON file with sensor trace: `{timestamp, accel_x, accel_y, accel_z, gyro_x, gyro_y, gyro_z, speed_kmh}[]`
2. Feeds each reading to `CrashDetector.feedTelemetry()` at realistic intervals
3. Logs detection outcome (candidate triggered, false alarm, confirmed)
4. Reports false positive/negative rate

**Trace Format:**
```json
{
  "trace_id": "pothole-highway-01",
  "scenario": "Highway pothole at 80 km/h",
  "ground_truth": "not_a_crash",
  "readings": [
    {
      "timestamp_ms": 0,
      "accel_x": 0.1,
      "accel_y": 9.8,
      "accel_z": 0.0,
      "gyro_x": 0.0,
      "gyro_y": 0.0,
      "gyro_z": 0.0,
      "speed_kmh": 80.0,
      "latitude": 14.5123,
      "longitude": 121.0456,
      "accuracy_meters": 5.0
    },
    // ... more readings
  ]
}
```

**Success Criteria:**
- False Positive Rate < 5% on normal riding traces
- True Positive Rate > 90% on known crash traces (if available)

---

## 4. Phase 2: Baseline False Positive Collection

### 4.1 Normal Riding Scenarios

**Objective:** Collect sensor data from non-crash scenarios to measure baseline false positive rate in real-world conditions.

**Test Rides (Supervised, Low-Speed):**

| Test ID | Scenario | Duration | Speed Range | Expected Detections |
|---------|----------|----------|-------------|---------------------|
| NR-01 | City riding (smooth roads) | 30 min | 20-40 km/h | 0 |
| NR-02 | City riding (pothole-heavy roads) | 30 min | 20-40 km/h | 0-1 (acceptable) |
| NR-03 | Highway riding (smooth) | 30 min | 60-80 km/h | 0 |
| NR-04 | Speed bump traversal (10 bumps) | 10 min | 10-20 km/h | 0 |
| NR-05 | Emergency braking (no crash) | 5 tests | 40-0 km/h | 0 |

**Baseline Acceptance Criteria:**
- False positive rate < 1% (1 false detection per 100 ride-minutes)
- If false positive rate > 1%, threshold parameters must be tuned upward before Phase 3

### 4.2 Edge Case Scenarios

**Objective:** Test detection behavior in ambiguous scenarios.

| Test ID | Scenario | Expected Outcome | Rationale |
|---------|----------|------------------|-----------|
| EC-01 | Phone drops out of pocket during ride (15+ km/h) | Detection MAY trigger | Acceptable - rider should check device |
| EC-02 | Motorcycle tips over while stationary | NO detection (speed gate) | Below speed threshold |
| EC-03 | Abrupt stop without crash (slide stop on gravel) | NO detection (no impact spike) | Controlled deceleration, no tumbling |

---

## 5. Phase 3: Go/No-Go Criteria for Supervised Road Testing

### 5.1 Gate 1: Bench Test Pass

**Requirements:**
- ✓ All drop tests (DS-01 to DS-05) produce zero false positives
- ✓ All shake rig tests (SR-01 to SR-03) produce zero false positives
- ✓ Recorded trace playback shows false positive rate < 5% on normal riding data

**If Gate 1 fails:** Adjust `magnitudeThresholdG`, `jerkThreshold`, or `gyroRotationThresholdDegPerSec` upward and repeat Phase 1.

### 5.2 Gate 2: Baseline False Positive Threshold

**Requirements:**
- ✓ Normal riding false positive rate < 1% over 2 hours of total supervised test rides
- ✓ Zero false positives during emergency braking tests (NR-05)

**If Gate 2 fails:** Re-tune thresholds and repeat Phase 2.

### 5.3 Gate 3: Speed Gate Validation

**Requirements:**
- ✓ Detection correctly ignores all scenarios below `speedGateKmh` (15 km/h)
- ✓ Telemetry speed data is consistently available (no null speed readings for >10% of test ride duration)

**If Gate 3 fails:** Check BackgroundGeolocationProvider GPS fix reliability or adjust speed gate logic.

### 5.4 Final Go/No-Go Decision

**Proceed to Supervised Road Testing IF:**
1. All three gates (Gate 1, 2, 3) are passed
2. Code review confirms no safety-critical bugs in crash detection pipeline
3. Test team acknowledges understanding of 15-second countdown cancellation flow
4. Backend SOS alert broadcast tested end-to-end in lab environment

**Do NOT proceed to road testing until all criteria are met.**

---

## 6. Data Collection & Logging Format

### 6.1 Test Log Structure

For each test scenario, log:

```json
{
  "test_id": "DS-01",
  "timestamp": "2026-08-15T14:30:00Z",
  "device": {
    "model": "Pixel 7",
    "android_version": "15",
    "app_version": "1.0.0-debug",
    "sensor_sample_rate_actual_ms": 21
  },
  "scenario": "Drop from 1m onto foam mat",
  "ground_truth": "not_a_crash",
  "detection_outcome": "no_trigger",
  "sensor_data_file": "traces/DS-01-20260815.json",
  "peak_values": {
    "accel_magnitude_g": 3.2,
    "jerk_m_s3": 120,
    "gyro_rotation_deg_s": 180,
    "speed_kmh": 0.0
  },
  "notes": "Device was in jeans pocket, landed on back side"
}
```

### 6.2 Trace Data Storage

Store raw sensor traces as JSON (format in Section 3.3) in `docs/crash-validation-traces/` directory:
- `DS-01-20260815.json` (drop test 1)
- `NR-01-20260815.json` (normal ride 1)
- etc.

Do NOT commit large trace files to git. Store locally or in separate archive.

---

## 7. Post-Validation Threshold Tuning

### 7.1 If False Positive Rate is Too High

**Adjust upward:**
- `magnitudeThresholdG`: Increase by 0.5g increments (4.0 → 4.5 → 5.0)
- `jerkThreshold`: Increase by 20 m/s³ increments (150 → 170 → 190)
- `gyroRotationThresholdDegPerSec`: Increase by 25 deg/s increments

**Re-test:** Repeat Phase 2 with new thresholds.

### 7.2 If True Positive Rate is Too Low (Missing Real Crashes)

**Adjust downward (ONLY if real crash data is available):**
- `magnitudeThresholdG`: Decrease by 0.25g increments
- `jerkThreshold`: Decrease by 10 m/s³ increments

**Critical:** Do NOT lower thresholds without confirmed crash data showing missed detections. False negatives are dangerous but unvalidated lowering creates false positive chaos.

### 7.3 Speed Gate Adjustments

If GPS speed is unreliable (null or stale readings):
- Check `BackgroundGeolocationProvider` distance filter (currently 10m - may be too aggressive)
- Consider fallback to accelerometer-derived speed estimate (not yet implemented)

If false positives occur at low speeds (<15 km/h):
- Increase `speedGateKmh` to 20 km/h
- Document trade-off: higher gate misses very low-speed crashes but reduces parking lot false alarms

---

## 8. Safety Constraints & Risk Mitigation

### 8.1 No Real-Speed Crash Testing

**Prohibition:** Do NOT intentionally crash a motorcycle at real speeds to test detection. This is unethical, unsafe, and unnecessary.

**Rationale:** Controlled low-speed tests + recorded trace playback + baseline false positive measurement are sufficient for initial validation.

### 8.2 Supervised Test Rides Only

**Requirement:** All Phase 2 test rides must have:
- Experienced rider (2+ years motorcycle experience)
- Support vehicle or chase car with first aid kit
- Mobile phone with emergency services access
- Pre-briefing on 15-second countdown cancellation flow

### 8.3 Informed Consent

Test riders must acknowledge:
- Crash detection thresholds are unvalidated
- False positives may occur (annoying but not dangerous)
- False negatives are possible (detection may miss real crashes)
- 15-second countdown allows manual cancellation
- Backend SOS alert will broadcast to ride group if countdown expires

---

## 9. Timeline & Resource Estimates

| Phase | Tasks | Duration | Personnel | Equipment |
|-------|-------|----------|-----------|-----------|
| Phase 1 | Drop tests, shake rig, trace playback harness | 3-5 days | 2 engineers | Test device, foam mat, motorcycle on stand |
| Phase 2 | Baseline false positive collection (supervised rides) | 5-7 days | 2 engineers, 1 test rider | Test device, motorcycle, support vehicle |
| Phase 3 | Go/no-go review, documentation | 1-2 days | Full team | None |

**Total Estimate:** 9-14 days elapsed time, assuming no threshold re-tuning required.

**If re-tuning is needed:** Add 2-3 days per iteration.

---

## 10. Deliverables

### 10.1 Test Report

Document to be created: `docs/crash-validation-test-report.md`

Contents:
- Summary of all test scenarios executed
- False positive/negative rates per phase
- Threshold values before and after tuning
- Sensor trace statistics (peak values, distributions)
- Go/no-go decision rationale

### 10.2 Trace Playback Harness

Code artifact: `mobile/src/safety/crash/__tests__/crashDetectorTracePlayer.ts`

Functions:
- `playTraceFile(filePath: string): DetectionOutcome`
- `runTraceDirectory(dirPath: string): TestResults`
- `generateFalsePositiveReport(results: TestResults): string`

### 10.3 Updated Threshold Documentation

If thresholds are adjusted, update:
- `mobile/src/safety/crash/types.ts` (DEFAULT_DETECTION_CONFIG)
- Backend `/api/safety/config` endpoint default values
- CLAUDE.md section "Crash Detection Thresholds" with validation status and new values

---

## 11. Open Questions & Future Work

### 11.1 Real Crash Data Availability

**Question:** Can we obtain validated crash sensor traces from academic research or insurance partners?

**Impact:** Without real crash data, we can only validate false positive rate, not true positive rate (sensitivity).

**Mitigation:** Literature-based thresholds are conservative estimates. Real-world deployment with incident reporting will eventually provide ground truth data.

### 11.2 Sensor Sample Rate Variability

**Observation:** Android sensor sample rates are inconsistent across devices and during high CPU load (see "Abnormal sample rate" warnings in logcat).

**Question:** Should we add sensor sample rate health checks and disable detection if sample rate falls below acceptable threshold?

**Proposed:** If average sample rate over 10 seconds > 60ms (vs target 20ms), log warning and suppress detection to avoid jerk calculation errors.

### 11.3 Multi-Device Validation

**Current Scope:** Initial validation on single test device (Pixel 7 or equivalent).

**Future Work:** Validate thresholds across:
- Low-end devices (slower CPUs, noisier sensors)
- Different mounting positions (handlebar vs pocket vs backpack)
- Different motorcycle types (sport bike vs cruiser vs scooter)

---

## 12. Next Steps (Immediate Actions)

1. **Create trace playback harness** (`crashDetectorTracePlayer.ts`)
   - Define JSON trace format
   - Implement file reader and CrashDetector feed logic
   - Add test runner that processes directory of traces

2. **Execute Phase 1 drop tests** (3-5 test scenarios)
   - Record sensor data for each drop
   - Verify zero false positives
   - Document peak acceleration/jerk values observed

3. **Schedule Phase 2 supervised test rides** (pending Phase 1 completion)
   - Identify test rider and support personnel
   - Secure test route with varied road conditions
   - Prepare first aid kit and emergency contact list

4. **Draft initial test report template** (docs/crash-validation-test-report.md)
   - Pre-populate with test scenario tables
   - Add data collection sections
   - Define pass/fail criteria checklist

**Protocol approval required before execution.** Review with full team and safety officer (if applicable).

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-08-15 | Guardian Angel Team | Initial draft |

---

**END OF PROTOCOL**
