import { useState, useCallback, useRef } from 'react';
import {
  LatLng,
  checkRouteDeviation,
  DEVIATION_CONFIG,
} from './routeUtils';

export interface UseRouteDeviationOptions {
  config?: typeof DEVIATION_CONFIG;
  onRouteUpdated?: (newRoute: LatLng[]) => void;
}

export function useRouteDeviation(options: UseRouteDeviationOptions = {}) {
  const config = options.config || DEVIATION_CONFIG;
  const [isRerouting, setIsRerouting] = useState(false);
  const [rerouteError, setRerouteError] = useState<string | null>(null);

  const deviationCountRef = useRef(0);
  const lastRerouteTimeRef = useRef(0);

  const evaluateAndReroute = useCallback(
    async <T extends { polyline: LatLng[] }>(
      currentLocation: { latitude: number; longitude: number; accuracy?: number } | null,
      destination: LatLng | null,
      currentRoute: LatLng[] | undefined,
      fetchRouteFn: (
        origin: LatLng,
        dest: LatLng,
      ) => Promise<T | null>,
    ): Promise<T | null> => {
      if (!currentLocation || !destination || !currentRoute || currentRoute.length < 2) {
        return null;
      }

      const evalResult = checkRouteDeviation(currentLocation, currentRoute, config);

      if (!evalResult.isDeviated) {
        deviationCountRef.current = 0;
        return null;
      }

      if (evalResult.ignoredDueToAccuracy) {
        return null;
      }

      deviationCountRef.current += 1;

      const now = Date.now();
      const timeSinceLastReroute = now - lastRerouteTimeRef.current;

      if (
        deviationCountRef.current >= config.REQUIRED_DEVIATION_SAMPLES &&
        timeSinceLastReroute >= config.REROUTE_COOLDOWN_MS
      ) {
        setIsRerouting(true);
        setRerouteError(null);
        lastRerouteTimeRef.current = now;

        try {
          const newRoute = await fetchRouteFn(
            { latitude: currentLocation.latitude, longitude: currentLocation.longitude },
            destination,
          );

          setIsRerouting(false);

          if (newRoute && newRoute.polyline.length >= 2) {
            deviationCountRef.current = 0;
            if (options.onRouteUpdated) {
              options.onRouteUpdated(newRoute.polyline);
            }
            return newRoute;
          } else {
            setRerouteError('Unable to recalculate route. Continuing with current map.');
            return null;
          }
        } catch {
          setIsRerouting(false);
          setRerouteError('Unable to recalculate route. Continuing with current map.');
          return null;
        }
      }

      return null;
    },
    [config, options],
  );

  const clearRerouteError = useCallback(() => {
    setRerouteError(null);
  }, []);

  return {
    isRerouting,
    rerouteError,
    evaluateAndReroute,
    clearRerouteError,
    deviationCount: deviationCountRef.current,
  };
}
