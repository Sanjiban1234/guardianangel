# Crash Detection Threshold Validation Test Report

**Status:** In Progress  
**Report Date:** _TBD_  
**Test Period:** _TBD_  
**Protocol Version:** 1.0  
**Testers:** _TBD_

---

## Executive Summary

<!-- After testing is complete, provide 2-3 paragraph summary of:
- Number of test scenarios executed
- Overall pass/fail status (Gate 1, 2, 3)
- Key findings and threshold adjustments made
- Recommendation for proceeding to supervised road testing -->

**Overall Status:** _PENDING TESTING_

**Gates:**
- [ ] Gate 1: Bench Test Pass
- [ ] Gate 2: Baseline False Positive Threshold
- [ ] Gate 3: Speed Gate Validation

---

## Test Environment

### Devices
| Device | Model | Android Version | App Version | Notes |
|--------|-------|-----------------|-------------|-------|
| Device 1 | _e.g. Pixel 7_ | _e.g. 15_ | _1.0.0-debug_ | _Primary test device_ |
| Device 2 | _e.g. Samsung Galaxy S23_ | _e.g. 14_ | _1.0.0-debug_ | _Secondary validation device_ |

### Threshold Configuration at Test Start
<!-- Copy DEFAULT_DETECTION_CONFIG values at beginning of test -->

| Parameter | Value | Unit |
|-----------|-------|------|
| `magnitudeThresholdG` | 4.0 | g-forces |
| `jerkThreshold` | 150 | m/s³ |
| `gyroRotationThresholdDegPerSec` | 250 | deg/s |
| `speedGateKmh` | 15 | km/h |
| `postEventWindowMs` | 4000 | ms |
| `stillnessThresholdG` | 0.3 | g-forces |
| `roughnessRatioThreshold` | 2.5 | ratio |
| `speedCrossCheckToleranceKmh` | 10 | km/h |
| `sensorSampleRateMs` | 20 | ms |
| `sensorSampleRateToleranceMs` | 30 | ms |
| `maxGapToleranceMs` | 100 | ms |
| `bufferDepthReadings` | 300 | count |
| `minBufferForDetection` | 50 | count |

---

## Phase 1: Controlled/Bench Testing

### 1.1 Low-Speed Drop Tests

| Test ID | Date | Device | Scenario | Expected | Actual | Peak Accel (g) | Peak Jerk (m/s³) | Peak Gyro (deg/s) | Speed (km/h) | Pass/Fail | Notes |
|---------|------|--------|----------|----------|--------|----------------|------------------|-------------------|--------------|-----------|-------|
| DS-01 | _TBD_ | _TBD_ | Drop from 1m onto foam mat | NO detection | _TBD_ | _TBD_ | _TBD_ | _TBD_ | 0.0 | _TBD_ | _Notes_ |
| DS-02 | _TBD_ | _TBD_ | Drop from 1.5m onto foam mat | NO detection | _TBD_ | _TBD_ | _TBD_ | _TBD_ | 0.0 | _TBD_ | _Notes_ |
| DS-03 | _TBD_ | _TBD_ | Handlebar mount drop from 1m at 0 km/h | NO detection | _TBD_ | _TBD_ | _TBD_ | _TBD_ | 0.0 | _TBD_ | _Notes_ |
| DS-04 | _TBD_ | _TBD_ | Handlebar mount drop from 1.5m at 0 km/h | NO detection | _TBD_ | _TBD_ | _TBD_ | _TBD_ | 0.0 | _TBD_ | _Notes_ |
| DS-05 | _TBD_ | _TBD_ | Stationary vehicle shake (vigorous) | NO detection | _TBD_ | _TBD_ | _TBD_ | _TBD_ | 0.0 | _TBD_ | _Notes_ |

**Phase 1.1 Result:** _TBD_ (_X/5 tests passed_)

**False Positives:** _TBD_

**Action Required:** _If any false positives, increase `magnitudeThresholdG` or `speedGateKmh`_

---

### 1.2 Shake Rig / Vibration Tests

| Test ID | Date | Device | Scenario | Expected | Actual | Peak Accel (g) | Peak Jerk (m/s³) | Duration (s) | Pass/Fail | Notes |
|---------|------|--------|----------|----------|--------|----------------|------------------|--------------|-----------|-------|
| SR-01 | _TBD_ | _TBD_ | Engine running, mild handlebar shake | NO detection | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _Notes_ |
| SR-02 | _TBD_ | _TBD_ | Engine running, aggressive handlebar shake | NO detection | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _Notes_ |
| SR-03 | _TBD_ | _TBD_ | Engine off, handlebar drop from 10cm | NO detection | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _Notes_ |

