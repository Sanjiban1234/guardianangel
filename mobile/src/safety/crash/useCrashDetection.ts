// mobile/src/safety/crash/useCrashDetection.ts
import { useEffect, useRef, useState } from 'react';
import { accelerometer, gyroscope, setUpdateIntervalForType, SensorTypes } from 'react-native-sensors';
import { CrashDetector } from './crashDetector';
import { CrashCandidateEvent, CrashDetectorState, TelemetryReading } from './types';

setUpdateIntervalForType(SensorTypes.accelerometer, 100);
setUpdateIntervalForType(SensorTypes.gyroscope, 100);

export function useCrashDetection(telemetryStream$?: { subscribe: (cb: (r: TelemetryReading) => void) => { unsubscribe: () => void } }) {
  const detectorRef = useRef(new CrashDetector());
  const [state, setState] = useState<CrashDetectorState>('IDLE');
  const [lastCandidate, setLastCandidate] = useState<CrashCandidateEvent | null>(null);

  useEffect(() => {
    const detector = detectorRef.current;
    const unsubState = detector.onStateChange(setState);
    const unsubCandidate = detector.onCandidate(setLastCandidate);

    const accelSub = accelerometer.subscribe(({ x, y, z, timestamp }) =>
      detector.feedAccelerometer({ x, y, z, timestamp })
    );
    const gyroSub = gyroscope.subscribe(({ x, y, z, timestamp }) =>
      detector.feedGyroscope({ x, y, z, timestamp })
    );
    const telemetrySub = telemetryStream$?.subscribe((r) => detector.feedTelemetry(r));

    return () => {
      accelSub.unsubscribe();
      gyroSub.unsubscribe();
      telemetrySub?.unsubscribe();
      unsubState();
      unsubCandidate();
    };
  }, [telemetryStream$]);

  const reset = () => detectorRef.current.reset();
  const setTrafficOverride = (active: boolean) => detectorRef.current.setTrafficOverride(active);

  return { state, lastCandidate, reset, setTrafficOverride };
}