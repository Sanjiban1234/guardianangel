import request from 'supertest';
import { app } from '../src/index';
import * as db from '../src/db';
import jwt from 'jsonwebtoken';
import { mapWeatherCode } from '../src/services/WeatherService';

jest.mock('../src/db', () => ({
  query: jest.fn(),
  pool: {
    connect: jest.fn(),
    query: jest.fn(),
  },
  initDb: jest.fn().mockResolvedValue(true)
}));

const mockedQuery = db.query as jest.MockedFunction<typeof db.query>;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_change_me_in_production';

const originalFetch = globalThis.fetch;

describe('GET /api/rooms/:groupCode/weather', () => {
  let memberToken: string;
  let nonMemberToken: string;
  const member = { id: 'user-uuid-weather-member', name: 'rider_weather' };
  const nonMember = { id: 'user-uuid-weather-outsider', name: 'outsider_weather' };
  const mockGroupCode = 'WEATHER1ABCDEF99';
  const mockRoomId = 'room-uuid-weather';

  beforeAll(() => {
    memberToken = jwt.sign(member, JWT_SECRET);
    nonMemberToken = jwt.sign(nonMember, JWT_SECRET);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Prevent any test from hitting the real network
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('unmocked fetch'));
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it('should reject unauthenticated requests with 401', async () => {
    const response = await request(app)
      .get(`/api/rooms/${mockGroupCode}/weather`);

    expect(response.status).toBe(401);
  });

  it('should reject non-members with 403', async () => {
    mockedQuery.mockImplementation(async (text: string): Promise<any> => {
      if (text.includes('ride_rooms') && text.includes('room_members')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const response = await request(app)
      .get(`/api/rooms/${mockGroupCode}/weather`)
      .set('Authorization', `Bearer ${nonMemberToken}`);

    expect(response.status).toBe(403);
    expect(response.body).toHaveProperty('error', 'Forbidden: You are not a member of this ride group');
  });

  it('should return 409 for ended rooms', async () => {
    mockedQuery.mockImplementation(async (text: string): Promise<any> => {
      if (text.includes('ride_rooms') && text.includes('room_members')) {
        return { rows: [{ id: mockRoomId, status: 'ended' }] };
      }
      return { rows: [] };
    });

    const response = await request(app)
      .get(`/api/rooms/${mockGroupCode}/weather`)
      .set('Authorization', `Bearer ${memberToken}`);

    expect(response.status).toBe(409);
    expect(response.body).toHaveProperty('error', 'Weather is only available for active rides');
    expect(response.body).toHaveProperty('code', 'RIDE_ENDED');
  });

  it('should return weather: null with reason when no rider location data exists', async () => {
    mockedQuery.mockImplementation(async (text: string): Promise<any> => {
      if (text.includes('ride_rooms') && text.includes('room_members')) {
        return { rows: [{ id: 'room-no-loc', status: 'active' }] };
      }
      if (text.includes('rider_current_locations')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const response = await request(app)
      .get(`/api/rooms/${mockGroupCode}/weather`)
      .set('Authorization', `Bearer ${memberToken}`);

    expect(response.status).toBe(200);
    expect(response.body.weather).toBeNull();
    expect(response.body.reason).toBe('no_location_data');
  });

  it('should return weather data for a room with valid rider locations', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        current: {
          temperature_2m: 28.5,
          relative_humidity_2m: 72,
          precipitation_probability: 40,
          weather_code: 2,
          wind_speed_10m: 12.3,
        },
      }),
    }) as any;

    mockedQuery.mockImplementation(async (text: string): Promise<any> => {
      if (text.includes('ride_rooms') && text.includes('room_members')) {
        return { rows: [{ id: 'room-valid-loc', status: 'active' }] };
      }
      if (text.includes('rider_current_locations')) {
        return {
          rows: [
            { latitude: '14.5000', longitude: '121.0000' },
            { latitude: '14.5200', longitude: '121.0200' },
          ],
        };
      }
      return { rows: [] };
    });

    const response = await request(app)
      .get(`/api/rooms/${mockGroupCode}/weather`)
      .set('Authorization', `Bearer ${memberToken}`);

    expect(response.status).toBe(200);
    expect(response.body.weather).not.toBeNull();
    expect(response.body.weather.condition).toBe('partly_cloudy');
    expect(response.body.weather.temperature_celsius).toBe(28.5);
    expect(response.body.weather.precipitation_probability).toBe(40);
    expect(response.body.weather.wind_speed_kmh).toBe(12.3);
    expect(response.body.weather).toHaveProperty('fetched_at');
    expect(response.body.location.latitude).toBeCloseTo(14.51, 2);
    expect(response.body.location.longitude).toBeCloseTo(121.01, 2);
  });

  it('should compute centroid correctly for spread-out riders', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        current: {
          temperature_2m: 30.0,
          precipitation_probability: 10,
          weather_code: 0,
          wind_speed_10m: 5.0,
        },
      }),
    }) as any;

    mockedQuery.mockImplementation(async (text: string): Promise<any> => {
      if (text.includes('ride_rooms') && text.includes('room_members')) {
        return { rows: [{ id: 'room-spread', status: 'active' }] };
      }
      if (text.includes('rider_current_locations')) {
        // Riders ~3km apart
        return {
          rows: [
            { latitude: '14.5000', longitude: '121.0000' },
            { latitude: '14.5300', longitude: '121.0300' },
            { latitude: '14.4700', longitude: '120.9700' },
          ],
        };
      }
      return { rows: [] };
    });

    const response = await request(app)
      .get(`/api/rooms/${mockGroupCode}/weather`)
      .set('Authorization', `Bearer ${memberToken}`);

    expect(response.status).toBe(200);
    // Mean of (14.5, 14.53, 14.47) = 14.5, mean of (121.0, 121.03, 120.97) = 121.0
    expect(response.body.location.latitude).toBeCloseTo(14.5, 2);
    expect(response.body.location.longitude).toBeCloseTo(121.0, 2);
  });

  it('should return weather: null when provider times out or errors', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('AbortError: timeout')) as any;

    mockedQuery.mockImplementation(async (text: string): Promise<any> => {
      if (text.includes('ride_rooms') && text.includes('room_members')) {
        return { rows: [{ id: 'room-timeout', status: 'active' }] };
      }
      if (text.includes('rider_current_locations')) {
        return { rows: [{ latitude: '14.5000', longitude: '121.0000' }] };
      }
      return { rows: [] };
    });

    const response = await request(app)
      .get(`/api/rooms/${mockGroupCode}/weather`)
      .set('Authorization', `Bearer ${memberToken}`);

    expect(response.status).toBe(200);
    expect(response.body.weather).toBeNull();
    expect(response.body.reason).toBe('provider_unavailable');
    expect(response.body.location).not.toBeNull();
  });

  it('should use cache and not re-hit provider within TTL', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        current: {
          temperature_2m: 25.0,
          precipitation_probability: 20,
          weather_code: 3,
          wind_speed_10m: 8.0,
        },
      }),
    }) as any;
    globalThis.fetch = mockFetch;

    mockedQuery.mockImplementation(async (text: string): Promise<any> => {
      if (text.includes('ride_rooms') && text.includes('room_members')) {
        return { rows: [{ id: 'room-cache-test', status: 'active' }] };
      }
      if (text.includes('rider_current_locations')) {
        return { rows: [{ latitude: '14.5000', longitude: '121.0000' }] };
      }
      return { rows: [] };
    });

    // First request — hits provider
    await request(app)
      .get(`/api/rooms/${mockGroupCode}/weather`)
      .set('Authorization', `Bearer ${memberToken}`);

    // Second request — should use cache
    const response = await request(app)
      .get(`/api/rooms/${mockGroupCode}/weather`)
      .set('Authorization', `Bearer ${memberToken}`);

    expect(response.status).toBe(200);
    expect(response.body.weather).not.toBeNull();
    expect(response.body.weather.condition).toBe('overcast');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should isolate cache per room — room B does not get room A cached data', async () => {
    const groupCodeA = 'ROOMACACHE123456';
    const groupCodeB = 'ROOMBCACHE789012';
    const roomIdA = 'room-uuid-cache-a';
    const roomIdB = 'room-uuid-cache-b';

    let fetchCallCount = 0;
    const mockFetch = jest.fn().mockImplementation(async (url: string) => {
      fetchCallCount++;
      const isRoomA = url.includes('14.5');
      return {
        ok: true,
        json: async () => ({
          current: {
            temperature_2m: isRoomA ? 30.0 : 18.0,
            precipitation_probability: isRoomA ? 10 : 80,
            weather_code: isRoomA ? 0 : 61,
            wind_speed_10m: isRoomA ? 5.0 : 20.0,
          },
        }),
      };
    }) as any;
    globalThis.fetch = mockFetch;

    mockedQuery.mockImplementation(async (text: string, params?: any[]): Promise<any> => {
      if (text.includes('ride_rooms') && text.includes('room_members')) {
        const tokenHash = params?.[0];
        if (tokenHash) {
          // Return different room IDs based on which group code was hashed
          // The mock sees the token_hash, but we differentiate by call order
        }
        // Differentiate by tracking which groupCode is being queried
        if (fetchCallCount === 0 || mockedQuery.mock.calls.length <= 2) {
          return { rows: [{ id: roomIdA, status: 'active' }] };
        }
        return { rows: [{ id: roomIdB, status: 'active' }] };
      }
      if (text.includes('rider_current_locations')) {
        const roomParam = params?.[0];
        if (roomParam === roomIdA) {
          return { rows: [{ latitude: '14.5000', longitude: '121.0000' }] };
        }
        if (roomParam === roomIdB) {
          return { rows: [{ latitude: '40.7000', longitude: '-74.0000' }] };
        }
        return { rows: [] };
      }
      return { rows: [] };
    });

    // First request — room A
    const responseA = await request(app)
      .get(`/api/rooms/${groupCodeA}/weather`)
      .set('Authorization', `Bearer ${memberToken}`);

    expect(responseA.status).toBe(200);
    expect(responseA.body.weather.condition).toBe('clear_sky');
    expect(responseA.body.weather.temperature_celsius).toBe(30.0);

    // Reset mock to return room B on next membership query
    mockedQuery.mockImplementation(async (text: string, params?: any[]): Promise<any> => {
      if (text.includes('ride_rooms') && text.includes('room_members')) {
        return { rows: [{ id: roomIdB, status: 'active' }] };
      }
      if (text.includes('rider_current_locations')) {
        return { rows: [{ latitude: '40.7000', longitude: '-74.0000' }] };
      }
      return { rows: [] };
    });

    // Second request — room B (must NOT get room A's cached weather)
    const responseB = await request(app)
      .get(`/api/rooms/${groupCodeB}/weather`)
      .set('Authorization', `Bearer ${memberToken}`);

    expect(responseB.status).toBe(200);
    expect(responseB.body.weather.condition).toBe('rain');
    expect(responseB.body.weather.temperature_celsius).toBe(18.0);
    // Provider must have been called twice — once per room
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe('mapWeatherCode', () => {
  it('should map WMO code 0 to clear_sky', () => {
    expect(mapWeatherCode(0)).toBe('clear_sky');
  });

  it('should map WMO code 2 to partly_cloudy', () => {
    expect(mapWeatherCode(2)).toBe('partly_cloudy');
  });

  it('should map WMO code 61 to rain', () => {
    expect(mapWeatherCode(61)).toBe('rain');
  });

  it('should map WMO code 95 to thunderstorm', () => {
    expect(mapWeatherCode(95)).toBe('thunderstorm');
  });

  it('should map WMO code 96 to thunderstorm_with_hail', () => {
    expect(mapWeatherCode(96)).toBe('thunderstorm_with_hail');
  });

  it('should map WMO code 99 to thunderstorm_with_hail', () => {
    expect(mapWeatherCode(99)).toBe('thunderstorm_with_hail');
  });

  it('should map WMO code 45 to fog', () => {
    expect(mapWeatherCode(45)).toBe('fog');
  });

  it('should return unknown for unrecognized codes', () => {
    expect(mapWeatherCode(999)).toBe('unknown');
  });
});
