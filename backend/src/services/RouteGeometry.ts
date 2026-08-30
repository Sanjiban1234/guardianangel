export interface Coordinate { latitude: number; longitude: number }

const EARTH_RADIUS_METERS = 6_371_000;

export function decodePolyline(encoded: string): Coordinate[] {
  const points: Coordinate[] = [];
  let index = 0, latitude = 0, longitude = 0;
  while (index < encoded.length) {
    const read = (): number => {
      let result = 0, shift = 0, byte: number;
      do {
        if (index >= encoded.length) throw new Error('Invalid encoded polyline');
        byte = encoded.charCodeAt(index++) - 63;
        if (byte < 0 || byte > 63) throw new Error('Invalid encoded polyline');
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      return result & 1 ? ~(result >> 1) : result >> 1;
    };
    latitude += read();
    longitude += read();
    points.push({ latitude: latitude / 1e5, longitude: longitude / 1e5 });
  }
  return points;
}

export function haversineMeters(a: Coordinate, b: Coordinate): number {
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const lat1 = radians(a.latitude), lat2 = radians(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

export interface RoutePoint extends Coordinate { progressMeters: number }

export function routeWithProgress(route: Coordinate[]): RoutePoint[] {
  let progressMeters = 0;
  return route.map((point, index) => {
    if (index) progressMeters += haversineMeters(route[index - 1], point);
    return { ...point, progressMeters };
  });
}

export function pointAtProgress(route: RoutePoint[], target: number): RoutePoint {
  if (!route.length) throw new Error('Route is empty');
  const afterIndex = route.findIndex(point => point.progressMeters >= target);
  if (afterIndex <= 0) return afterIndex === 0 ? route[0] : route[route.length - 1];
  const before = route[afterIndex - 1], after = route[afterIndex];
  const span = after.progressMeters - before.progressMeters;
  const ratio = span ? (target - before.progressMeters) / span : 0;
  return {
    latitude: before.latitude + (after.latitude - before.latitude) * ratio,
    longitude: before.longitude + (after.longitude - before.longitude) * ratio,
    progressMeters: target,
  };
}

export function sampleRoute(route: RoutePoint[], intervalMeters: number, maximum: number): RoutePoint[] {
  const total = route[route.length - 1]?.progressMeters ?? 0;
  const targets = [0];
  for (let value = intervalMeters; value < total && targets.length < maximum - 1; value += intervalMeters) targets.push(value);
  if (total > 0) targets.push(total);
  return targets.slice(0, maximum).map(target => pointAtProgress(route, target));
}

export function nearestRouteMetric(point: Coordinate, route: RoutePoint[]): { distanceFromRouteMeters: number; routeProgressMeters: number } {
  let best = { distanceFromRouteMeters: Number.POSITIVE_INFINITY, routeProgressMeters: 0 };
  const metersPerLatitudeDegree = 111_320;
  const metersPerLongitudeDegree = metersPerLatitudeDegree * Math.cos(point.latitude * Math.PI / 180);
  for (let index = 0; index < route.length; index++) {
    const start = route[index];
    const end = route[index + 1];
    if (!end) {
      const distance = haversineMeters(point, start);
      if (distance < best.distanceFromRouteMeters) best = { distanceFromRouteMeters: distance, routeProgressMeters: start.progressMeters };
      continue;
    }
    const ax = (start.longitude - point.longitude) * metersPerLongitudeDegree;
    const ay = (start.latitude - point.latitude) * metersPerLatitudeDegree;
    const bx = (end.longitude - point.longitude) * metersPerLongitudeDegree;
    const by = (end.latitude - point.latitude) * metersPerLatitudeDegree;
    const dx = bx - ax, dy = by - ay;
    const ratio = Math.max(0, Math.min(1, (-(ax * dx + ay * dy)) / (dx * dx + dy * dy || 1)));
    const distance = Math.hypot(ax + ratio * dx, ay + ratio * dy);
    if (distance < best.distanceFromRouteMeters) best = { distanceFromRouteMeters: distance, routeProgressMeters: start.progressMeters + ratio * (end.progressMeters - start.progressMeters) };
  }
  return best;
}
