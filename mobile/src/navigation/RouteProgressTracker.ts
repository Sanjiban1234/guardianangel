/**
 * @file RouteProgressTracker.ts
 * @description Computes distance-remaining, duration-remaining, and ETA from
 * a Google Directions API route response.
 *
 * ─── ARCHITECTURE / DESIGN PRINCIPLES ─────────────────────────────────────
 *
 * SINGLE SOURCE OF ROUTE TRUTH
 *   ETA comes exclusively from the route provider (Google Directions API).
 *   We never estimate ETA as `remaining_distance / current_speed` and
 *   never present a speed-derived estimate as an authoritative arrival time.
 *
 * RATE LIMITING
 *   The route is fetched at most once per MIN_ROUTE_FETCH_INTERVAL_MS when
 *   meaningful GPS progress occurs (≥ MIN_PROGRESS_METERS to retrigger).
 *   This prevents a fetch on every telemetry packet.
 *
 * PROGRESS INTERPOLATION (no extra network calls)
 *   Between fetches, remaining distance is estimated by projecting the
 *   current GPS position onto the decoded polyline and computing the
 *   remaining path length. This is a client-side geometry operation —
 *   no network involved. Provider duration is then scaled by the ratio of
 *   remaining haversine distance to total route distance to produce an
 *   interpolated duration, which feeds ETA.
 *
 * GRACEFUL DEGRADATION
 *   If the route provider is unavailable, distanceRemainingMeters and
 *   durationRemainingMs are null. The UI must show '--' rather than 0
 *   or a fabricated value.
 *
 * FUTURE REROUTING INTEGRATION
 *   The rerouting service (separate branch) should call `ingestRoute()`
 *   with the new route after it is computed. This clears the old route
 *   context and immediately produces updated remaining metrics from the
 *   new provider data.
 *   Integration point: `ingestRoute(routeResult: RouteResult): void`
 *
 * ─────────────────────────────────────────────────────────────────────────
 */

import { haversineMeters } from '../telemetry/RideMetricsAccumulator';

/** Minimum distance change (metres) that triggers a new Directions API fetch. */
export const MIN_PROGRESS_METERS = 500;

/** Minimum interval between Directions API fetches (ms). */
export const MIN_ROUTE_FETCH_INTERVAL_MS = 60_000; // 1 minute

/** A single lat/lng coordinate. */
export interface LatLng {
  latitude: number;
  longitude: number;
}

/**
 * Structured route result from the Directions provider.
 * Populated from the Google Directions API `legs[0]` entry.
 */
export interface RouteResult {
  /** Decoded polyline coordinates (origin → destination). */
  polyline: LatLng[];
  /** Total route distance in metres (from provider). */
  totalDistanceMeters: number;
  /** Total route duration in seconds (from provider). */
  totalDurationSeconds: number;
  /** Timestamp when this route was fetched (epoch ms). */
  fetchedAt: number;
}

/** Live route progress snapshot. */
export interface RouteProgressSnapshot {
  /**
   * Remaining distance to destination in metres.
   * null when no route is available.
   */
  distanceRemainingMeters: number | null;
  /**
   * Remaining duration in milliseconds (provider-scaled, not speed-derived).
   * null when no route is available.
   */
  durationRemainingMs: number | null;
  /**
   * Estimated arrival time (epoch ms).
   * null when no route is available.
   */
  etaMs: number | null;
  /**
   * True when progress has been interpolated from polyline geometry
   * rather than freshly fetched from the provider.
   */
  isInterpolated: boolean;
}

export const EMPTY_ROUTE_PROGRESS: RouteProgressSnapshot = {
  distanceRemainingMeters: null,
  durationRemainingMs: null,
  etaMs: null,
  isInterpolated: false,
};

// ─── Polyline geometry helpers ────────────────────────────────────────────────

/**
 * Returns the total arc-length (metres) of a polyline.
 */
export function polylineLengthMeters(polyline: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < polyline.length; i++) {
    total += haversineMeters(
      polyline[i - 1].latitude, polyline[i - 1].longitude,
      polyline[i].latitude, polyline[i].longitude,
    );
  }
  return total;
}

/**
 * Finds the index of the polyline segment closest to `position`.
 * Returns the index of the first point of the closest segment.
 */
