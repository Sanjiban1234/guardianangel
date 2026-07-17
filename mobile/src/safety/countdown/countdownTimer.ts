// mobile/src/safety/countdown/countdownTimer.ts
import { CountdownConfig, CountdownState, DEFAULT_COUNTDOWN_CONFIG } from './types';

type TickListener = (remainingMs: number) => void;
type ExpireListener = () => void;
type StateListener = (state: CountdownState) => void;

export class CountdownTimer {
  private config: CountdownConfig;
  private state: CountdownState = 'IDLE';
  private remainingMs = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  private tickListeners: TickListener[] = [];
  private expireListeners: ExpireListener[] = [];
  private stateListeners: StateListener[] = [];

  constructor(config: Partial<CountdownConfig> = {}) {
    this.config = { ...DEFAULT_COUNTDOWN_CONFIG, ...config };
  }

  onTick(cb: TickListener) {
    this.tickListeners.push(cb);
    return () => {
      this.tickListeners = this.tickListeners.filter((l) => l !== cb);
    };
  }

  onExpire(cb: ExpireListener) {
    this.expireListeners.push(cb);
    return () => {
      this.expireListeners = this.expireListeners.filter((l) => l !== cb);
    };
  }

  onStateChange(cb: StateListener) {
    this.stateListeners.push(cb);
    return () => {
      this.stateListeners = this.stateListeners.filter((l) => l !== cb);
    };
  }

  getState(): CountdownState {
    return this.state;
  }

  getRemainingMs(): number {
    return this.remainingMs;
  }

  // Call this when a crash is confirmed
  start() {
    if (this.state === 'RUNNING') return; // already running, no-op

    this.remainingMs = this.config.durationMs;
    this.transitionTo('RUNNING');
    this.emitTick();

    this.intervalId = setInterval(() => {
      this.remainingMs -= this.config.tickIntervalMs;

      if (this.remainingMs <= 0) {
        this.remainingMs = 0;
        this.clearTimer();
        this.transitionTo('EXPIRED');
        this.emitTick();
        this.expireListeners.forEach((cb) => cb());
      } else {
        this.emitTick();
      }
    }, this.config.tickIntervalMs);
  }

  // Call this from the override / "I'm okay" button
  cancel() {
    if (this.state !== 'RUNNING') return; // nothing to cancel
    this.clearTimer();
    this.transitionTo('CANCELLED');
  }

  // Call this to fully reset back to IDLE (e.g. after handling CANCELLED/EXPIRED)
  reset() {
    this.clearTimer();
    this.remainingMs = 0;
    this.transitionTo('IDLE');
  }

  private emitTick() {
    this.tickListeners.forEach((cb) => cb(this.remainingMs));
  }

  private clearTimer() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private transitionTo(state: CountdownState) {
    this.state = state;
    this.stateListeners.forEach((cb) => cb(state));
  }
}