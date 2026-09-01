/** Provider-independent weather data shared by ride-weather clients. */
export type WeatherContext = 'current' | 'ahead' | 'destination' | 'start';
export type WeatherAdvisoryType = 'HEAVY_RAIN' | 'STRONG_WIND' | 'STRONG_WIND_GUST' | 'LOW_VISIBILITY' | 'THUNDERSTORM' | 'EXTREME_HEAT' | 'EXTREME_COLD';
export interface WeatherPoint { latitude: number; longitude: number; }
export interface NormalizedWeather { condition: string; weatherCode?: number | null; temperatureC?: number | null; apparentTemperatureC?: number | null; precipitationProbability?: number | null; precipitationMm?: number | null; windSpeedKmh?: number | null; windGustKmh?: number | null; visibilityKm?: number | null; forecastAt: string; fetchedAt: string; }
export interface WeatherAdvisory { id: string; type: WeatherAdvisoryType; severity: 'info' | 'warning'; title: string; message: string; context: WeatherContext; forecastAt?: string; distanceAheadKm?: number; }
export interface RouteWeatherPoint { location: WeatherPoint; progress?: number; etaAt?: string; }
export type WeatherFailureReason = 'no_location_data' | 'provider_timeout' | 'provider_unavailable' | 'network_error' | 'partial_failure' | 'unknown';
export interface RideWeatherSafetyResponse { current: NormalizedWeather | null; destination: NormalizedWeather | null; ahead: Array<{ location: WeatherPoint; weather: NormalizedWeather | null; progress?: number }>; advisories: WeatherAdvisory[]; fetchedAt: string; reason?: WeatherFailureReason; }
