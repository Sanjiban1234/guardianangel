// mobile/src/safety/override/useOverride.ts
import { useMemo } from 'react';
import { OverrideController } from './overrideController';
import { OverrideDependencies } from './types';

export function useOverride(deps: OverrideDependencies) {
  // Recreate controller when deps change to avoid stale closure bug.
  // OverrideController's constructor is trivial (just stores deps), so
  // reconstruction on deps change is cheap and has no side effects.
  const controller = useMemo(() => new OverrideController(deps), [
    deps.getCountdownState,
    deps.cancelCountdown,
    deps.resetCrashDetector,
  ]);

  const trigger = () => controller.trigger();

  return { trigger };
}