function nearestSegmentIndex(polyline: LatLng[], position: LatLng): number {
  if (polyline.length < 2) return 0;

  let bestIdx = 0;
  let bestDist = Infinity;

  for (let i = 0; i < polyline.length - 1; i++) {
    const d = haversineMeters(
      position.latitude, position.longitude,
      polyline[i].latitude, polyline[i].longitude,
    );
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }

  return bestIdx;
}

/**
 * Computes remaining polyline length (metres) from `position` to the end.
 * Uses nearest-vertex projection — simple and robust for the GPS accuracy
 * we can expect from mobile devices.
 */
export function remainingPolylineMeters(
  polyline: LatLng[],
  position: LatLng,
): number {
  if (polyline.length < 2) return 0;

  const segIdx = nearestSegmentIndex(polyline, position);

  // Sum from the *next* vertex to the end
  let remaining = 0;
  const startIdx = Math.min(segIdx + 1, polyline.length - 1);
  for (let i = startIdx; i < polyline.length - 1; i++) {
    remaining += haversineMeters(
      polyline[i].latitude, polyline[i].longitude,
      polyline[i + 1].latitude, polyline[i + 1].longitude,
    );
  }

  return remaining;
}

// ─── RouteProgressTracker ─────────────────────────────────────────────────────

type RouteProvider = (
  origin: LatLng,
  destination: LatLng,
) => Promise<RouteResult | null>;

export class RouteProgressTracker {
  private route: RouteResult | null = null;
  private lastFetchedAt: number | null = null;
  private lastFetchOrigin: LatLng | null = null;
  private destination: LatLng | null = null;
  private isFetching = false;
  private externallyManaged = false;

  private listeners: Set<(snap: RouteProgressSnapshot) => void> = new Set();

  constructor(private readonly routeProvider: RouteProvider) {}

  /** Set or update the destination. Clears old route context. */
  setDestination(dest: LatLng | null): void {
    this.destination = dest;
    this.route = null;
    this.lastFetchedAt = null;
    this.lastFetchOrigin = null;
    this.externallyManaged = false;
    this.notifyListeners(EMPTY_ROUTE_PROGRESS);
  }

  /**
   * Ingest a pre-fetched route result (e.g. from the rerouting service).
   * This is the future rerouting integration point:
   *   reroutingService.onNewRoute(route => tracker.ingestRoute(route))
   */
  ingestRoute(route: RouteResult): void {
    this.route = route;
    this.lastFetchedAt = route.fetchedAt;
    this.lastFetchOrigin = route.polyline[0] || null;
    this.externallyManaged = true;
    const snap = this.snapshot(this.lastFetchOrigin);
    this.notifyListeners(snap);
  }

