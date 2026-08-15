import { CrashDetector } from '../crashDetector';
import type { DetectionConfig, CrashCandidateEvent, AccelerometerReading, GyroscopeReading } from '../types';
import type { TelemetryReading as TelemetryReadingContract } from '../../../telemetry/types';
import * as fs from 'fs';
import * as path from 'path';

export interface SensorReading {
  timestamp_ms: number;
  accel_x: number;
  accel_y: number;
  accel_z: number;
  gyro_x: number;
  gyro_y: number;
  gyro_z: number;
  speed_kmh: number;
  latitude: number;
  longitude: number;
  accuracy_meters: number;
}

export interface TraceFile {
  trace_id: string;
  scenario: string;
  ground_truth: 'crash' | 'not_a_crash';
  readings: SensorReading[];
}

export interface DetectionOutcome {
  trace_id: string;
  scenario: string;
  ground_truth: 'crash' | 'not_a_crash';
  detected: boolean;
  detection_timestamp_ms: number | null;
  false_positive: boolean;
  false_negative: boolean;
  peak_values: {
    accel_magnitude_g: number;
    jerk_m_s3: number;
    gyro_rotation_deg_s: number;
    speed_kmh: number;
  };
  candidate?: CrashCandidateEvent;
}

export interface TestResults {
  total_traces: number;
  crash_traces: number;
  non_crash_traces: number;
  true_positives: number;
  true_negatives: number;
  false_positives: number;
  false_negatives: number;
  false_positive_rate: number;
  true_positive_rate: number;
  accuracy: number;
  outcomes: DetectionOutcome[];
}

/**
 * Play a single sensor trace file through the crash detector
 */
export function playTraceFile(
  filePath: string,
  config?: Partial<DetectionConfig>
): DetectionOutcome {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const trace: TraceFile = JSON.parse(fileContent);

  const detector = new CrashDetector(config);
  let candidateDetected: CrashCandidateEvent | undefined = undefined;
  let detectionTimestamp: number | null = null;

  // Subscribe to candidate events
  const unsubscribe = detector.onCandidate((candidate: CrashCandidateEvent) => {
    if (!candidateDetected) {
      candidateDetected = candidate;
      detectionTimestamp = candidate.detectedAt;
    }
  });

  // Track peak values observed
  let peakAccelMagnitude = 0;
  let peakJerk = 0;
  let peakGyroRotation = 0;
  let maxSpeed = 0;

  // Feed each reading to the detector
  for (let i = 0; i < trace.readings.length; i++) {
    const reading = trace.readings[i];

    // Feed telemetry (GPS data)
    const telemetryReading = {
      timestamp: reading.timestamp_ms,
      latitude: reading.latitude,
      longitude: reading.longitude,
      accuracy: reading.accuracy_meters,
      speed: reading.speed_kmh / 3.6, // Convert km/h to m/s
    };

    // Feed accelerometer
    const accelReading: AccelerometerReading = {
      x: reading.accel_x,
      y: reading.accel_y,
      z: reading.accel_z,
      timestamp: reading.timestamp_ms,
    };

    // Feed gyroscope
    const gyroReading: GyroscopeReading = {
      x: reading.gyro_x,
      y: reading.gyro_y,
      z: reading.gyro_z,
      timestamp: reading.timestamp_ms,
    };

    detector.feedTelemetry(telemetryReading);
    detector.feedAccelerometer(accelReading);
    detector.feedGyroscope(gyroReading);

    // Track peaks
    const magnitude = Math.sqrt(
      reading.accel_x ** 2 + reading.accel_y ** 2 + reading.accel_z ** 2
    ) / 9.8;
    peakAccelMagnitude = Math.max(peakAccelMagnitude, magnitude);

    const gyroRotation = Math.sqrt(
      reading.gyro_x ** 2 + reading.gyro_y ** 2 + reading.gyro_z ** 2
    ) * (180 / Math.PI);
    peakGyroRotation = Math.max(peakGyroRotation, gyroRotation);

    maxSpeed = Math.max(maxSpeed, reading.speed_kmh);

    // Jerk calculation requires previous reading
    if (i > 0) {
      const prevReading = trace.readings[i - 1];
      const dt = (reading.timestamp_ms - prevReading.timestamp_ms) / 1000;
      if (dt > 0) {
        const accelDelta = Math.sqrt(
          (reading.accel_x - prevReading.accel_x) ** 2 +
          (reading.accel_y - prevReading.accel_y) ** 2 +
          (reading.accel_z - prevReading.accel_z) ** 2
        );
        const jerk = accelDelta / dt;
        peakJerk = Math.max(peakJerk, jerk);
      }
    }
  }

  // Unsubscribe from candidate events
  unsubscribe();

  const detected = candidateDetected !== undefined;
  const falsePositive = detected && trace.ground_truth === 'not_a_crash';
  const falseNegative = !detected && trace.ground_truth === 'crash';

  return {
    trace_id: trace.trace_id,
    scenario: trace.scenario,
    ground_truth: trace.ground_truth,
    detected,
    detection_timestamp_ms: detectionTimestamp,
    false_positive: falsePositive,
    false_negative: falseNegative,
    peak_values: {
      accel_magnitude_g: peakAccelMagnitude,
      jerk_m_s3: peakJerk,
      gyro_rotation_deg_s: peakGyroRotation,
      speed_kmh: maxSpeed,
    },
    candidate: candidateDetected,
  };
}