**Phase 1.2 Result:** _TBD_ (_X/3 tests passed_)

**False Positives:** _TBD_

---

### 1.3 Recorded Sensor Trace Playback

| Trace ID | Ground Truth | Detected | False Positive | False Negative | Peak Accel (g) | Peak Jerk (m/s³) | Peak Gyro (deg/s) | Speed (km/h) | Notes |
|----------|--------------|----------|----------------|----------------|----------------|------------------|-------------------|--------------|-------|
| example-pothole-40kmh | not_a_crash | _TBD_ | _TBD_ | N/A | _TBD_ | _TBD_ | _TBD_ | 40.0 | _Example trace_ |
| example-lowside-crash-30kmh | crash | _TBD_ | N/A | _TBD_ | _TBD_ | _TBD_ | _TBD_ | 30.0 | _Example trace_ |
| _Add more traces as collected_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ |

**Phase 1.3 Result:**
- Total Traces: _TBD_
- Crash Traces: _TBD_
- Non-Crash Traces: _TBD_
- False Positive Rate: _TBD%_
- True Positive Rate: _TBD%_ (if crash traces available)

**Acceptance:** _False positive rate < 5%_

**Status:** _TBD_

---

## Phase 2: Baseline False Positive Collection

### 2.1 Normal Riding Scenarios

| Test ID | Date | Rider | Scenario | Duration (min) | Speed Range (km/h) | Detections | False Positives | Pass/Fail | Notes |
|---------|------|-------|----------|----------------|--------------------|-----------|-----------------|-----------| ------|
| NR-01 | _TBD_ | _TBD_ | City riding (smooth roads) | 30 | 20-40 | _TBD_ | _TBD_ | _TBD_ | _Notes_ |
| NR-02 | _TBD_ | _TBD_ | City riding (pothole-heavy roads) | 30 | 20-40 | _TBD_ | _TBD_ | _TBD_ | _Notes_ |
| NR-03 | _TBD_ | _TBD_ | Highway riding (smooth) | 30 | 60-80 | _TBD_ | _TBD_ | _TBD_ | _Notes_ |
| NR-04 | _TBD_ | _TBD_ | Speed bump traversal (10 bumps) | 10 | 10-20 | _TBD_ | _TBD_ | _TBD_ | _Notes_ |
| NR-05 | _TBD_ | _TBD_ | Emergency braking (5 tests) | 5 | 40-0 | _TBD_ | _TBD_ | _TBD_ | _Notes_ |

**Total Test Ride Duration:** _TBD minutes_

**Total False Positives:** _TBD_

**False Positive Rate:** _TBD per 100 ride-minutes_ (Target: < 1%)

**Phase 2.1 Result:** _TBD_

---

### 2.2 Edge Case Scenarios

| Test ID | Date | Scenario | Expected Outcome | Actual Outcome | Pass/Fail | Notes |
|---------|------|----------|------------------|----------------|-----------|-------|
| EC-01 | _TBD_ | Phone drops out of pocket during ride (15+ km/h) | Detection MAY trigger | _TBD_ | _TBD_ | _Acceptable if detected_ |
| EC-02 | _TBD_ | Motorcycle tips over while stationary | NO detection | _TBD_ | _TBD_ | _Speed gate should block_ |
| EC-03 | _TBD_ | Abrupt stop on gravel (no crash) | NO detection | _TBD_ | _TBD_ | _Controlled decel_ |

**Phase 2.2 Result:** _TBD_

---

## Phase 3: Go/No-Go Criteria Assessment

### Gate 1: Bench Test Pass

- [ ] All drop tests (DS-01 to DS-05) produce zero false positives
- [ ] All shake rig tests (SR-01 to SR-03) produce zero false positives
- [ ] Recorded trace playback shows false positive rate < 5% on normal riding data

**Gate 1 Status:** _TBD_

**Decision:** _[ ] PASS [ ] FAIL_

**If FAILED, Actions Taken:**
- _List threshold adjustments made_
- _List additional tests conducted_

---

### Gate 2: Baseline False Positive Threshold

