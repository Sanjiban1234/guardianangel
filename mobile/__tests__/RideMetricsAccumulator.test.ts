/**
 * @file RideMetricsAccumulator.test.ts
 * @description Unit tests for the live ride statistics accumulator.
 *
 * Tests verify:
 * • Distance accumulation (normal, GPS jump outlier, poor accuracy)
 * • Speed formatting and unavailability handling
 * • Duration tracking
 * • Average moving speed (excludes stopped periods)
 * • Max speed (excludes outliers)
 * • Stopped time detection
 * • No fabricated values
 * • Agreement with post-ride summary normalization constants
 */

import {
  RideMetricsAccumulator,
  haversineMeters,
  STOP_THRESHOLD_MS,
  OUTLIER_SPEED_MS,
  MAX_ACCEPTABLE_ACCURACY_M,
  MetricsSnapshot,
} from '../src/telemetry/RideMetricsAccumulator';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeReading(
  opts: Partial<{
    timestamp: number;
    latitude: number;
    longitude: number;
    accuracy: number;
    speed: number | null;
  }> = {},
) {
  return {
    timestamp: opts.timestamp ?? Date.now(),
    latitude: opts.latitude ?? 27.7172,
    longitude: opts.longitude ?? 85.5204,
    accuracy: opts.accuracy ?? 10,
    speed: opts.speed !== undefined ? opts.speed : 10,
  };
}

// ─── haversine ────────────────────────────────────────────────────────────────

