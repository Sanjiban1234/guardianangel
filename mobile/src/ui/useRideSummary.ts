import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '../config/env';

export interface RideSummaryData {
  room_id: string;
  group_code: string;
  user_id: string;
  total_distance_meters: number;
  actual_duration_ms: number;
}

export async function fetchRideSummaryFromBackend(
  groupCode: string,
  authToken: string,
  apiBaseUrl: string = API_BASE_URL,
): Promise<RideSummaryData> {
  const response = await fetch(`${apiBaseUrl}/api/rooms/${groupCode}/summary`, {
    headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
  });
  if (!response.ok) throw new Error(`Failed to fetch ride summary: ${response.statusText}`);

  const rawSummary = await response.json();
  const totalDistanceMeters = Number(rawSummary.total_distance_meters);
  const actualDurationMs = Number(rawSummary.duration_ms);
  if (!rawSummary.room_id || !rawSummary.user_id || !Number.isFinite(totalDistanceMeters) || !Number.isFinite(actualDurationMs)) {
    throw new Error('The server returned an incomplete ride summary.');
  }
  return {
    room_id: rawSummary.room_id,
    group_code: groupCode,
    user_id: rawSummary.user_id,
    total_distance_meters: totalDistanceMeters,
    actual_duration_ms: actualDurationMs,
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
