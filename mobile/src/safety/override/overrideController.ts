// mobile/src/safety/override/overrideController.ts
import { OverrideDependencies, OverrideResult } from './types';

type OverrideListener = (result: OverrideResult) => void;

export class OverrideController {
  private deps: OverrideDependencies;
  private listeners: OverrideListener[] = [];

  constructor(deps: OverrideDependencies) {
    this.deps = deps;
  }

  onOverride(cb: OverrideListener) {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  // Call this from the "I'm okay" / override button
  trigger(): OverrideResult {
    const countdownState = this.deps.getCountdownState();

    if (countdownState !== 'RUNNING') {
      // Nothing to cancel — either no crash was detected, or the
      // countdown already expired and an alert may have gone out.
      const result: OverrideResult = 'NOT_APPLICABLE';
      this.listeners.forEach((cb) => cb(result));
      return result;
    }

    this.deps.cancelCountdown();
    this.deps.resetCrashDetector();

    const result: OverrideResult = 'OVERRIDDEN';
    this.listeners.forEach((cb) => cb(result));
    return result;
  }
}