/**
 * Ride Summary Contract & Telemetry Types
 * Guardian Angel - Core Screen #6 (Post-Ride Summary)
 */

export interface DownsampledSpeedPoint {
  /** Distance from start of ride in kilometers */
  distance_km: number;
  /** Speed at this waypoint in km/h */
  speed_kmh: number;
  /** Epoch timestamp of waypoint */
  timestamp_ms: number;
  /** Optional flag if speed exceeded safety threshold for route segment */
  is_speed_spike?: boolean;
}

/** A privacy-scoped point on the authenticated rider's recorded route. */
export interface SummaryRoutePoint {
  latitude: number;
  longitude: number;
  recorded_at_ms: number;
  /** Native speed when supplied by the device, otherwise geographic fallback. */
  speed_kmh: number | null;
  accuracy: number | null;
}

export interface PaceBenchmark {
  /** Expected duration in milliseconds based on standard group ride pace (~45 km/h) */
  expected_duration_ms: number;
  /** Human-readable pace benchmark explanation */
  benchmark_label: string;
  /** Delta in minutes compared to actual duration (positive = slower than benchmark) */
  delta_minutes: number;
}

export interface RideWeatherSnapshot {
  condition: string;
  temperature_celsius: number;
  precipitation_probability: number;
  wind_speed_kmh: number;
  fetched_at: string;
}

export type LowDataReason = 
  | 'SHORT_DISTANCE'
  | 'TELEMETRY_GAP'
  | 'SENSOR_UNAVAILABLE'
  | 'NONE';

export interface RideSummaryData {
  room_id: string;
  group_code: string;
  user_id: string;
  rider_name: string;
  start_time_ms: number;
  end_time_ms: number;
  total_distance_meters: number;
  actual_duration_ms: number;
  group_members_count: number;
  /** Bounded set of downsampled GPS points (typically 12-25 points) */
  speed_profile: DownsampledSpeedPoint[];
  pace_benchmark: PaceBenchmark | null;
  weather_snapshot: RideWeatherSnapshot | null;
  has_low_data: boolean;
  low_data_reason?: LowDataReason;
  /** Emergency alert flag if an SOS alert occurred during the ride session */
  had_emergency_alert?: boolean;
  /** Actual recorded route, chronologically ordered and bounded for map rendering. */
  route: SummaryRoutePoint[];
  average_moving_speed_kmh: number | null;
  max_filtered_speed_kmh: number | null;
  stopped_time_ms: number;
}