/**
 * Run all trace files in a directory
 */
export function runTraceDirectory(
  dirPath: string,
  config?: Partial<DetectionConfig>
): TestResults {
  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.json'));
  const outcomes: DetectionOutcome[] = [];

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const outcome = playTraceFile(filePath, config);
    outcomes.push(outcome);
  }

  const crashTraces = outcomes.filter(o => o.ground_truth === 'crash');
  const nonCrashTraces = outcomes.filter(o => o.ground_truth === 'not_a_crash');

  const truePositives = outcomes.filter(
    o => o.ground_truth === 'crash' && o.detected
  ).length;
  const trueNegatives = outcomes.filter(
    o => o.ground_truth === 'not_a_crash' && !o.detected
  ).length;
  const falsePositives = outcomes.filter(o => o.false_positive).length;
  const falseNegatives = outcomes.filter(o => o.false_negative).length;

  const falsePositiveRate = nonCrashTraces.length > 0
    ? falsePositives / nonCrashTraces.length
    : 0;
  const truePositiveRate = crashTraces.length > 0
    ? truePositives / crashTraces.length
    : 0;
  const accuracy = outcomes.length > 0
    ? (truePositives + trueNegatives) / outcomes.length
    : 0;

  return {
    total_traces: outcomes.length,
    crash_traces: crashTraces.length,
    non_crash_traces: nonCrashTraces.length,
    true_positives: truePositives,
    true_negatives: trueNegatives,
    false_positives: falsePositives,
    false_negatives: falseNegatives,
    false_positive_rate: falsePositiveRate,
    true_positive_rate: truePositiveRate,
    accuracy,
    outcomes,
  };
}

/**
 * Generate a human-readable false positive report
 */
