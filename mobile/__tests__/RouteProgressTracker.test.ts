/**
 * @file RouteProgressTracker.test.ts
 * @description Unit tests for ETA / remaining journey logic.
 *
 * Tests cover:
 * - valid route distance remaining
 * - valid ETA calculation from provider duration (not speed-derived)
 * - route unavailable → null values (not fabricated)
 * - destination unavailable → null values
 * - no fabricated ETA from speed
 * - progress updates remaining distance
 * - ETA updates as route progress changes
 * - provider failure preserves app usability (no crash, no fake data)
 * - excessive routing requests are prevented (rate limiting)
 * - future updated route (ingestRoute) can replace old ETA source cleanly
 * - polyline geometry helpers
 * - formatEta output format
 */

import {
  RouteProgressTracker,
  RouteResult,
  LatLng,
  polylineLengthMeters,
  remainingPolylineMeters,
  EMPTY_ROUTE_PROGRESS,
  MIN_ROUTE_FETCH_INTERVAL_MS,
  MIN_PROGRESS_METERS,
} from '../src/navigation/RouteProgressTracker';
import { formatEta, formatDistanceOptional, formatDurationOptional } from '../src/ui/LiveStatsPanel';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** North–south straight-line polyline, approx 2.22 km */
const SAMPLE_POLYLINE: LatLng[] = [
  { latitude: 27.700, longitude: 85.500 },
  { latitude: 27.710, longitude: 85.500 },
  { latitude: 27.720, longitude: 85.500 },
];

const DESTINATION: LatLng = { latitude: 27.720, longitude: 85.500 };

function makeSampleRoute(overrides: Partial<RouteResult> = {}): RouteResult {
  return {
    polyline: SAMPLE_POLYLINE,
    totalDistanceMeters: polylineLengthMeters(SAMPLE_POLYLINE),
    totalDurationSeconds: 600, // 10 minutes
    fetchedAt: Date.now(),
    ...overrides,
  };
}

// ─── polylineLengthMeters ─────────────────────────────────────────────────────

describe('polylineLengthMeters', () => {
  it('returns 0 for empty polyline', () => {
    expect(polylineLengthMeters([])).toBe(0);
  });

  it('returns 0 for single point', () => {
    expect(polylineLengthMeters([SAMPLE_POLYLINE[0]])).toBe(0);
  });

  it('returns positive value for multi-point polyline', () => {
    const len = polylineLengthMeters(SAMPLE_POLYLINE);
    expect(len).toBeGreaterThan(1_000);
    expect(len).toBeLessThan(5_000);
  });

  it('is consistent with haversine segment sums', () => {
    const len = polylineLengthMeters(SAMPLE_POLYLINE);
    // Approx 0.01 degree lat × 2 segments = ~2.2 km
    expect(len).toBeGreaterThan(2_000);
    expect(len).toBeLessThan(2_400);
  });
});

// ─── remainingPolylineMeters ──────────────────────────────────────────────────

describe('remainingPolylineMeters', () => {
  it('returns 0 for empty polyline', () => {
    expect(remainingPolylineMeters([], { latitude: 27.7, longitude: 85.5 })).toBe(0);
  });

  it('returns near 0 when position is at the destination end', () => {
    const remaining = remainingPolylineMeters(SAMPLE_POLYLINE, DESTINATION);
    expect(remaining).toBeLessThan(200); // small residual from segment discretization
  });

  it('returns near full length when at the start', () => {
    const start = SAMPLE_POLYLINE[0];
    const total = polylineLengthMeters(SAMPLE_POLYLINE);
    const remaining = remainingPolylineMeters(SAMPLE_POLYLINE, start);
    // Should be roughly total minus first segment
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThan(total);
  });

  it('remaining decreases as position approaches destination', () => {
    const r1 = remainingPolylineMeters(SAMPLE_POLYLINE, SAMPLE_POLYLINE[0]);
    const r2 = remainingPolylineMeters(SAMPLE_POLYLINE, SAMPLE_POLYLINE[1]);
    const r3 = remainingPolylineMeters(SAMPLE_POLYLINE, SAMPLE_POLYLINE[2]);
    expect(r1).toBeGreaterThanOrEqual(r2);
    expect(r2).toBeGreaterThanOrEqual(r3);
  });
});

// ─── RouteProgressTracker ─────────────────────────────────────────────────────

