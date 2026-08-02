import { QueryRunner } from '../db/QueryRunner';

export interface WeatherData {
  condition: string;
  temperature_celsius: number;
  precipitation_probability: number;
  wind_speed_kmh: number;
  fetched_at: string;
}

export interface RiderLocation {
  latitude: number;
  longitude: number;
}

interface CacheEntry {
  data: WeatherData;
  location: RiderLocation;
  expires_at: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const FETCH_TIMEOUT_MS = 5000;

export function mapWeatherCode(code: number): string {
  if (code === 0) return 'clear_sky';
  if (code === 1) return 'mainly_clear';
  if (code === 2) return 'partly_cloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if (code === 51 || code === 53 || code === 55) return 'drizzle';
  if (code === 56 || code === 57) return 'freezing_drizzle';
  if (code === 61 || code === 63 || code === 65) return 'rain';
  if (code === 66 || code === 67) return 'freezing_rain';
  if (code === 71 || code === 73 || code === 75) return 'snow';
  if (code === 77) return 'snow_grains';
  if (code === 80 || code === 81 || code === 82) return 'rain_showers';
  if (code === 85 || code === 86) return 'snow_showers';
  if (code === 95) return 'thunderstorm';
  if (code === 96 || code === 99) return 'thunderstorm_with_hail';
  return 'unknown';
}

export class WeatherService {
  private cache = new Map<string, CacheEntry>();

  constructor(private readonly db: QueryRunner) {}

  clearCache(): void {
    this.cache.clear();
  }

  async getRiderLocations(roomId: string): Promise<RiderLocation[]> {
    const result = await this.db.run(
      `SELECT
         ST_Y(location::geometry) AS latitude,
         ST_X(location::geometry) AS longitude
       FROM rider_current_locations
       WHERE room_id = $1`,
      [roomId]
    );
    return result.rows.map(r => ({
      latitude: parseFloat(r.latitude),
      longitude: parseFloat(r.longitude),
    }));
  }

  computeCentroid(locations: RiderLocation[]): RiderLocation {
    const sum = locations.reduce(
      (acc, loc) => ({ latitude: acc.latitude + loc.latitude, longitude: acc.longitude + loc.longitude }),
      { latitude: 0, longitude: 0 }
    );
    return {
      latitude: sum.latitude / locations.length,
      longitude: sum.longitude / locations.length,
    };
  }

  async getWeatherForRoom(roomId: string): Promise<{
    weather: WeatherData | null;
    location: RiderLocation | null;
    reason?: string;
  }> {
    const cached = this.cache.get(roomId);
    if (cached && cached.expires_at > Date.now()) {
      return { weather: cached.data, location: cached.location };
    }

    const locations = await this.getRiderLocations(roomId);
    if (locations.length === 0) {
      return { weather: null, location: null, reason: 'no_location_data' };
    }

    const centroid = this.computeCentroid(locations);

    try {
      const weather = await this.fetchWeather(centroid);
      this.cache.set(roomId, {
        data: weather,
        location: centroid,
        expires_at: Date.now() + CACHE_TTL_MS,
      });
      return { weather, location: centroid };
    } catch (err) {
      console.error('WeatherService: provider fetch failed:', err);
      return { weather: null, location: centroid, reason: 'provider_unavailable' };
    }
  }

  private async fetchWeather(location: RiderLocation): Promise<WeatherData> {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&current=temperature_2m,relative_humidity_2m,precipitation_probability,weather_code,wind_speed_10m`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await globalThis.fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Open-Meteo returned ${response.status}`);
      }
      const data = await response.json() as any;
      const current = data.current;

      return {
        condition: mapWeatherCode(current.weather_code),
        temperature_celsius: current.temperature_2m,
        precipitation_probability: current.precipitation_probability ?? 0,
        wind_speed_kmh: current.wind_speed_10m,
        fetched_at: new Date().toISOString(),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