describe('haversineMeters', () => {
  it('returns 0 for identical coordinates', () => {
    expect(haversineMeters(27.7, 85.5, 27.7, 85.5)).toBe(0);
  });

  it('calculates ~111 km per degree of latitude', () => {
    const d = haversineMeters(0, 0, 1, 0);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  it('is symmetric (A→B === B→A)', () => {
    const a = haversineMeters(27.7, 85.5, 27.8, 85.6);
    const b = haversineMeters(27.8, 85.6, 27.7, 85.5);
    expect(Math.abs(a - b)).toBeLessThan(0.001);
  });
});

// ─── RideMetricsAccumulator ───────────────────────────────────────────────────

describe('RideMetricsAccumulator', () => {
  let acc: RideMetricsAccumulator;
  const START_MS = 1_700_000_000_000;

  beforeEach(() => {
    acc = new RideMetricsAccumulator(START_MS);
  });

  // ── No readings ────────────────────────────────────────────────────────────
  describe('initial state', () => {
    it('returns zero distance with no readings', () => {
      const snap = acc.snapshot();
      expect(snap.distanceMeters).toBe(0);
    });

    it('returns null currentSpeedMs with no readings', () => {
      const snap = acc.snapshot();
      expect(snap.currentSpeedMs).toBeNull();
    });

    it('returns null avgMovingSpeedMs with no readings', () => {
      expect(acc.snapshot().avgMovingSpeedMs).toBeNull();
    });

    it('returns null maxSpeedMs with no readings', () => {
      expect(acc.snapshot().maxSpeedMs).toBeNull();
    });

    it('returns 0 stoppedTimeMs with no readings', () => {
      expect(acc.snapshot().stoppedTimeMs).toBe(0);
    });

    it('durationMs reflects wall-clock since start', () => {
      // We can only check it's non-negative
      expect(acc.snapshot().durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Current speed ──────────────────────────────────────────────────────────
  describe('current speed', () => {
    it('returns speed from latest reading (m/s)', () => {
      acc.addReading(makeReading({ speed: 15 }));
      expect(acc.snapshot().currentSpeedMs).toBe(15);
    });

    it('returns null when last reading has null speed', () => {
      acc.addReading(makeReading({ speed: null }));
      expect(acc.snapshot().currentSpeedMs).toBeNull();
    });

    it('falls back to previous valid speed when latest has null speed', () => {
      acc.addReading(makeReading({ speed: 12 }));
      acc.addReading(makeReading({ speed: null }));
      // Should return last valid non-null, non-outlier speed
      expect(acc.snapshot().currentSpeedMs).toBe(12);
    });

    it('does NOT fabricate 0 when speed is unknown', () => {
      acc.addReading(makeReading({ speed: null }));
      acc.addReading(makeReading({ speed: null }));
      expect(acc.snapshot().currentSpeedMs).toBeNull();
    });
  });

  // ── Distance accumulation ──────────────────────────────────────────────────
  describe('distance accumulation', () => {
    it('accumulates distance between two readings', () => {
      acc.addReading(makeReading({ latitude: 27.7172, longitude: 85.5204, timestamp: START_MS }));
      acc.addReading(makeReading({ latitude: 27.7272, longitude: 85.5204, timestamp: START_MS + 30_000 }));
      const snap = acc.snapshot();
      // ~1.1 km between 0.01 degree latitude shift
      expect(snap.distanceMeters).toBeGreaterThan(900);
      expect(snap.distanceMeters).toBeLessThan(1200);
    });

    it('ignores GPS jumps > 500m between consecutive readings', () => {
      acc.addReading(makeReading({ latitude: 27.7172, longitude: 85.5204, timestamp: START_MS }));
      // Jump 10 km north — should be rejected
      acc.addReading(makeReading({ latitude: 27.8072, longitude: 85.5204, timestamp: START_MS + 5_000 }));
      expect(acc.snapshot().distanceMeters).toBe(0);
    });

    it('skips distance contribution when accuracy > MAX_ACCEPTABLE_ACCURACY_M', () => {
      acc.addReading(makeReading({ latitude: 27.7172, longitude: 85.5204, accuracy: 10, timestamp: START_MS }));
      acc.addReading(makeReading({ latitude: 27.7272, longitude: 85.5204, accuracy: MAX_ACCEPTABLE_ACCURACY_M + 1, timestamp: START_MS + 30_000 }));
      expect(acc.snapshot().distanceMeters).toBe(0);
    });
  });

  // ── Max speed ──────────────────────────────────────────────────────────────
  describe('max speed', () => {
    it('tracks the highest valid speed', () => {
      acc.addReading(makeReading({ speed: 10 }));
      acc.addReading(makeReading({ speed: 25 }));
      acc.addReading(makeReading({ speed: 15 }));
      expect(acc.snapshot().maxSpeedMs).toBe(25);
    });

    it('excludes outlier speeds >= OUTLIER_SPEED_MS from max', () => {
      acc.addReading(makeReading({ speed: 20 }));
      acc.addReading(makeReading({ speed: OUTLIER_SPEED_MS })); // Exactly at threshold — excluded
      expect(acc.snapshot().maxSpeedMs).toBe(20);
    });

    it('OUTLIER_SPEED_MS constant is >= 80 m/s (~288 km/h)', () => {
      expect(OUTLIER_SPEED_MS).toBeGreaterThanOrEqual(80);
    });
  });

  // ── Average moving speed ───────────────────────────────────────────────────
  describe('average moving speed', () => {
    it('excludes stopped periods from average', () => {
      acc.addReading(makeReading({ speed: 20 }));
      acc.addReading(makeReading({ speed: STOP_THRESHOLD_MS - 0.1 })); // stopped
      acc.addReading(makeReading({ speed: 30 }));
      const avg = acc.snapshot().avgMovingSpeedMs!;
      // Only 20 and 30 contribute: avg = 25
      expect(avg).toBeCloseTo(25, 0);
    });

    it('STOP_THRESHOLD_MS constant is <= 1.0 m/s', () => {
      expect(STOP_THRESHOLD_MS).toBeLessThanOrEqual(1.0);
    });

    it('returns null when only stopped readings exist', () => {
      acc.addReading(makeReading({ speed: 0 }));
      acc.addReading(makeReading({ speed: 0.5 }));
      expect(acc.snapshot().avgMovingSpeedMs).toBeNull();
    });
  });

  // ── Stopped time ───────────────────────────────────────────────────────────
  describe('stopped time', () => {
    it('accumulates stopped time between consecutive readings', () => {
      const t = START_MS;
      acc.addReading(makeReading({ speed: 0.5, timestamp: t }));         // stopped
      acc.addReading(makeReading({ speed: 0.8, timestamp: t + 10_000 })); // stopped
      acc.addReading(makeReading({ speed: 15, timestamp: t + 20_000 }));  // moving
      const snap = acc.snapshot();
      // 10_000 ms stopped (between reading 1 and reading 2)
      expect(snap.stoppedTimeMs).toBeGreaterThanOrEqual(10_000);
      expect(snap.stoppedTimeMs).toBeLessThan(20_001);
    });

    it('does not accumulate stopped time for gaps > 60s (implausible)', () => {
      const t = START_MS;
      acc.addReading(makeReading({ speed: 0, timestamp: t }));
      acc.addReading(makeReading({ speed: 0, timestamp: t + 120_000 })); // 2 min gap
      expect(acc.snapshot().stoppedTimeMs).toBe(0);
    });
  });

  // ── Reading count ──────────────────────────────────────────────────────────
  describe('reading count', () => {
    it('tracks number of readings processed', () => {
      acc.addReading(makeReading());
      acc.addReading(makeReading());
      acc.addReading(makeReading());
      expect(acc.snapshot().readingCount).toBe(3);
      expect(acc.readingCount).toBe(3);
    });
  });

  // ── Reset ──────────────────────────────────────────────────────────────────
  describe('reset', () => {
    it('clears all accumulated state', () => {
      acc.addReading(makeReading({ speed: 20, latitude: 27.8 }));
      acc.addReading(makeReading({ speed: 30, latitude: 27.9 }));
      acc.reset();
      const snap = acc.snapshot();
      expect(snap.distanceMeters).toBe(0);
      expect(snap.currentSpeedMs).toBeNull();
      expect(snap.avgMovingSpeedMs).toBeNull();
      expect(snap.maxSpeedMs).toBeNull();
      expect(snap.stoppedTimeMs).toBe(0);
      expect(snap.readingCount).toBe(0);
    });
  });

  // ── No fabricated values ───────────────────────────────────────────────────
  describe('no fabricated values', () => {
    it('never returns 0 speed when GPS speed is null (returns null)', () => {
      acc.addReading(makeReading({ speed: null }));
      expect(acc.snapshot().currentSpeedMs).not.toBe(0);
      expect(acc.snapshot().currentSpeedMs).toBeNull();
    });

    it('returns null maxSpeedMs when all readings are outliers', () => {
      acc.addReading(makeReading({ speed: OUTLIER_SPEED_MS + 1 }));
      acc.addReading(makeReading({ speed: OUTLIER_SPEED_MS + 100 }));
      expect(acc.snapshot().maxSpeedMs).toBeNull();
    });
  });
});
