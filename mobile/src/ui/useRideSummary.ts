import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '../config/env';
import { SummaryRoutePoint } from './rideSummaryRoute';

export interface RideSummaryData {
  room_id: string;
  group_code: string;
  user_id: string;
  total_distance_meters: number;
  actual_duration_ms: number;
  average_moving_speed_kmh: number | null;
  max_filtered_speed_kmh: number | null;
  stopped_time_ms: number;
  route: SummaryRoutePoint[];
  pace_benchmark: null;
}

export async function fetchRideSummaryFromBackend(
  groupCode: string,
  authToken: string,
  apiBaseUrl: string = API_BASE_URL,
): Promise<RideSummaryData> {
  console.log('[SUMMARY FETCH]');
  const response = await fetch(`${apiBaseUrl}/api/rooms/${groupCode}/summary`, {
    headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    console.warn(`[SUMMARY FETCH FAILURE] status=${response.status}`);
    throw new Error(`Failed to fetch ride summary: ${response.statusText}`);
  }

  const rawSummary = await response.json();
  const totalDistanceMeters = Number(rawSummary.total_distance_meters);
  const actualDurationMs = Number(rawSummary.duration_ms);
  if (!rawSummary.room_id || !rawSummary.user_id || !Number.isFinite(totalDistanceMeters) || !Number.isFinite(actualDurationMs)) {
    throw new Error('The server returned an incomplete ride summary.');
  }
  console.log('[SUMMARY FETCH SUCCESS]');
  return {
    room_id: rawSummary.room_id,
    group_code: groupCode,
    user_id: rawSummary.user_id,
    total_distance_meters: totalDistanceMeters,
    actual_duration_ms: actualDurationMs,
    average_moving_speed_kmh: Number.isFinite(Number(rawSummary.average_moving_speed_kmh)) ? Number(rawSummary.average_moving_speed_kmh) : null,
    max_filtered_speed_kmh: Number.isFinite(Number(rawSummary.max_filtered_speed_kmh)) ? Number(rawSummary.max_filtered_speed_kmh) : null,
    stopped_time_ms: Number.isFinite(Number(rawSummary.stopped_time_ms)) ? Number(rawSummary.stopped_time_ms) : 0,
    route: Array.isArray(rawSummary.route) ? rawSummary.route.filter((point: any) => Number.isFinite(point?.latitude) && Number.isFinite(point?.longitude) && Number.isFinite(point?.recorded_at_ms)) : [],
    pace_benchmark: null,
  };
}

export function useRideSummary(groupCode: string, authToken: string, apiBaseUrl?: string) {
  const [data, setData] = useState<RideSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);
  const retry = useCallback(() => setRequestVersion(version => version + 1), []);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);
    fetchRideSummaryFromBackend(groupCode, authToken, apiBaseUrl)
      .then(result => { if (isMounted) setData(result); })
      .catch(err => {
        if (isMounted) {
          setData(null);
          setError(err instanceof Error ? err.message : 'Failed to load ride summary');
        }
      })
      .finally(() => { if (isMounted) setLoading(false); });
    return () => { isMounted = false; };
  }, [groupCode, authToken, apiBaseUrl, requestVersion]);

  return { data, loading, error, retry };
}
