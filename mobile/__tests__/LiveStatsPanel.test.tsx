/**
 * @file LiveStatsPanel.test.tsx
 * @description Unit and UI tests for LiveStatsPanel component using react-test-renderer.
 *
 * Tests cover:
 * - Rendering speed, distance, time, and ETA chips in collapsed mode
 * - Rendering expanded view with full breakdown (Speed, Journey, Stops)
 * - Unavailable metrics display '--' (speed '-- km/h', ETA '--', distance remaining '--')
 * - No misleading zero values displayed
 * - Toggling expand/collapse state
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {
  LiveStatsPanel,
  formatSpeed,
  formatDistance,
  formatDistanceOptional,
  formatDuration,
  formatDurationOptional,
  formatEta,
} from '../src/ui/LiveStatsPanel';
import { MetricsSnapshot } from '../src/telemetry/RideMetricsAccumulator';
import { RouteProgressSnapshot } from '../src/navigation/RouteProgressTracker';

const getText = (node: ReactTestRenderer.ReactTestInstance): string => {
  if (!node || !node.children) return '';
  return node.children
    .map(c => (typeof c === 'string' ? c : typeof c === 'number' ? String(c) : getText(c)))
    .join('');
};

const findByTestId = (tree: ReactTestRenderer.ReactTestRenderer, testID: string) => {
  return tree.root.findByProps({ testID });
};

describe('LiveStatsPanel', () => {
  const sampleMetrics: MetricsSnapshot = {
    durationMs: 34 * 60 * 1000, // 34 min
    distanceMeters: 12800, // 12.8 km
    currentSpeedMs: 42 / 3.6, // 42 km/h
    avgMovingSpeedMs: 35 / 3.6, // 35 km/h
    maxSpeedMs: 65 / 3.6, // 65 km/h
    stoppedTimeMs: 4 * 60 * 1000, // 4 min
    readingCount: 150,
  };

  const sampleRouteProgress: RouteProgressSnapshot = {
    distanceRemainingMeters: 18400, // 18.4 km
    durationRemainingMs: 25 * 60 * 1000,
    etaMs: 1772500000000, // fixed timestamp
    isInterpolated: true,
  };

  it('renders nothing when metrics is null', () => {
    let tree: ReactTestRenderer.ReactTestRenderer | undefined;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(<LiveStatsPanel metrics={null} />);
    });
    expect(tree?.toJSON()).toBeNull();
  });

  it('renders collapsed chips with speed, distance, duration, and ETA', () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <LiveStatsPanel
          metrics={sampleMetrics}
          routeProgress={sampleRouteProgress}
          testID="stats"
        />,
      );
    });

    const speed = findByTestId(tree, 'stats-speed');
    const dist = findByTestId(tree, 'stats-distance');
    const dur = findByTestId(tree, 'stats-duration');
    const eta = findByTestId(tree, 'stats-eta');

    expect(getText(speed)).toBe('42 km/h');
    expect(getText(dist)).toBe('12.8 km');
    expect(getText(dur)).toBe('34m');
    expect(getText(eta)).not.toBe('--');
    expect(getText(eta)).not.toBe('0');
  });

  it('renders "--" when speed and route ETA are unavailable (no fake 0s)', () => {
    const emptyMetrics: MetricsSnapshot = {
      durationMs: 0,
      distanceMeters: 0,
      currentSpeedMs: null,
      avgMovingSpeedMs: null,
      maxSpeedMs: null,
      stoppedTimeMs: 0,
      readingCount: 0,
    };

    let tree!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <LiveStatsPanel
          metrics={emptyMetrics}
          routeProgress={null}
          testID="stats"
        />,
      );
    });

    const speed = findByTestId(tree, 'stats-speed');
    const eta = findByTestId(tree, 'stats-eta');

    expect(getText(speed)).toBe('-- km/h');
    expect(getText(eta)).toBe('--');
  });

  it('expands to show full breakdown on toggle tap', () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <LiveStatsPanel
          metrics={sampleMetrics}
          routeProgress={sampleRouteProgress}
          testID="stats"
        />,
      );
    });

    // Expanded area should not exist yet
    expect(() => findByTestId(tree, 'stats-expanded')).toThrow();

    // Toggle expand
    const toggle = findByTestId(tree, 'stats-toggle');
    ReactTestRenderer.act(() => {
      toggle.props.onPress();
    });

    // Now expanded area exists
    const expanded = findByTestId(tree, 'stats-expanded');
    expect(expanded).toBeDefined();

    expect(getText(findByTestId(tree, 'stats-current-speed'))).toContain('42 km/h');
    expect(getText(findByTestId(tree, 'stats-avg-speed'))).toContain('35 km/h');
    expect(getText(findByTestId(tree, 'stats-max-speed'))).toContain('65 km/h');
    expect(getText(findByTestId(tree, 'stats-distance-remaining'))).toContain('18.4 km');
    expect(getText(findByTestId(tree, 'stats-stopped'))).toContain('4m');
  });
});
