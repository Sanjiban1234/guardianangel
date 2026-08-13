// mobile/src/safety/override/types.ts

export type OverrideResult = 'OVERRIDDEN' | 'NOT_APPLICABLE';

export interface OverrideDependencies {
  cancelCountdown: () => void;
  resetCrashDetector: () => void;
  getCountdownState: () => string; // 'IDLE' | 'RUNNING' | 'EXPIRED' | 'CANCELLED'
}