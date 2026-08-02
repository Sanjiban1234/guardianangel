/**
 * Guardian Angel - Core Screen #6: Post-Ride Summary Screen
 * 
 * DESIGN SPECIFICATION & PERSON 4 IMPLEMENTATION NOTES:
 * ----------------------------------------------------
 * 1. CHART INTERACTION MODEL:
 *    - Chart is static (non-zoomable) by default. The backend returns a downsampled
 *      array of 12-25 points (bounded telemetry). No heavy scrubbing required.
 *    - Tapping a node in the chart highlights the distance (km) and speed (km/h) at that point.
 * 
 * 2. EXPECTED TIME vs. ACTUAL TIME:
 *    - Framed post-hoc as "Pace Benchmark (45 km/h group avg)".
 *    - Never presented as a predictive ETA to avoid deceptive precision.
 * 
 * 3. GRACEFUL LOW-DATA FALLBACKS:
 *    - If total_distance_meters < 500 or speed_profile.length < 3, `has_low_data` is set.
 *    - Shows calm, non-disruptive banner explaining the telemetry gap instead of empty chart.
 * 
 * 4. COLOR PALETTE ADHERENCE:
 *    - `#14532D` (Primary Forest Green) — Card headers, structural accents
 *    - `#16A34A` (Success Green) — Completion badge, normal pace indicators
 *    - `#2F80ED` (Active Blue) — Route markers & speed profile track line
 *    - `#F59E0B` (Warning Amber) — Speed spikes (> threshold) & low telemetry warnings
 *    - `#DC2626` (Emergency Red) — Emergency alert callouts (only if SOS occurred during ride)
 */

import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Dimensions,
} from 'react-native';
import {
  RideSummaryData,
  DownsampledSpeedPoint,
} from '../../../contracts/ride-summary';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Default sample mock data for testing/previewing full populated state
export const MOCK_FULL_RIDE_SUMMARY: RideSummaryData = {
  room_id: 'rm-99201-ph',
  group_code: 'GA-8821',
  user_id: 'usr-102',
  rider_name: 'Alex Vance',
  start_time_ms: Date.now() - 4320000, // ~1 hr 12 mins ago
  end_time_ms: Date.now(),
  total_distance_meters: 48200, // 48.2 km
  actual_duration_ms: 4320000, // 1h 12m (72 mins)
  group_members_count: 4,
  speed_profile: [
    { distance_km: 0, speed_kmh: 0, timestamp_ms: Date.now() - 4320000 },
    { distance_km: 4.2, speed_kmh: 38, timestamp_ms: Date.now() - 4000000 },
    { distance_km: 9.8, speed_kmh: 52, timestamp_ms: Date.now() - 3600000 },
    { distance_km: 15.1, speed_kmh: 48, timestamp_ms: Date.now() - 3200000 },
    { distance_km: 21.0, speed_kmh: 64, timestamp_ms: Date.now() - 2800000 },
    { distance_km: 28.4, speed_kmh: 59, timestamp_ms: Date.now() - 2400000 },
    { distance_km: 34.2, speed_kmh: 84, timestamp_ms: Date.now() - 1900000, is_speed_spike: true },
    { distance_km: 39.0, speed_kmh: 45, timestamp_ms: Date.now() - 1400000 },
    { distance_km: 44.5, speed_kmh: 32, timestamp_ms: Date.now() - 800000 },
    { distance_km: 48.2, speed_kmh: 0, timestamp_ms: Date.now() },
  ],
  pace_benchmark: {
    expected_duration_ms: 3840000, // 1h 04m (64 mins)
    benchmark_label: '45 km/h standard group pace',
    delta_minutes: 8, // +8 mins slower due to traffic/regroup stops
  },
  weather_snapshot: {
    condition: 'Clear Sky',
    temperature_celsius: 24.5,
    precipitation_probability: 0,
    wind_speed_kmh: 14.2,
    fetched_at: new Date().toISOString(),
  },
  has_low_data: false,
  had_emergency_alert: false,
};

// Default sample mock data for low-data / telemetry gap state
export const MOCK_LOW_DATA_RIDE_SUMMARY: RideSummaryData = {
  room_id: 'rm-99202-ph',
  group_code: 'GA-3304',
  user_id: 'usr-102',
  rider_name: 'Alex Vance',
  start_time_ms: Date.now() - 300000, // 5 mins ago
  end_time_ms: Date.now(),
  total_distance_meters: 350, // 350 meters (under 500m threshold)
  actual_duration_ms: 300000,
  group_members_count: 3,
  speed_profile: [
    { distance_km: 0, speed_kmh: 0, timestamp_ms: Date.now() - 300000 },
    { distance_km: 0.35, speed_kmh: 12, timestamp_ms: Date.now() },
  ],
  pace_benchmark: null,
  weather_snapshot: null,
  has_low_data: true,
  low_data_reason: 'SHORT_DISTANCE',
  had_emergency_alert: false,
};

