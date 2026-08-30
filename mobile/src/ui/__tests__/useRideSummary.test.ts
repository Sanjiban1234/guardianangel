import { fetchRideSummaryFromBackend } from '../useRideSummary';

describe('fetchRideSummaryFromBackend', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('returns only the backend-provided distance and duration', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ room_id: 'room-1', user_id: 'rider-1', total_distance_meters: 1234, duration_ms: 60000, route: [] }),
    } as Response) as typeof fetch;

    await expect(fetchRideSummaryFromBackend('GROUP1', 'token', 'https://api.example')).resolves.toEqual({
      room_id: 'room-1', group_code: 'GROUP1', user_id: 'rider-1', total_distance_meters: 1234, actual_duration_ms: 60000, average_moving_speed_kmh: null, max_filtered_speed_kmh: null, stopped_time_ms: 0, route: [], pace_benchmark: null,
    });
  });

  it('rejects an incomplete response instead of fabricating metrics', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as Response) as typeof fetch;
    await expect(fetchRideSummaryFromBackend('GROUP1', 'token', 'https://api.example')).rejects.toThrow('incomplete ride summary');
  });
});
