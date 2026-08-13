// mobile/src/safety/override/useOverride.ts
import { useRef } from 'react';
import { OverrideController } from './overrideController';
import { OverrideDependencies } from './types';

export function useOverride(deps: OverrideDependencies) {
  const controllerRef = useRef(new OverrideController(deps));

  const trigger = () => controllerRef.current.trigger();

  return { trigger };
}