// mobile/src/safety/crash/types.ts

export interface AccelerometerReading {
  x: number;
  y: number;
  z: number;
  timestamp: number; // ms epoch
}

export type CrashDetectorState =
  | 'IDLE'
  | 'IMPACT_DETECTED'
  | 'CONFIRMING'
  | 'CRASH_CONFIRMED'
  | 'FALSE_POSITIVE';

export interface CrashDetectorConfig {
  impactThreshold: number;     // magnitude spike (m/s^2) that counts as impact
  stillnessThreshold: number;  // magnitude variance under which device is "still"
  confirmWindowMs: number;     // how long to watch after impact before confirming
  gravity: number;             // baseline gravity to subtract, ~9.8
}

export interface CrashEvent {
  detectedAt: number;
  peakMagnitude: number;
  reading: AccelerometerReading;
}

export const DEFAULT_CONFIG: CrashDetectorConfig = {
  impactThreshold: 25,   // ~2.5g spike, tune after real-world testing
  stillnessThreshold: 1.5,
  confirmWindowMs: 3000,
  gravity: 9.8,
};