  /** Subscribe to progress updates. Returns an unsubscribe function. */
  onProgress(listener: (snap: RouteProgressSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Current snapshot without triggering a fetch. */
  getSnapshot(position: LatLng | null = null): RouteProgressSnapshot {
    return this.snapshot(position);
  }

  /**
   * Called on each GPS position update.
   * - Returns a snapshot immediately from polyline geometry (no network)
   * - Triggers a background route fetch when the rate-limit/progress
   *   thresholds are met
   */
  async updatePosition(position: LatLng): Promise<RouteProgressSnapshot> {
    if (!this.destination) return EMPTY_ROUTE_PROGRESS;

    const snap = this.snapshot(position);
    this.notifyListeners(snap);

    // Decide whether to re-fetch from provider
    if (!this.externallyManaged && this.shouldFetch(position)) {
      void this.triggerFetch(position);
    }

    return snap;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private snapshot(position: LatLng | null): RouteProgressSnapshot {
    if (!this.route || !this.destination) return EMPTY_ROUTE_PROGRESS;

    const totalRouteMeters = polylineLengthMeters(this.route.polyline);
    if (totalRouteMeters <= 0) return EMPTY_ROUTE_PROGRESS;

    let distanceRemainingMeters: number;
    let isInterpolated: boolean;

    if (position) {
      distanceRemainingMeters = remainingPolylineMeters(
        this.route.polyline,
        position,
      );
      isInterpolated = true;
    } else {
      // No position yet — return full route distance
      distanceRemainingMeters = totalRouteMeters;
      isInterpolated = false;
    }

    // Clamp: can't be negative or exceed total
    distanceRemainingMeters = Math.max(
      0,
      Math.min(distanceRemainingMeters, totalRouteMeters),
    );

    // Scale provider duration by remaining fraction
    const fraction = distanceRemainingMeters / totalRouteMeters;
    const durationRemainingMs = Math.round(
      this.route.totalDurationSeconds * fraction * 1000,
    );

    const etaMs = Date.now() + durationRemainingMs;

    return {
      distanceRemainingMeters,
      durationRemainingMs,
      etaMs,
      isInterpolated,
    };
  }

  private shouldFetch(position: LatLng): boolean {
    if (!this.destination) return false;
    if (this.isFetching) return false;

    const now = Date.now();

    // First fetch
    if (!this.lastFetchedAt) return true;

    // Rate limit
    if (now - this.lastFetchedAt < MIN_ROUTE_FETCH_INTERVAL_MS) return false;

    // Only re-fetch if rider has moved enough since last fetch origin
    if (this.lastFetchOrigin) {
      const traveled = haversineMeters(
        this.lastFetchOrigin.latitude, this.lastFetchOrigin.longitude,
        position.latitude, position.longitude,
      );
      if (traveled < MIN_PROGRESS_METERS) return false;
    }

    return true;
  }

  private async triggerFetch(position: LatLng): Promise<void> {
    if (!this.destination || this.isFetching) return;

    this.isFetching = true;
    const origin = position;
    const destination = this.destination;

    try {
      const result = await this.routeProvider(origin, destination);
      if (result) {
        this.route = result;
        this.lastFetchedAt = result.fetchedAt;
        this.lastFetchOrigin = origin;
        // Re-emit snapshot with fresh data
        const snap = this.snapshot(origin);
        this.notifyListeners(snap);
      }
    } catch {
      // Provider failure: existing route/snapshot stays — no crash, no fabrication
      console.warn('[RouteProgressTracker] Route provider fetch failed');
    } finally {
      this.isFetching = false;
    }
  }

  private notifyListeners(snap: RouteProgressSnapshot): void {
    for (const listener of this.listeners) {
      try {
        listener(snap);
      } catch {
        // Never let a listener crash the tracker
      }
    }
  }
}

// ─── Google Directions provider factory ──────────────────────────────────────

/**
 * Creates a route provider that calls the Google Directions API.
 * Pass this to `new RouteProgressTracker(createGoogleDirectionsProvider(apiKey))`.
 *
 * Returns null (gracefully) if:
 * - API key is not configured
 * - Network is unavailable
 * - Directions API returns a non-OK status (e.g. no route found)
 */
export function createGoogleDirectionsProvider(apiKey: string): RouteProvider {
  return async (origin: LatLng, destination: LatLng): Promise<RouteResult | null> => {
    if (!apiKey || apiKey === 'YOUR_GOOGLE_MAPS_API_KEY_HERE') {
      console.warn('[RouteProgressTracker] Google Maps API key not configured');
      return null;
    }

    const url =
      `https://maps.googleapis.com/maps/api/directions/json` +
      `?origin=${origin.latitude},${origin.longitude}` +
      `&destination=${destination.latitude},${destination.longitude}` +
      `&mode=driving` +
      `&key=${apiKey}`;

    try {
      const response = await fetch(url);
      const data = await response.json();

      if (data.status !== 'OK' || !data.routes?.length) {
        console.warn('[RouteProgressTracker] Directions API:', data.status);
        return null;
      }

      const leg = data.routes[0].legs?.[0];
      if (!leg) return null;

      // Decode the overview polyline for progress interpolation
      const overviewPolyline = data.routes[0].overview_polyline?.points;
      if (!overviewPolyline) return null;

      const polyline = decodePolyline(overviewPolyline);

      return {
        polyline,
        totalDistanceMeters: leg.distance?.value ?? 0,
        totalDurationSeconds: leg.duration?.value ?? 0,
        fetchedAt: Date.now(),
      };
    } catch {
      console.warn('[RouteProgressTracker] Fetch failed');
      return null;
    }
  };
}

/**
 * Decode a Google Maps encoded polyline string into a coordinate array.
 * Duplicated from MapScreen to keep this module self-contained and testable
 * without a UI import.
 */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }

  return points;
}
