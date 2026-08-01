// mobile/src/safety/crash/useCrashDetection.ts
import { useEffect, useRef, useState } from 'react';
import { accelerometer, setUpdateIntervalForType, SensorTypes } from 'react-native-sensors';
import { CrashDetector } from './crashDetector';
import { CrashDetectorState, CrashEvent } from './types';

setUpdateIntervalForType(SensorTypes.accelerometer, 100); // 10Hz

export function useCrashDetection() {
  const detectorRef = useRef(new CrashDetector());
  const [state, setState] = useState<CrashDetectorState>('IDLE');
  const [lastCrash, setLastCrash] = useState<CrashEvent | null>(null);

  useEffect(() => {
    const detector = detectorRef.current;
    const unsubState = detector.onStateChange(setState);
    const unsubCrash = detector.onCrashDetected(setLastCrash);

    const subscription = accelerometer.subscribe(({ x, y, z, timestamp }) => {
      detector.feed({ x, y, z, timestamp });
    });

    return () => {
      subscription.unsubscribe();
      unsubState();
      unsubCrash();
    };
  }, []);

  const override = () => detectorRef.current.reset();

  return { state, lastCrash, override };
}