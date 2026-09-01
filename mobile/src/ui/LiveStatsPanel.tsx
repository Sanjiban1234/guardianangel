/**
 * @file LiveStatsPanel.tsx
 * @description Compact, expandable live ride statistics panel for the map screen.
 *
 * Design rules:
 * • Do not clutter the map — panel is collapsed by default (single row)
 * • Never fabricate a value: speed shows '-- km/h', ETA shows '--' when unavailable
 * • Derives ALL movement metrics from RideMetricsAccumulator — no separate calculations
 * • Derives ALL route-progress metrics from RouteProgressTracker — no speed-based ETA
 * • Does not make any network requests (network calls are in RouteProgressTracker)
 * • Follows existing Guardian Angel colour palette
 */

import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MetricsSnapshot } from '../telemetry/RideMetricsAccumulator';
import { RouteProgressSnapshot } from '../navigation/RouteProgressTracker';

// ─── Formatting helpers ──────────────────────────────────────────────────────

/** Formats metres-per-second to 'XX km/h', or '-- km/h' when unavailable. */
export function formatSpeed(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) {
    return '-- km/h';
  }
  return `${Math.round(ms * 3.6)} km/h`;
}

/** Formats metres to '0.0 km' or 'Xm'. */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '0 m';
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

/** Formats an optional distance in metres — returns '--' when unavailable. */
export function formatDistanceOptional(meters: number | null | undefined): string {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) return '--';
  if (meters < 0) return '--';
  return formatDistance(meters);
}

/** Formats milliseconds to '1h 23m' or '45m'. */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours === 0) return `${mins}m`;
  return `${hours}h ${mins}m`;
}

/** Formats milliseconds duration optionally — returns '--' when unavailable. */
export function formatDurationOptional(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '--';
  return formatDuration(ms);
}

/**
 * Formats an epoch-ms timestamp as a local time string (e.g. '10:42 AM').
 * Returns '--' when null.
 */
