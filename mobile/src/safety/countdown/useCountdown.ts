// mobile/src/safety/countdown/useCountdown.ts
import { useEffect, useRef, useState } from 'react';
import { CountdownTimer } from './countdownTimer';
import { CountdownConfig, CountdownState } from './types';

export function useCountdown(config?: Partial<CountdownConfig>) {
  const timerRef = useRef(new CountdownTimer(config));
  const [state, setState] = useState<CountdownState>('IDLE');
  const [remainingMs, setRemainingMs] = useState(0);

  useEffect(() => {
    const timer = timerRef.current;
    const unsubState = timer.onStateChange(setState);
    const unsubTick = timer.onTick(setRemainingMs);

    return () => {
      unsubState();
      unsubTick();
    };
  }, []);

  const start = () => timerRef.current.start();
  const cancel = () => timerRef.current.cancel();
  const reset = () => timerRef.current.reset();
  const onExpire = (cb: () => void) => timerRef.current.onExpire(cb);

  return { state, remainingMs, start, cancel, reset, onExpire };
}