- [ ] Normal riding false positive rate < 1% over 2 hours of total supervised test rides
- [ ] Zero false positives during emergency braking tests (NR-05)

**Gate 2 Status:** _TBD_

**Decision:** _[ ] PASS [ ] FAIL_

**If FAILED, Actions Taken:**
- _List threshold re-tuning_
- _List repeat tests_

---

### Gate 3: Speed Gate Validation

- [ ] Detection correctly ignores all scenarios below `speedGateKmh` (15 km/h)
- [ ] Telemetry speed data is consistently available (no null speed readings for >10% of test ride duration)

**Gate 3 Status:** _TBD_

**Decision:** _[ ] PASS [ ] FAIL_

**If FAILED, Actions Taken:**
- _List GPS reliability improvements_
- _List speed gate logic adjustments_

---

## Final Go/No-Go Decision

**Proceed to Supervised Road Testing:** _[ ] YES [ ] NO_

**Decision Date:** _TBD_

**Decision Rationale:**
<!-- Provide 2-3 sentences explaining why testing should proceed or what blockers remain -->

**Approval Signatures:**
- Technical Lead: _____________________
- Safety Officer: _____________________
- Project Manager: _____________________

---

## Sensor Trace Statistics

<!-- After trace playback testing, populate with distribution statistics -->

### Non-Crash Traces (Normal Riding)

| Statistic | Min | Median | Max | Unit |
|-----------|-----|--------|-----|------|
| Peak Accel Magnitude | _TBD_ | _TBD_ | _TBD_ | g-forces |
| Peak Jerk | _TBD_ | _TBD_ | _TBD_ | m/s³ |
| Peak Gyro Rotation | _TBD_ | _TBD_ | _TBD_ | deg/s |
| Speed Range | _TBD_ | _TBD_ | _TBD_ | km/h |

### Crash Traces (If Available)

| Statistic | Min | Median | Max | Unit |
|-----------|-----|--------|-----|------|
| Peak Accel Magnitude | _TBD_ | _TBD_ | _TBD_ | g-forces |
| Peak Jerk | _TBD_ | _TBD_ | _TBD_ | m/s³ |
| Peak Gyro Rotation | _TBD_ | _TBD_ | _TBD_ | deg/s |
| Speed at Impact | _TBD_ | _TBD_ | _TBD_ | km/h |

---

## Threshold Adjustments Made

<!-- Document all threshold changes during testing with rationale -->

| Date | Parameter | Old Value | New Value | Rationale |
|------|-----------|-----------|-----------|-----------|
| _TBD_ | _e.g. magnitudeThresholdG_ | _4.0_ | _4.5_ | _False positive in DS-01, increased by 0.5g_ |
| _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ |

---

## Final Threshold Configuration

<!-- Copy final threshold values after all tuning is complete -->

| Parameter | Final Value | Unit | Change from Initial |
|-----------|-------------|------|---------------------|
| `magnitudeThresholdG` | _TBD_ | g-forces | _TBD_ |
| `jerkThreshold` | _TBD_ | m/s³ | _TBD_ |
| `gyroRotationThresholdDegPerSec` | _TBD_ | deg/s | _TBD_ |
| `speedGateKmh` | _TBD_ | km/h | _TBD_ |
| `postEventWindowMs` | _TBD_ | ms | _TBD_ |
| `stillnessThresholdG` | _TBD_ | g-forces | _TBD_ |
| `roughnessRatioThreshold` | _TBD_ | ratio | _TBD_ |
| `speedCrossCheckToleranceKmh` | _TBD_ | km/h | _TBD_ |

---

## Recommendations

### For Production Deployment
<!-- After testing completes, provide recommendations for production use -->

1. _TBD_
2. _TBD_
3. _TBD_

### For Future Validation Work
<!-- Suggest improvements to the protocol or additional tests -->

1. _TBD_
2. _TBD_
3. _TBD_

---

## Appendices

### Appendix A: Raw Test Logs
<!-- Link to raw test log files -->

- _docs/crash-validation-traces/test-logs/_

### Appendix B: Video Documentation
<!-- Link to video recordings of drop tests and test rides -->

- _TBD_

### Appendix C: Trace Playback Full Report
<!-- Attach output from generateFalsePositiveReport() -->

```
[Paste trace playback report output here]
```

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1 | 2026-08-15 | Guardian Angel Team | Initial template |

---

**END OF REPORT**
