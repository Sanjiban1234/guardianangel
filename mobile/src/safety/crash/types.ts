// mobile/src/safety/crash/types.ts

export interface AccelerometerReading {
  x: number;
  y: number;
  z: number;
  timestamp: number;
}

export interface GyroscopeReading {
  x: number;
  y: number;
  z: number;
  timestamp: number;
}

export interface TelemetryReading {
  timestamp: number;
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null; // m/s, per telemetry contract
}

export type CrashDetectorState =
  | 'IDLE'
  | 'WATCHING_POST_EVENT' // spike seen, sampling roughness window
  | 'CANDIDATE_CONFIRMED'
  | 'REJECTED'; // spike happened but didn't clear all gates

export interface DetectionConfig {
  speedGateKmh: number; // min pre-event speed to even consider a candidate
  jerkThreshold: number; // m/s^3
  magnitudeThresholdG: number; // multiples of g
  gyroRotationThresholdDegPerSec: number;
  postEventWindowMs: number; // how long to watch after spike before deciding
  roughnessRatioThreshold: number; // path-length / net-displacement in speed
  speedCrossCheckToleranceKmh: number;
  gravity: number;
}

export const DEFAULT_DETECTION_CONFIG: DetectionConfig = {
  speedGateKmh: 15,
  jerkThreshold: 150, // tune against real data later
  magnitudeThresholdG: 4.0,
  gyroRotationThresholdDegPerSec: 250,
  postEventWindowMs: 4000,
  roughnessRatioThreshold: 2.5,
  speedCrossCheckToleranceKmh: 10,
  gravity: 9.8,
};

export interface CrashCandidateEvent {
  detectedAt: number;
  peakMagnitudeG: number;
  peakJerk: number;
  gyroRotationDegPerSec: number;
  roughnessRatio: number;
  triggerReading: AccelerometerReading;
}