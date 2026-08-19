/**
 * Service & React Hook to fetch live Ride Summary data from backend REST endpoint
 * `GET /api/rooms/:groupCode/summary` & `GET /api/rooms/:groupCode/history`
 */

import { useState, useEffect } from 'react';
import { RideSummaryData } from '../../../contracts/ride-summary';
import { API_BASE_URL } from '../config/env';

export async function fetchRideSummaryFromBackend(
  groupCode: string,
  authToken: string,
  apiBaseUrl: string = API_BASE_URL
): Promise<RideSummaryData> {
  const response = await fetch(`${apiBaseUrl}/api/rooms/${groupCode}/summary`, {
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ride summary: ${response.statusText}`);
  }

  const rawSummary = await response.json();

  const actualDurationMs = rawSummary.duration_ms || 0;

  // Fetch group members count
  let groupMembersCount = 0;
  try {
    const membersResponse = await fetch(`${apiBaseUrl}/api/rooms/${groupCode}/history`, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
    });
    if (membersResponse.ok) {
      const historyData = await membersResponse.json();
      // Count unique user_ids from history
      const uniqueUsers = new Set(historyData.map((reading: any) => reading.user_id));
      groupMembersCount = uniqueUsers.size;
    }
  } catch {
    // If we can't fetch members, default to 0
  }

  return {
    room_id: rawSummary.room_id || '',
    group_code: groupCode,
    user_id: rawSummary.user_id || '',
    rider_name: '', // Will be set by parent component from auth state
    start_time_ms: Date.now() - actualDurationMs,
    end_time_ms: Date.now(),
    total_distance_meters: rawSummary.total_distance_meters || 0,
    actual_duration_ms: actualDurationMs,
    group_members_count: groupMembersCount,
    // This endpoint does not currently return a telemetry profile or a
    // server-calculated benchmark, so the UI must present both as unavailable.
    speed_profile: [],
    pace_benchmark: null,
    weather_snapshot: null,
    has_low_data: true,
    low_data_reason: 'NONE',
  };
}

export function useRideSummary(groupCode: string, authToken: string, apiBaseUrl?: string) {
  const [data, setData] = useState<RideSummaryData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    fetchRideSummaryFromBackend(groupCode, authToken, apiBaseUrl)
      .then(result => {
        if (isMounted) {
          setData(result);
          setLoading(false);
        }
      })
      .catch(err => {
        if (isMounted) {
          setError(err.message || 'Failed to load ride summary');
          setLoading(false);
        }
      });

    return () => { isMounted = false; };
  }, [groupCode, authToken, apiBaseUrl]);

  return { data, loading, error };
}