interface RideSummaryScreenProps {
  data?: RideSummaryData;
  onReturnToPortal?: () => void;
  onExportGpx?: () => void;
}

export const RideSummaryScreen: React.FC<RideSummaryScreenProps> = ({
  data = MOCK_FULL_RIDE_SUMMARY,
  onReturnToPortal,
  onExportGpx,
}) => {
  const [selectedPoint, setSelectedPoint] = useState<DownsampledSpeedPoint | null>(null);

  // Formatting helpers
  const formatDistance = (meters: number) => {
    if (meters < 1000) return `${meters} m`;
    return `${(meters / 1000).toFixed(1)} km`;
  };

  const formatDuration = (ms: number) => {
    const totalMinutes = Math.round(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hours === 0) return `${mins}m`;
    return `${hours}h ${mins}m`;
  };

  const maxSpeed = data.speed_profile.reduce(
    (max, pt) => Math.max(max, pt.speed_kmh),
    0
  );

  const speedSpikeCount = data.speed_profile.filter(p => p.is_speed_spike).length;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0B130E" />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* 1. TOP STATUS BANNER (Asymmetric Hero Block) */}
        <View style={styles.heroBlock}>
          <View style={styles.statusBadgeRow}>
            <View style={styles.statusPill}>
              <View style={styles.successDot} />
              <Text style={styles.statusPillText}>RIDE COMPLETED SAFELY</Text>
            </View>
            <Text style={styles.groupCodeText}>ROOM #{data.group_code}</Text>
          </View>

          <Text style={styles.heroTitle}>Post-Ride Summary</Text>
          <Text style={styles.heroSubtitle}>
            Group Ride with {data.group_members_count} Riders • Recorded Telemetry
          </Text>

          {data.had_emergency_alert && (
            <View style={styles.emergencyNoticeBanner}>
              <Text style={styles.emergencyNoticeTitle}>SOS Incident Recorded</Text>
              <Text style={styles.emergencyNoticeBody}>
                An emergency alert was triggered during this session and successfully resolved by your group.
              </Text>
            </View>
          )}
        </View>

        {/* 2. CORE METRICS RHYTHM (Unequal Split: Distance vs Pace Benchmark) */}
        <View style={styles.metricsContainer}>
          {/* Main Hero Metric: Distance Covered */}
          <View style={styles.heroMetricCard}>
            <Text style={styles.metricCardLabel}>TOTAL DISTANCE COVERED</Text>
            <Text style={styles.distanceValueText}>
              {formatDistance(data.total_distance_meters)}
            </Text>
            <View style={styles.metricFooterRow}>
              <Text style={styles.metricFooterMeta}>
                Recorded via GPS telemetry
              </Text>
            </View>
          </View>

          {/* Time & Honest Pace Benchmark Card */}
          <View style={styles.paceBenchmarkCard}>
            <Text style={styles.metricCardLabel}>ACTUAL DURATION vs PACE BENCHMARK</Text>
            <View style={styles.timeComparisonRow}>
              <View style={styles.timeBox}>
                <Text style={styles.timeBoxLabel}>Actual Time</Text>
                <Text style={styles.timeBoxValue}>{formatDuration(data.actual_duration_ms)}</Text>
              </View>

              <View style={styles.timeDividerLine} />

              <View style={styles.timeBox}>
                <Text style={styles.timeBoxLabel}>Pace Benchmark</Text>
                {data.pace_benchmark ? (
                  <Text style={styles.timeBoxValue}>
                    {formatDuration(data.pace_benchmark.expected_duration_ms)}
                  </Text>
                ) : (
                  <Text style={styles.timeBoxUnavailable}>Unavailable</Text>
                )}
              </View>
            </View>

            {/* Honest Pace Explanation */}
            {data.pace_benchmark ? (
              <View style={styles.paceNoteBox}>
                <Text style={styles.paceNoteText}>
                  {data.pace_benchmark.delta_minutes > 0
                    ? `+${data.pace_benchmark.delta_minutes} mins vs standard pace (${data.pace_benchmark.benchmark_label}). Accounts for group regrouping stops.`
                    : `${Math.abs(data.pace_benchmark.delta_minutes)} mins faster than standard pace (${data.pace_benchmark.benchmark_label}).`}
                </Text>
              </View>
            ) : (
              <View style={styles.paceNoteBoxEmpty}>
                <Text style={styles.paceNoteTextEmpty}>
                  Short ride distance — pace comparison requires at least 1.0 km recorded data.
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* 3. SPEED PROFILE SECTION (Downsampled Chart or Graceful Low-Data State) */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeaderRow}>
            <View>
              <Text style={styles.sectionTitle}>Route Speed Profile</Text>
              <Text style={styles.sectionSubtitle}>
                Downsampled telemetry trace • Bounded GPS points
              </Text>
            </View>
            {!data.has_low_data && (
              <View style={styles.speedPeakBadge}>
                <Text style={styles.speedPeakText}>Max: {maxSpeed} km/h</Text>
              </View>
            )}
          </View>

          {data.has_low_data ? (
            /* Low-Data / Unavailable State Banner */
            <View style={styles.lowDataContainer}>
              <View style={styles.lowDataIconBox}>
                <Text style={styles.lowDataIconSymbol}>!</Text>
              </View>
              <Text style={styles.lowDataTitle}>Speed Chart Unavailable</Text>
              <Text style={styles.lowDataBody}>
                {data.low_data_reason === 'SHORT_DISTANCE'
                  ? 'Ride distance was under 500 meters. Speed profiles require a minimum route distance to generate meaningful telemetry graphs.'
                  : 'Telemetry signal gap detected during this session. Insufficient GPS waypoints to plot a complete route speed line.'}
              </Text>
            </View>
          ) : (
            /* Populated Speed Profile Chart Representation */
            <View style={styles.chartContainer}>
              <View style={styles.chartLegendRow}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: '#2F80ED' }]} />
                  <Text style={styles.legendLabel}>Normal Cruising</Text>
                </View>
                {speedSpikeCount > 0 && (
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: '#F59E0B' }]} />
                    <Text style={styles.legendLabel}>{speedSpikeCount} High Speed Spike</Text>
                  </View>
                )}
              </View>

              {/* Downsampled Telemetry Point Scrub Grid */}
              <View style={styles.chartPointsGrid}>
                {data.speed_profile.map((point, idx) => {
                  const isSelected = selectedPoint === point;
                  const isSpike = point.is_speed_spike;
                  const barHeight = Math.max(12, (point.speed_kmh / (maxSpeed || 1)) * 90);

                  return (
                    <TouchableOpacity
                      key={idx}
                      activeOpacity={0.7}
                      onPress={() => setSelectedPoint(isSelected ? null : point)}
                      style={styles.pointColumn}
                    >
                      <View style={styles.barWrapper}>
                        <View
                          style={[
                            styles.pointBar,
                            {
                              height: barHeight,
                              backgroundColor: isSpike ? '#F59E0B' : '#2F80ED',
                              borderColor: isSelected ? '#16A34A' : 'transparent',
                              borderWidth: isSelected ? 2 : 0,
                            },
                          ]}
                        />
                      </View>
                      <Text style={styles.pointDistanceLabel}>{point.distance_km}k</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Selected Point Tooltip Callout */}
              {selectedPoint ? (
                <View style={styles.tooltipBox}>
                  <Text style={styles.tooltipTitle}>Waypoint at {selectedPoint.distance_km} km</Text>
                  <Text style={styles.tooltipValue}>
                    Speed: <Text style={styles.tooltipHighlight}>{selectedPoint.speed_kmh} km/h</Text>
                    {selectedPoint.is_speed_spike ? ' (High speed segment)' : ''}
                  </Text>
                </View>
              ) : (
                <Text style={styles.chartInstructionText}>
                  Tap any waypoint bar above to inspect segment speed
                </Text>
              )}
            </View>
          )}
        </View>

        {/* 4. SIDEBAR & FUTURE-READY CONTEXT SLOTS (Group Context & Weather Snapshot) */}
        <View style={styles.secondaryGrid}>
          {/* Group Context Slot */}
          <View style={styles.secondaryCard}>
            <Text style={styles.secondaryCardTitle}>RIDE GROUP CONTEXT</Text>
            <View style={styles.groupMemberRow}>
              <View style={styles.avatarPill}>
                <Text style={styles.avatarText}>YOU</Text>
              </View>
              <View style={styles.groupMemberInfo}>
                <Text style={styles.groupMemberName}>{data.rider_name}</Text>
                <Text style={styles.groupMemberRole}>Completed session with {data.group_members_count - 1} other riders</Text>
              </View>
            </View>
            <View style={styles.v2NoteBox}>
              <Text style={styles.v2NoteText}>
                Group comparison pace: All {data.group_members_count} riders arrived safely.
              </Text>
            </View>
          </View>

          {/* Retrospective Weather Slot (matching Map screen weather space) */}
          <View style={styles.secondaryCard}>
            <Text style={styles.secondaryCardTitle}>RIDE CONDITIONS</Text>
            {data.weather_snapshot ? (
              <View style={styles.weatherRow}>
                <View style={styles.weatherBadge}>
                  <Text style={styles.weatherTempText}>{data.weather_snapshot.temperature_celsius}°C</Text>
                </View>
                <View style={styles.weatherInfo}>
                  <Text style={styles.weatherCondText}>{data.weather_snapshot.condition}</Text>
                  <Text style={styles.weatherMetaText}>
                    Wind {data.weather_snapshot.wind_speed_kmh} km/h • Precip {data.weather_snapshot.precipitation_probability}%
                  </Text>
                </View>
              </View>
            ) : (
              <View style={styles.weatherEmptyBox}>
                <Text style={styles.weatherEmptyText}>
                  Weather telemetry unavailable for this ride timeframe.
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* 5. ACTION BUTTONS (Concrete, Product-Specific CTAs) */}
        <View style={styles.actionContainer}>
          <TouchableOpacity
            style={styles.primaryActionButton}
            onPress={onReturnToPortal}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryActionText}>Return to Session Portal</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryActionButton}
            onPress={onExportGpx}
            activeOpacity={0.85}
          >
            <Text style={styles.secondaryActionText}>Export GPX Track Log</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B130E',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
  },
  // Hero Block
  heroBlock: {
    backgroundColor: '#142318',
    borderColor: '#1E3A28',
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  statusBadgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#14532D',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  successDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#16A34A',
    marginRight: 6,
  },
  statusPillText: {
    color: '#E2F7E9',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  groupCodeText: {
    color: '#2F80ED',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  heroTitle: {
    color: '#F0FDF4',
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  heroSubtitle: {
    color: '#8E9F93',
    fontSize: 13,
  },
  emergencyNoticeBanner: {
    marginTop: 14,
    backgroundColor: 'rgba(220, 38, 38, 0.15)',
    borderColor: '#DC2626',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  emergencyNoticeTitle: {
    color: '#F87171',
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 2,
  },
  emergencyNoticeBody: {
    color: '#FECACA',
    fontSize: 12,
  },

  // Metrics Section
  metricsContainer: {
    flexDirection: 'column',
    gap: 14,
    marginBottom: 16,
  },
  heroMetricCard: {
    backgroundColor: '#142318',
    borderColor: '#16A34A',
    borderLeftWidth: 4,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderTopColor: '#1E3A28',
    borderRightColor: '#1E3A28',
    borderBottomColor: '#1E3A28',
    borderRadius: 14,
    padding: 18,
  },
  metricCardLabel: {
    color: '#8E9F93',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  distanceValueText: {
    color: '#16A34A',
    fontSize: 38,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: -1,
  },
  metricFooterRow: {
    marginTop: 4,
  },
  metricFooterMeta: {
    color: '#5C7062',
    fontSize: 12,
  },

  // Pace Benchmark Card
  paceBenchmarkCard: {
    backgroundColor: '#142318',
    borderColor: '#1E3A28',
    borderWidth: 1,
    borderRadius: 14,
    padding: 18,
  },
  timeComparisonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 10,
  },
  timeBox: {
    flex: 1,
  },
  timeBoxLabel: {
    color: '#8E9F93',
    fontSize: 11,
    marginBottom: 2,
  },
  timeBoxValue: {
    color: '#F0FDF4',
    fontSize: 22,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  timeBoxUnavailable: {
    color: '#F59E0B',
    fontSize: 14,
    fontWeight: '600',
  },
  timeDividerLine: {
    width: 1,
    height: 36,
    backgroundColor: '#1E3A28',
    marginHorizontal: 16,
  },
  paceNoteBox: {
    backgroundColor: '#0F1A12',
    borderRadius: 8,
    padding: 10,
    marginTop: 4,
  },
  paceNoteText: {
    color: '#A3B8A8',
    fontSize: 12,
    lineHeight: 17,
  },
  paceNoteBoxEmpty: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: 8,
    padding: 10,
    marginTop: 4,
  },
  paceNoteTextEmpty: {
    color: '#FCD34D',
    fontSize: 12,
  },

  // Section Cards
  sectionCard: {
    backgroundColor: '#142318',
    borderColor: '#1E3A28',
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  sectionTitle: {
    color: '#F0FDF4',
    fontSize: 18,
    fontWeight: '700',
  },
  sectionSubtitle: {
    color: '#8E9F93',
    fontSize: 12,
    marginTop: 2,
  },
  speedPeakBadge: {
    backgroundColor: 'rgba(47, 128, 237, 0.15)',
    borderColor: '#2F80ED',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  speedPeakText: {
    color: '#60A5FA',
    fontSize: 12,
    fontWeight: '700',
  },

  // Low Data Banner
  lowDataContainer: {
    backgroundColor: '#0F1A12',
    borderColor: '#1E3A28',
    borderWidth: 1,
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
  },
  lowDataIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  lowDataIconSymbol: {
    color: '#F59E0B',
    fontSize: 18,
    fontWeight: '800',
  },
  lowDataTitle: {
    color: '#FCD34D',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  lowDataBody: {
    color: '#8E9F93',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },

  // Chart Layout
  chartContainer: {
    marginTop: 6,
  },
  chartLegendRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 14,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  legendLabel: {
    color: '#8E9F93',
    fontSize: 11,
  },
  chartPointsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 120,
    paddingTop: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1E3A28',
    paddingBottom: 8,
  },
  pointColumn: {
    alignItems: 'center',
    flex: 1,
  },
  barWrapper: {
    height: 90,
    justifyContent: 'flex-end',
    alignItems: 'center',
    width: '100%',
  },
  pointBar: {
    width: 14,
    borderRadius: 4,
  },
  pointDistanceLabel: {
    color: '#5C7062',
    fontSize: 10,
    marginTop: 6,
    fontFamily: 'monospace',
  },
  tooltipBox: {
    backgroundColor: '#0F1A12',
    borderColor: '#16A34A',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginTop: 12,
  },
  tooltipTitle: {
    color: '#16A34A',
    fontSize: 12,
    fontWeight: '700',
  },
  tooltipValue: {
    color: '#D1E7D6',
    fontSize: 12,
    marginTop: 2,
  },
  tooltipHighlight: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  chartInstructionText: {
    color: '#5C7062',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 12,
    fontStyle: 'italic',
  },

  // Secondary Grid
  secondaryGrid: {
    flexDirection: 'column',
    gap: 14,
    marginBottom: 20,
  },
  secondaryCard: {
    backgroundColor: '#142318',
    borderColor: '#1E3A28',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
  },
  secondaryCardTitle: {
    color: '#8E9F93',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  groupMemberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  avatarPill: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#14532D',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#E2F7E9',
    fontSize: 11,
    fontWeight: '800',
  },
  groupMemberInfo: {
    flex: 1,
  },
  groupMemberName: {
    color: '#F0FDF4',
    fontSize: 14,
    fontWeight: '700',
  },
  groupMemberRole: {
    color: '#8E9F93',
    fontSize: 12,
  },
  v2NoteBox: {
    backgroundColor: '#0F1A12',
    borderRadius: 8,
    padding: 8,
  },
  v2NoteText: {
    color: '#A3B8A8',
    fontSize: 11,
  },

  weatherRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  weatherBadge: {
    backgroundColor: 'rgba(47, 128, 237, 0.15)',
    borderColor: '#2F80ED',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 14,
  },
  weatherTempText: {
    color: '#60A5FA',
    fontSize: 18,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  weatherInfo: {
    flex: 1,
  },
  weatherCondText: {
    color: '#F0FDF4',
    fontSize: 14,
    fontWeight: '700',
  },
  weatherMetaText: {
    color: '#8E9F93',
    fontSize: 12,
    marginTop: 2,
  },
  weatherEmptyBox: {
    backgroundColor: '#0F1A12',
    borderRadius: 8,
    padding: 10,
  },
  weatherEmptyText: {
    color: '#5C7062',
    fontSize: 12,
  },

  // Actions
  actionContainer: {
    gap: 12,
  },
  primaryActionButton: {
    backgroundColor: '#16A34A',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionText: {
    color: '#0B130E',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  secondaryActionButton: {
    backgroundColor: '#142318',
    borderColor: '#1E3A28',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionText: {
    color: '#E2F7E9',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default RideSummaryScreen;