export function formatEta(etaMs: number | null | undefined): string {
  if (etaMs === null || etaMs === undefined || !Number.isFinite(etaMs) || etaMs <= 0) {
    return '--';
  }
  try {
    return new Date(etaMs).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '--';
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

interface LiveStatsPanelProps {
  /** Snapshot from RideMetricsAccumulator. Pass null when not in an active ride. */
  metrics: MetricsSnapshot | null;
  /**
   * Snapshot from RouteProgressTracker.
   * Pass null when no route is available (renders distance remaining / ETA as '--').
   */
  routeProgress?: RouteProgressSnapshot | null;
  /** Whether the panel starts expanded. Default: false. */
  initiallyExpanded?: boolean;
  /** Accessibility test ID for the container. */
  testID?: string;
}

export const LiveStatsPanel: React.FC<LiveStatsPanelProps> = ({
  metrics,
  routeProgress = null,
  initiallyExpanded = false,
  testID = 'live-stats-panel',
}) => {
  const [expanded, setExpanded] = useState(initiallyExpanded);

  if (!metrics) return null;

  const currentSpeed = formatSpeed(metrics.currentSpeedMs);
  const distance = formatDistance(metrics.distanceMeters);
  const duration = formatDuration(metrics.durationMs);
  const distanceRemaining = formatDistanceOptional(routeProgress?.distanceRemainingMeters);
  const eta = formatEta(routeProgress?.etaMs);

  return (
    <View style={styles.container} testID={testID}>
      {/* ── Collapsed row (always visible) ─────────────────────────── */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          expanded ? 'Collapse ride statistics' : 'Expand ride statistics'
        }
        onPress={() => setExpanded((v) => !v)}
        style={styles.collapsedRow}
        testID={`${testID}-toggle`}
      >
        <View style={styles.statChip}>
          <Text style={styles.chipLabel}>SPEED</Text>
          <Text style={styles.chipValue} testID={`${testID}-speed`}>
            {currentSpeed}
          </Text>
        </View>

        <View style={styles.separator} />

        <View style={styles.statChip}>
          <Text style={styles.chipLabel}>DIST</Text>
          <Text style={styles.chipValue} testID={`${testID}-distance`}>
            {distance}
          </Text>
        </View>

        <View style={styles.separator} />

        <View style={styles.statChip}>
          <Text style={styles.chipLabel}>TIME</Text>
          <Text style={styles.chipValue} testID={`${testID}-duration`}>
            {duration}
          </Text>
        </View>

        <View style={styles.separator} />

        <View style={styles.statChip}>
          <Text style={styles.chipLabel}>ETA</Text>
          <Text
            style={[
              styles.chipValue,
              eta === '--' && styles.chipValueUnavailable,
            ]}
            testID={`${testID}-eta`}
          >
            {eta}
          </Text>
        </View>

        <Text style={styles.expandIcon}>{expanded ? '▲' : '▼'}</Text>
      </Pressable>

      {/* ── Expanded panel ────────────────────────────────────────────── */}
      {expanded && (
        <View style={styles.expandedBody} testID={`${testID}-expanded`}>
          {/* Movement stats */}
          <SectionLabel label="SPEED" />
          <StatRow
            label="Current speed"
            value={currentSpeed}
            testID={`${testID}-current-speed`}
          />
          <StatRow
            label="Avg moving speed"
            value={formatSpeed(metrics.avgMovingSpeedMs)}
            testID={`${testID}-avg-speed`}
          />
          <StatRow
            label="Max speed"
            value={formatSpeed(metrics.maxSpeedMs)}
            testID={`${testID}-max-speed`}
          />

          <DividerLine />

          <SectionLabel label="JOURNEY" />
          <StatRow
            label="Distance travelled"
            value={distance}
            testID={`${testID}-distance-exp`}
          />
          <StatRow
            label="Distance remaining"
            value={distanceRemaining}
            unavailable={distanceRemaining === '--'}
            testID={`${testID}-distance-remaining`}
          />
          <StatRow
            label="Ride time"
            value={duration}
            testID={`${testID}-duration-exp`}
          />
          <StatRow
            label="ETA"
            value={eta}
            unavailable={eta === '--'}
            testID={`${testID}-eta-exp`}
          />

          <DividerLine />

          <SectionLabel label="STOPS" />
          <StatRow
            label="Stopped time"
            value={formatDuration(metrics.stoppedTimeMs)}
            testID={`${testID}-stopped`}
          />
        </View>
      )}
    </View>
  );
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const StatRow: React.FC<{
  label: string;
  value: string;
  unavailable?: boolean;
  testID?: string;
}> = ({ label, value, unavailable = false, testID }) => (
  <View style={styles.statRow}>
    <Text style={styles.statLabel}>{label}</Text>
    <Text
      style={[styles.statValue, unavailable && styles.statValueUnavailable]}
      testID={testID}
    >
      {value}
    </Text>
  </View>
);

const SectionLabel: React.FC<{ label: string }> = ({ label }) => (
  <Text style={styles.sectionLabel}>{label}</Text>
);

const DividerLine: React.FC = () => <View style={styles.divider} />;

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0F1A12',
    borderColor: '#1E3A28',
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  collapsedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  statChip: {
    flex: 1,
    alignItems: 'center',
  },
  chipLabel: {
    color: '#A3B8A8',
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  chipValue: {
    color: '#F0FDF4',
    fontSize: 13,
    fontWeight: '800',
    fontFamily: 'monospace',
    marginTop: 1,
  },
  chipValueUnavailable: {
    color: '#A3B8A8',
    fontWeight: '600',
  },
  separator: {
    width: 1,
    height: 28,
    backgroundColor: '#1E3A28',
  },
  expandIcon: {
    color: '#A3B8A8',
    fontSize: 10,
    fontWeight: '700',
    marginLeft: 4,
  },
  expandedBody: {
    borderTopWidth: 1,
    borderTopColor: '#1E3A28',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 4,
  },
  sectionLabel: {
    color: '#A3B8A8',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 2,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: '#1E3A28',
    marginVertical: 8,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3,
  },
  statLabel: {
    color: '#A3B8A8',
    fontSize: 13,
    fontWeight: '600',
  },
  statValue: {
    color: '#F0FDF4',
    fontSize: 13,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  statValueUnavailable: {
    color: '#A3B8A8',
    fontWeight: '600',
  },
});

export default LiveStatsPanel;
