import { QueryRunner } from '../db/QueryRunner';
import { logger } from '../utils/logger';
import type { NormalizedWeather, WeatherPoint } from '@guardian-angel/contracts/weather';
import { OpenMeteoWeatherProvider } from './OpenMeteoWeatherProvider';
export interface WeatherData { condition: string; temperature_celsius: number | null; precipitation_probability: number | null; wind_speed_kmh: number | null; fetched_at: string; }
export interface RiderLocation extends WeatherPoint {}
interface Entry { data: NormalizedWeather; expiresAt: number; }
const TTL = 15 * 60 * 1000;
export function mapWeatherCode(c: number): string { if (c === 0) return 'clear_sky'; if (c === 1) return 'mainly_clear'; if (c === 2) return 'partly_cloudy'; if (c === 3) return 'overcast'; if (c === 45 || c === 48) return 'fog'; if (c >= 51 && c <= 57) return 'drizzle'; if (c >= 61 && c <= 67) return 'rain'; if (c >= 71 && c <= 86) return 'snow'; if (c === 95) return 'thunderstorm'; if (c === 96 || c === 99) return 'thunderstorm_with_hail'; return 'unknown'; }
export class WeatherService {
  private cache = new Map<string, Entry>();
  private roomCache = new Map<string, { weather: WeatherData; location: RiderLocation; expiresAt: number }>();
  constructor(private readonly db: QueryRunner, private readonly provider = new OpenMeteoWeatherProvider()) {}
  clearCache() { this.cache.clear(); this.roomCache.clear(); }
  async getRiderLocations(roomId: string): Promise<RiderLocation[]> { const r = await this.db.run('SELECT ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude FROM rider_current_locations WHERE room_id = $1', [roomId]); return r.rows.map(x => ({ latitude: Number(x.latitude), longitude: Number(x.longitude) })).filter(x => Number.isFinite(x.latitude) && Number.isFinite(x.longitude)); }
  computeCentroid(locations: RiderLocation[]): RiderLocation { const total = locations.reduce((a, x) => ({ latitude: a.latitude + x.latitude, longitude: a.longitude + x.longitude }), { latitude: 0, longitude: 0 }); return { latitude: total.latitude / locations.length, longitude: total.longitude / locations.length }; }
  private key(kind: string, p: WeatherPoint, at?: Date) { return `${kind}:${p.latitude.toFixed(2)}:${p.longitude.toFixed(2)}:${at ? Math.floor(at.getTime() / 3600000) : 'now'}`; }
  private async cached(kind: string, p: WeatherPoint, loader: () => Promise<NormalizedWeather>, at?: Date) { const key = this.key(kind, p, at); const hit = this.cache.get(key); if (hit && hit.expiresAt > Date.now()) return hit.data; const data = await loader(); this.cache.set(key, { data, expiresAt: Date.now() + TTL }); return data; }
  currentAt(p: WeatherPoint) { return this.cached('current', p, () => this.provider.current(p)); }
  forecastAt(p: WeatherPoint, at?: Date) { return this.cached('hourly', p, () => this.provider.hourly(p, at), at); }
  async getWeatherForRoom(roomId: string): Promise<{ weather: WeatherData | null; location: RiderLocation | null; reason?: string }> { const cached = this.roomCache.get(roomId); if (cached && cached.expiresAt > Date.now()) return { weather: cached.weather, location: cached.location }; const points = await this.getRiderLocations(roomId); if (!points.length) return { weather: null, location: null, reason: 'no_location_data' }; const location = this.computeCentroid(points); try { const w = await this.provider.current(location); const weather = { condition: w.condition, temperature_celsius: w.temperatureC ?? null, precipitation_probability: w.precipitationProbability ?? null, wind_speed_kmh: w.windSpeedKmh ?? null, fetched_at: w.fetchedAt }; this.roomCache.set(roomId, { weather, location, expiresAt: Date.now() + TTL }); return { location, weather }; } catch { logger.warn('weather_provider_failed', { category: 'weather_provider_failed' }); return { weather: null, location, reason: 'provider_unavailable' }; } }
}
