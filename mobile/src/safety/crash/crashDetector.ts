// mobile/src/safety/crash/crashDetector.ts
import {
  AccelerometerReading,
  CrashCandidateEvent,
  CrashDetectorState,
  DetectionConfig,
  DEFAULT_DETECTION_CONFIG,
  GyroscopeReading,
  TelemetryReading,
} from './types';
import {
  computeMagnitude,
  computeJerk,
  computeGyroRotation,
  computeSpeedRoughness,
  resolveSpeedKmh,
} from './signals';

type CandidateListener = (event: CrashCandidateEvent) => void;
type StateListener = (state: CrashDetectorState) => void;

export class CrashDetector {
  private config: DetectionConfig;
  private state: CrashDetectorState = 'IDLE';

  private accelBuffer: AccelerometerReading[] = [];
  private gyroBuffer: GyroscopeReading[] = [];
  private telemetryBuffer: TelemetryReading[] = [];

  private windowStartTs = 0;
  private windowGyro: GyroscopeReading[] = [];
  private windowSpeeds: number[] = [];
  private spikeReading: AccelerometerReading | null = null;
  private peakMagnitudeG = 0;
  private peakJerk = 0;

  private trafficOverrideActive = false;

  private candidateListeners: CandidateListener[] = [];
  private stateListeners: StateListener[] = [];

  constructor(config: Partial<DetectionConfig> = {}) {
    this.config = { ...DEFAULT_DETECTION_CONFIG, ...config };
  }

  onCandidate(cb: CandidateListener) {
    this.candidateListeners.push(cb);
    return () => (this.candidateListeners = this.candidateListeners.filter((l) => l !== cb));
  }

  onStateChange(cb: StateListener) {
    this.stateListeners.push(cb);
    return () => (this.stateListeners = this.stateListeners.filter((l) => l !== cb));
  }

  getState(): CrashDetectorState {
    return this.state;
  }

  // Manual Traffic Override: suppresses detection while active.
  setTrafficOverride(active: boolean) {
    this.trafficOverrideActive = active;
  }

  isTrafficOverrideActive(): boolean {
    return this.trafficOverrideActive;
  }

  feedAccelerometer(reading: AccelerometerReading) {
    this.accelBuffer.push(reading);
    if (this.accelBuffer.length > 100) this.accelBuffer.shift();

    if (this.trafficOverrideActive) return;

    if (this.state === 'IDLE') {
      this.checkForSpike(reading);
    } else if (this.state === 'WATCHING_POST_EVENT') {
      this.checkWindowComplete(reading.timestamp);
    }
  }

  feedGyroscope(reading: GyroscopeReading) {
    this.gyroBuffer.push(reading);
    if (this.gyroBuffer.length > 100) this.gyroBuffer.shift();
    if (this.state === 'WATCHING_POST_EVENT') this.windowGyro.push(reading);
  }

  feedTelemetry(reading: TelemetryReading) {
    this.telemetryBuffer.push(reading);
    if (this.telemetryBuffer.length > 100) this.telemetryBuffer.shift();

    if (this.state === 'WATCHING_POST_EVENT') {
      const speed = resolveSpeedKmh(
        this.telemetryBuffer,
        this.telemetryBuffer.length - 1,
        this.config.speedCrossCheckToleranceKmh
      );
      if (speed !== null) this.windowSpeeds.push(speed);
    }
  }

  reset() {
    this.state = 'IDLE';
    this.windowGyro = [];
    this.windowSpeeds = [];
    this.spikeReading = null;
    this.peakMagnitudeG = 0;
    this.peakJerk = 0;
    this.transitionTo('IDLE');
  }

  private checkForSpike(reading: AccelerometerReading) {
    if (this.accelBuffer.length < 2) return;

    const prev = this.accelBuffer[this.accelBuffer.length - 2];
    const jerk = computeJerk(prev, reading);
    const magnitudeG = computeMagnitude(reading) / this.config.gravity;

    const jerkOk = jerk > this.config.jerkThreshold;
    const magnitudeOk = magnitudeG > this.config.magnitudeThresholdG;
    const speedOk = this.currentSpeedGateOk();

    if (jerkOk && magnitudeOk && speedOk) {
      this.spikeReading = reading;
      this.peakMagnitudeG = magnitudeG;
      this.peakJerk = jerk;
      this.windowStartTs = reading.timestamp;
      this.windowGyro = [];
      this.windowSpeeds = [];
      this.transitionTo('WATCHING_POST_EVENT');
    }
  }

  private currentSpeedGateOk(): boolean {
    if (this.telemetryBuffer.length === 0) return false; // no plausible speed data, don't fire
    const speed = resolveSpeedKmh(
      this.telemetryBuffer,
      this.telemetryBuffer.length - 1,
      this.config.speedCrossCheckToleranceKmh
    );
    return speed !== null && speed >= this.config.speedGateKmh;
  }

  private checkWindowComplete(nowTs: number) {
    if (nowTs - this.windowStartTs < this.config.postEventWindowMs) return;

    const gyroRotation = computeGyroRotation(this.windowGyro);
    const roughness = computeSpeedRoughness(this.windowSpeeds);

    const gyroOk = gyroRotation > this.config.gyroRotationThresholdDegPerSec;
    const roughnessOk = roughness > this.config.roughnessRatioThreshold;

    if (gyroOk || roughnessOk) {
      const event: CrashCandidateEvent = {
        detectedAt: Date.now(),
        peakMagnitudeG: this.peakMagnitudeG,
        peakJerk: this.peakJerk,
        gyroRotationDegPerSec: gyroRotation,
        roughnessRatio: roughness,
        triggerReading: this.spikeReading!,
      };
      this.transitionTo('CANDIDATE_CONFIRMED');
      this.candidateListeners.forEach((cb) => cb(event));
    } else {
      this.transitionTo('REJECTED');
      setTimeout(() => this.reset(), 500);
    }
  }

  private transitionTo(state: CrashDetectorState) {
    this.state = state;
    this.stateListeners.forEach((cb) => cb(state));
  }
}