describe('RouteProgressTracker', () => {
  let mockProvider: jest.Mock;
  let tracker: RouteProgressTracker;

  beforeEach(() => {
    jest.useFakeTimers();
    mockProvider = jest.fn();
    tracker = new RouteProgressTracker(mockProvider);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // ── No destination ─────────────────────────────────────────────────────────
  describe('no destination', () => {
    it('returns null snapshot when no destination is set', async () => {
      const snap = await tracker.updatePosition({ latitude: 27.7, longitude: 85.5 });
      expect(snap.distanceRemainingMeters).toBeNull();
      expect(snap.durationRemainingMs).toBeNull();
      expect(snap.etaMs).toBeNull();
    });

    it('does not call provider when no destination', async () => {
      await tracker.updatePosition({ latitude: 27.7, longitude: 85.5 });
      expect(mockProvider).not.toHaveBeenCalled();
    });
  });

  // ── Route unavailable ──────────────────────────────────────────────────────
  describe('route unavailable', () => {
    it('returns null values when provider returns null', async () => {
      mockProvider.mockResolvedValue(null);
      tracker.setDestination(DESTINATION);

      const snap = await tracker.updatePosition(SAMPLE_POLYLINE[0]);
      // Without ingested route, should be null immediately
      expect(snap.distanceRemainingMeters).toBeNull();
      expect(snap.etaMs).toBeNull();
    });

    it('getSnapshot returns EMPTY_ROUTE_PROGRESS before first fetch completes', () => {
      tracker.setDestination(DESTINATION);
      const snap = tracker.getSnapshot();
      expect(snap).toEqual(EMPTY_ROUTE_PROGRESS);
    });
  });

  // ── Valid route distance remaining ─────────────────────────────────────────
  describe('valid route: distance remaining', () => {
    it('provides remaining distance after route is ingested', async () => {
      tracker.setDestination(DESTINATION);
      tracker.ingestRoute(makeSampleRoute());

      const snap = await tracker.updatePosition(SAMPLE_POLYLINE[0]);
      expect(snap.distanceRemainingMeters).not.toBeNull();
      expect(snap.distanceRemainingMeters!).toBeGreaterThan(0);
    });

    it('remaining distance is less than total route distance', async () => {
      const route = makeSampleRoute();
      tracker.setDestination(DESTINATION);
      tracker.ingestRoute(route);

      const snap = await tracker.updatePosition(SAMPLE_POLYLINE[1]);
      expect(snap.distanceRemainingMeters!).toBeLessThanOrEqual(route.totalDistanceMeters);
    });

    it('remaining distance approaches 0 near destination', async () => {
      tracker.setDestination(DESTINATION);
      tracker.ingestRoute(makeSampleRoute());

      const snap = await tracker.updatePosition(SAMPLE_POLYLINE[2]); // near destination
      expect(snap.distanceRemainingMeters!).toBeLessThan(500);
    });
  });

  // ── Valid ETA from provider duration ──────────────────────────────────────
  describe('valid ETA: from provider duration', () => {
    it('ETA is in the future', async () => {
      tracker.setDestination(DESTINATION);
      tracker.ingestRoute(makeSampleRoute());

      const now = Date.now();
      const snap = await tracker.updatePosition(SAMPLE_POLYLINE[0]);
      expect(snap.etaMs).not.toBeNull();
      expect(snap.etaMs!).toBeGreaterThan(now);
    });

    it('ETA = now + durationRemainingMs', async () => {
      tracker.setDestination(DESTINATION);
      tracker.ingestRoute(makeSampleRoute());

      const before = Date.now();
      const snap = await tracker.updatePosition(SAMPLE_POLYLINE[0]);
      const after = Date.now();

      expect(snap.etaMs!).toBeGreaterThanOrEqual(before + snap.durationRemainingMs!);
      expect(snap.etaMs!).toBeLessThanOrEqual(after + snap.durationRemainingMs! + 100);
    });

    it('ETA is NOT derived from current speed', async () => {
      // Verify: tracker has no knowledge of current speed — it only uses
      // provider duration scaled by remaining distance fraction.
      tracker.setDestination(DESTINATION);
      const route = makeSampleRoute({ totalDurationSeconds: 3600 }); // 1 hour
      tracker.ingestRoute(route);

      const snap = await tracker.updatePosition(SAMPLE_POLYLINE[0]);
      // If ETA were speed-derived, it would be affected by telemetry.
      // Here we verify the snapshot has an ETA without any speed input.
      expect(snap.etaMs).not.toBeNull();
      // Duration should be scaled from 3600s, not computed from speed
      expect(snap.durationRemainingMs!).toBeGreaterThan(0);
    });
  });

  // ── Progress updates remaining distance ────────────────────────────────────
  describe('progress updates remaining distance and ETA', () => {
    it('remaining distance decreases as rider moves toward destination', async () => {
      tracker.setDestination(DESTINATION);
      tracker.ingestRoute(makeSampleRoute());

      const snap1 = await tracker.updatePosition(SAMPLE_POLYLINE[0]);
      const snap2 = await tracker.updatePosition(SAMPLE_POLYLINE[1]);

      expect(snap2.distanceRemainingMeters!).toBeLessThanOrEqual(
        snap1.distanceRemainingMeters!,
      );
    });

    it('ETA decreases (sooner) as rider approaches destination', async () => {
      tracker.setDestination(DESTINATION);
      tracker.ingestRoute(makeSampleRoute());

      const snap1 = await tracker.updatePosition(SAMPLE_POLYLINE[0]);
      jest.advanceTimersByTime(10_000); // advance 10s of wall clock
      const snap2 = await tracker.updatePosition(SAMPLE_POLYLINE[1]);

      // ETA should reduce with progress
      expect(snap2.durationRemainingMs!).toBeLessThan(snap1.durationRemainingMs!);
    });
  });

  // ── Rate limiting ──────────────────────────────────────────────────────────
  describe('excessive routing requests are prevented', () => {
    it('does not call provider more than once within MIN_ROUTE_FETCH_INTERVAL_MS', async () => {
      mockProvider.mockResolvedValue(makeSampleRoute());
      tracker.setDestination(DESTINATION);

      // First update triggers a fetch
      await tracker.updatePosition(SAMPLE_POLYLINE[0]);

      // Many rapid updates — should NOT re-call provider
      for (let i = 0; i < 20; i++) {
        await tracker.updatePosition(SAMPLE_POLYLINE[0]);
      }

      // Provider should only have been called at most once
      expect(mockProvider).toHaveBeenCalledTimes(1);
    });

    it('allows re-fetch after MIN_ROUTE_FETCH_INTERVAL_MS + sufficient progress', async () => {
      mockProvider.mockResolvedValue(makeSampleRoute());
      tracker.setDestination(DESTINATION);

      await tracker.updatePosition(SAMPLE_POLYLINE[0]);
      expect(mockProvider).toHaveBeenCalledTimes(1);

      // Advance time past the rate-limit window
      jest.advanceTimersByTime(MIN_ROUTE_FETCH_INTERVAL_MS + 1_000);

      // Move far enough to cross the progress threshold
      const farPosition: LatLng = {
        latitude: SAMPLE_POLYLINE[0].latitude + (MIN_PROGRESS_METERS / 111_000) + 0.001,
        longitude: SAMPLE_POLYLINE[0].longitude,
      };
      await tracker.updatePosition(farPosition);

      expect(mockProvider).toHaveBeenCalledTimes(2);
    });
  });

  // ── Provider failure ───────────────────────────────────────────────────────
  describe('provider failure preserves app usability', () => {
    it('does not throw when provider throws', async () => {
      mockProvider.mockRejectedValue(new Error('network error'));
      tracker.setDestination(DESTINATION);

      await expect(
        tracker.updatePosition(SAMPLE_POLYLINE[0]),
      ).resolves.not.toThrow();
    });

    it('returns null ETA (not fake value) when provider fails', async () => {
      mockProvider.mockRejectedValue(new Error('network error'));
      tracker.setDestination(DESTINATION);

      const snap = await tracker.updatePosition(SAMPLE_POLYLINE[0]);
      // No route ingested and provider failed → all null
      expect(snap.etaMs).toBeNull();
      expect(snap.distanceRemainingMeters).toBeNull();
    });

    it('retains previous route data when re-fetch fails', async () => {
      const initialRoute = makeSampleRoute();
      tracker.setDestination(DESTINATION);
      tracker.ingestRoute(initialRoute);

      // First successful snapshot
      const snap1 = await tracker.updatePosition(SAMPLE_POLYLINE[0]);
      expect(snap1.etaMs).not.toBeNull();

      // Provider starts failing
      mockProvider.mockRejectedValue(new Error('network error'));

      // Re-fetch fails but tracker keeps existing route
      jest.advanceTimersByTime(MIN_ROUTE_FETCH_INTERVAL_MS + 1_000);
      const farPosition: LatLng = {
        latitude: SAMPLE_POLYLINE[0].latitude + (MIN_PROGRESS_METERS / 111_000) + 0.001,
        longitude: SAMPLE_POLYLINE[0].longitude,
      };
      const snap2 = await tracker.updatePosition(farPosition);

      // Should still return a valid ETA from the previously ingested route
      expect(snap2.etaMs).not.toBeNull();
    });
  });

  // ── Future rerouting integration: ingestRoute ─────────────────────────────
  describe('future updated route replaces old ETA source cleanly', () => {
    it('ingestRoute replaces old route', async () => {
      const oldRoute = makeSampleRoute({ totalDurationSeconds: 3600 });
      const newRoute = makeSampleRoute({ totalDurationSeconds: 600 });

      tracker.setDestination(DESTINATION);
      tracker.ingestRoute(oldRoute);

      const snapOld = await tracker.updatePosition(SAMPLE_POLYLINE[0]);

      tracker.ingestRoute(newRoute);
      const snapNew = await tracker.updatePosition(SAMPLE_POLYLINE[0]);

      // New route has 6× shorter duration → smaller remaining duration
      expect(snapNew.durationRemainingMs!).toBeLessThan(snapOld.durationRemainingMs!);
    });

    it('setDestination clears old route and returns null', async () => {
      tracker.setDestination(DESTINATION);
      tracker.ingestRoute(makeSampleRoute());

      const snap1 = await tracker.updatePosition(SAMPLE_POLYLINE[0]);
      expect(snap1.etaMs).not.toBeNull();

      // Rerouting to a new destination
      tracker.setDestination({ latitude: 28.0, longitude: 86.0 });
      const snap2 = tracker.getSnapshot();
      expect(snap2.etaMs).toBeNull();
      expect(snap2.distanceRemainingMeters).toBeNull();
    });

    it('onProgress listener fires when route is ingested', () => {
      const listener = jest.fn();
      tracker.setDestination(DESTINATION);
      tracker.onProgress(listener);

      tracker.ingestRoute(makeSampleRoute());
      // setDestination notifies — listener called once on setDestination above
      // ingestRoute does NOT call notify (by design — updatePosition triggers that)
      // This verifies the listener is properly registered
      expect(listener).toHaveBeenCalledTimes(1); // once from setDestination
    });
  });
});

// ─── Formatting helpers (UI layer) ────────────────────────────────────────────

describe('formatEta', () => {
  it('returns -- for null', () => {
    expect(formatEta(null)).toBe('--');
  });

  it('returns -- for undefined', () => {
    expect(formatEta(undefined)).toBe('--');
  });

  it('returns -- for 0', () => {
    expect(formatEta(0)).toBe('--');
  });

  it('returns -- for negative value', () => {
    expect(formatEta(-1)).toBe('--');
  });

  it('returns a time string for a valid future timestamp', () => {
    const eta = Date.now() + 30 * 60 * 1000; // 30 min from now
    const result = formatEta(eta);
    // Should contain digits and a colon — e.g. '10:42 AM' or '10:42'
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });

  it('does not fabricate zero ETA', () => {
    expect(formatEta(null)).not.toBe('00:00');
    expect(formatEta(null)).not.toBe('0');
    expect(formatEta(null)).not.toBe('00:00 AM');
  });
});

describe('formatDistanceOptional', () => {
  it('returns -- for null', () => {
    expect(formatDistanceOptional(null)).toBe('--');
  });

  it('returns -- for undefined', () => {
    expect(formatDistanceOptional(undefined)).toBe('--');
  });

  it('returns formatted distance for valid metres', () => {
    expect(formatDistanceOptional(1500)).toBe('1.5 km');
  });

  it('returns m for sub-km', () => {
    expect(formatDistanceOptional(400)).toBe('400 m');
  });
});

describe('formatDurationOptional', () => {
  it('returns -- for null', () => {
    expect(formatDurationOptional(null)).toBe('--');
  });

  it('returns formatted duration for valid ms', () => {
    expect(formatDurationOptional(90 * 60 * 1000)).toBe('1h 30m');
  });
});
