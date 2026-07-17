// mobile/src/safety/crash/crashDetector.ts
import {
  AccelerometerReading,
  CrashDetectorConfig,
  CrashDetectorState,
  CrashEvent,
  DEFAULT_CONFIG,
} from './types';

type Listener = (event: CrashEvent) => void;
type StateListener = (state: CrashDetectorState) => void;

export class CrashDetector {
  private config: CrashDetectorConfig;
  private state: CrashDetectorState = 'IDLE';
  private buffer: AccelerometerReading[] = [];
  private impactPeak = 0;
  private impactReading: AccelerometerReading | null = null;
  private confirmTimer: ReturnType<typeof setTimeout> | null = null;

  private crashListeners: Listener[] = [];
  private stateListeners: StateListener[] = [];

  constructor(config: Partial<CrashDetectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  onCrashDetected(cb: Listener) {
    this.crashListeners.push(cb);
    return () => {
      this.crashListeners = this.crashListeners.filter((l) => l !== cb);
    };
  }

  onStateChange(cb: StateListener) {
    this.stateListeners.push(cb);
    return () => {
      this.stateListeners = this.stateListeners.filter((l) => l !== cb);
    };
  }

  getState(): CrashDetectorState {
    return this.state;
  }

  // Call this with every new sensor reading (real or mocked)
  feed(reading: AccelerometerReading) {
    this.buffer.push(reading);
    if (this.buffer.length > 50) this.buffer.shift(); // keep ~last few seconds

    const magnitude = this.computeMagnitude(reading);

    if (this.state === 'IDLE') {
      if (magnitude - this.config.gravity > this.config.impactThreshold) {
        this.transitionTo('IMPACT_DETECTED');
        this.impactPeak = magnitude;
        this.impactReading = reading;
        this.startConfirmWindow();
      }
      return;
    }

    if (this.state === 'IMPACT_DETECTED' || this.state === 'CONFIRMING') {
      if (magnitude > this.impactPeak) this.impactPeak = magnitude;
      if (this.state === 'IMPACT_DETECTED') this.transitionTo('CONFIRMING');
    }
  }

  // Reset back to IDLE — call this from the override/cancel button
  reset() {
    this.clearConfirmTimer();
    this.impactPeak = 0;
    this.impactReading = null;
    this.transitionTo('IDLE');
  }

  private startConfirmWindow() {
    this.clearConfirmTimer();
    this.confirmTimer = setTimeout(() => {
      this.evaluateAfterWindow();
    }, this.config.confirmWindowMs);
  }

  private evaluateAfterWindow() {
    const recentWindow = this.buffer.slice(-15); // last ~15 readings
    const variance = this.computeVariance(recentWindow);

    const isStillOrErratic =
      variance < this.config.stillnessThreshold || variance > this.config.impactThreshold;

    if (isStillOrErratic && this.impactReading) {
      this.transitionTo('CRASH_CONFIRMED');
      const event: CrashEvent = {
        detectedAt: Date.now(),
        peakMagnitude: this.impactPeak,
        reading: this.impactReading,
      };
      this.crashListeners.forEach((cb) => cb(event));
    } else {
      this.transitionTo('FALSE_POSITIVE');
      // auto-return to idle so the detector keeps watching
      setTimeout(() => this.reset(), 500);
    }
  }

  private computeMagnitude(r: AccelerometerReading): number {
    return Math.sqrt(r.x * r.x + r.y * r.y + r.z * r.z);
  }

  private computeVariance(readings: AccelerometerReading[]): number {
    if (readings.length === 0) return 0;
    const mags = readings.map((r) => this.computeMagnitude(r));
    const mean = mags.reduce((a, b) => a + b, 0) / mags.length;
    const sqDiffs = mags.map((m) => (m - mean) ** 2);
    return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / mags.length);
  }

  private clearConfirmTimer() {
    if (this.confirmTimer) {
      clearTimeout(this.confirmTimer);
      this.confirmTimer = null;
    }
  }

  private transitionTo(state: CrashDetectorState) {
    this.state = state;
    this.stateListeners.forEach((cb) => cb(state));
  }
}