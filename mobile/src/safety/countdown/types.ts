// mobile/src/safety/countdown/types.ts

export type CountdownState = 'IDLE' | 'RUNNING' | 'EXPIRED' | 'CANCELLED';

export interface CountdownConfig {
  durationMs: number;     // how long the rider has to respond before alert fires
  tickIntervalMs: number; // how often remaining time updates (for UI)
}

export const DEFAULT_COUNTDOWN_CONFIG: CountdownConfig = {
  durationMs: 30000,   // 30s, tune this with the team later
  tickIntervalMs: 1000, // update every second
};