export function generateFalsePositiveReport(results: TestResults): string {
  const lines: string[] = [];

  lines.push('='.repeat(80));
  lines.push('CRASH DETECTION TRACE VALIDATION REPORT');
  lines.push('='.repeat(80));
  lines.push('');
  lines.push(`Total Traces: ${results.total_traces}`);
  lines.push(`  - Crash Traces: ${results.crash_traces}`);
  lines.push(`  - Non-Crash Traces: ${results.non_crash_traces}`);
  lines.push('');
  lines.push('RESULTS:');
  lines.push(`  True Positives:  ${results.true_positives} (crash correctly detected)`);
  lines.push(`  True Negatives:  ${results.true_negatives} (non-crash correctly ignored)`);
  lines.push(`  False Positives: ${results.false_positives} (non-crash incorrectly detected)`);
  lines.push(`  False Negatives: ${results.false_negatives} (crash missed)`);
  lines.push('');
  lines.push('METRICS:');
  lines.push(`  False Positive Rate: ${(results.false_positive_rate * 100).toFixed(2)}%`);
  lines.push(`  True Positive Rate:  ${(results.true_positive_rate * 100).toFixed(2)}% (Sensitivity)`);
  lines.push(`  Accuracy:            ${(results.accuracy * 100).toFixed(2)}%`);
  lines.push('');

  if (results.false_positives > 0) {
    lines.push('FALSE POSITIVES (Non-crash scenarios incorrectly detected as crashes):');
    lines.push('-'.repeat(80));
    const falsePositives = results.outcomes.filter(o => o.false_positive);
    for (const outcome of falsePositives) {
      lines.push(`  [${outcome.trace_id}] ${outcome.scenario}`);
      lines.push(`    Peak Accel: ${outcome.peak_values.accel_magnitude_g.toFixed(2)}g`);
      lines.push(`    Peak Jerk: ${outcome.peak_values.jerk_m_s3.toFixed(2)} m/s³`);
      lines.push(`    Peak Gyro: ${outcome.peak_values.gyro_rotation_deg_s.toFixed(2)} deg/s`);
      lines.push(`    Speed: ${outcome.peak_values.speed_kmh.toFixed(2)} km/h`);
      lines.push(`    Detection Time: ${outcome.detection_timestamp_ms}ms`);
      lines.push('');
    }
  }

  if (results.false_negatives > 0) {
    lines.push('FALSE NEGATIVES (Crash scenarios missed):');
    lines.push('-'.repeat(80));
    const falseNegatives = results.outcomes.filter(o => o.false_negative);
    for (const outcome of falseNegatives) {
      lines.push(`  [${outcome.trace_id}] ${outcome.scenario}`);
      lines.push(`    Peak Accel: ${outcome.peak_values.accel_magnitude_g.toFixed(2)}g`);
      lines.push(`    Peak Jerk: ${outcome.peak_values.jerk_m_s3.toFixed(2)} m/s³`);
      lines.push(`    Peak Gyro: ${outcome.peak_values.gyro_rotation_deg_s.toFixed(2)} deg/s`);
      lines.push(`    Speed: ${outcome.peak_values.speed_kmh.toFixed(2)} km/h`);
      lines.push('');
    }
  }

  lines.push('='.repeat(80));
  lines.push(`VALIDATION STATUS: ${getValidationStatus(results)}`);
  lines.push('='.repeat(80));

  return lines.join('\n');
}

/**
 * Determine if validation criteria are met
 */
function getValidationStatus(results: TestResults): string {
  const fpRate = results.false_positive_rate;
  const tpRate = results.true_positive_rate;

  if (fpRate > 0.05) {
    return `FAIL - False positive rate ${(fpRate * 100).toFixed(2)}% exceeds 5% threshold`;
  }

  if (results.crash_traces > 0 && tpRate < 0.90) {
    return `FAIL - True positive rate ${(tpRate * 100).toFixed(2)}% below 90% threshold`;
  }

  if (results.false_positives > 0 && results.non_crash_traces > 0) {
    return `MARGINAL - ${results.false_positives} false positive(s) detected, review recommended`;
  }

  return 'PASS - Meets validation criteria (FPR < 5%, TPR > 90%)';
}

/**
 * Example usage:
 *
 * const outcome = playTraceFile('docs/crash-validation-traces/DS-01-20260815.json');
 * console.log(`Detection: ${outcome.detected}, False Positive: ${outcome.false_positive}`);
 *
 * const results = runTraceDirectory('docs/crash-validation-traces/');
 * console.log(generateFalsePositiveReport(results));
 */
