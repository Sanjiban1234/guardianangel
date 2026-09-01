import type { NormalizedWeather, WeatherAdvisory, WeatherContext } from '@guardian-angel/contracts/weather';

/** Conservative, tunable advisory thresholds. Open-Meteo supplies km/h, km and Celsius. */
export const WEATHER_SAFETY_THRESHOLDS = { heavyRainMm: 7, strongWindKmh: 45, strongWindGustKmh: 60, lowVisibilityKm: 1, extremeHeatC: 38, extremeColdC: 2 };
export function evaluateWeatherAdvisories(weather: NormalizedWeather, context: WeatherContext): WeatherAdvisory[] {
  const alert = (type: WeatherAdvisory['type'], title: string, message: string): WeatherAdvisory => ({ id: `${type}:${context}:${weather.forecastAt}`, type, severity: 'warning', title, message, context, forecastAt: weather.forecastAt });
  const t = WEATHER_SAFETY_THRESHOLDS; const result: WeatherAdvisory[] = [];
  if ((weather.precipitationMm ?? 0) >= t.heavyRainMm) result.push(alert('HEAVY_RAIN', 'WEATHER AHEAD', 'Heavy rain is expected. Take extra care.'));
  if ((weather.windSpeedKmh ?? 0) >= t.strongWindKmh) result.push(alert('STRONG_WIND', 'STRONG WIND', 'Strong winds are forecast along your route.'));
  if ((weather.windGustKmh ?? 0) >= t.strongWindGustKmh) result.push(alert('STRONG_WIND_GUST', 'STRONG WIND GUSTS', 'Strong wind gusts are forecast along your route.'));
  if (weather.visibilityKm != null && weather.visibilityKm <= t.lowVisibilityKm) result.push(alert('LOW_VISIBILITY', 'LOW VISIBILITY', 'Reduced visibility is expected ahead.'));
  if (weather.condition.includes('thunderstorm')) result.push(alert('THUNDERSTORM', 'THUNDERSTORM', 'Thunderstorms are expected. Consider delaying or pausing the ride.'));
  if ((weather.temperatureC ?? -Infinity) >= t.extremeHeatC) result.push(alert('EXTREME_HEAT', 'EXTREME HEAT', 'Extreme heat is expected. Hydrate and take breaks.'));
  if ((weather.temperatureC ?? Infinity) <= t.extremeColdC) result.push(alert('EXTREME_COLD', 'EXTREME COLD', 'Very cold conditions are expected. Dress for the conditions.'));
  return result;
}
