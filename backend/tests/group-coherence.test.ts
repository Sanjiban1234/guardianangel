import { QueryRunner } from '../src/db/QueryRunner';
import { GroupCoherenceService } from '../src/services/GroupCoherenceService';
import { PresenceService } from '../src/services/PresenceService';

describe('GroupCoherenceService Unit & Integration Tests', () => {
  let mockQueryFn: jest.Mock;
  let queryRunner: QueryRunner;
  let presenceService: PresenceService;
  let coherenceService: GroupCoherenceService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryFn = jest.fn();
    queryRunner = new QueryRunner(mockQueryFn);
    presenceService = new PresenceService(queryRunner);
    coherenceService = new GroupCoherenceService(presenceService);
  });

  describe('Pure Mathematical Utilities', () => {
    it('should calculate Haversine distance correctly', () => {
      // Coordinates approx 1 km apart along meridian
      const lat1 = 28.2000;
      const lon1 = 83.9800;
      const lat2 = 28.2090; // ~1 km north
      const lon2 = 83.9800;

      const dist = coherenceService.calculateHaversineDistance(lat1, lon1, lat2, lon2);
      expect(dist).toBeGreaterThan(990);
      expect(dist).toBeLessThan(1010);
    });

    it('should calculate safe speed recommendations with +15% / +15 km/h cap for separated rider', () => {
      // Separated rider speed: 20 m/s (72 km/h)
      // Group speed: 20 m/s (72 km/h)
      // Separated dist to midpoint: 1000m, Group dist to midpoint: 500m
      const result = coherenceService.calculateSpeedRecommendations(20, 1000, 20, 500);

      // Raw target speed for separated rider would be higher, but capped at +15% (20 * 1.15 = 23 m/s) or +4.17 m/s (24.17 m/s)
      expect(result.separatedRecommendedSpeed).toBeLessThanOrEqual(23.0);
      expect(result.separatedRecommendedSpeed).toBeGreaterThanOrEqual(20.0);

      // Group speed reduction capped at max -20% (20 * 0.80 = 16 m/s)
      expect(result.groupRecommendedSpeed).toBeGreaterThanOrEqual(16.0);
      expect(result.groupRecommendedSpeed).toBeLessThanOrEqual(20.0);
    });

    it('should return null speed recommendation when rider is stationary or below low-speed threshold', () => {
      // Separated rider moving at 0.5 m/s (< 1.4 m/s threshold)
      const result = coherenceService.calculateSpeedRecommendations(0.5, 500, 15, 500);

      expect(result.separatedRecommendedSpeed).toBeNull();
      expect(result.groupRecommendedSpeed).not.toBeNull();
    });
  });

  describe('evaluateRoomCoherence logic', () => {
    const groupCode = 'COHERENCE123';

    it('should return no alerts or reunions when room has fewer than 2 riders', async () => {
      mockQueryFn.mockResolvedValueOnce({
        rows: [
          {
            user_id: 'user-1',
            name: 'Alice',
            latitude: 28.2000,
            longitude: 83.9800,
            speed: 15.0,
            timestamp: 1720000000000,
          },
        ],
      });


      const res = await coherenceService.evaluateRoomCoherence(groupCode);
      expect(res.alerts).toHaveLength(0);
      expect(res.reunions).toHaveLength(0);
    });

    it('should NOT trigger false positive for a strung-out group formation where nearest-neighbor distance is < 500m', async () => {
      // 3 riders strung out linearly along a road, 350m apart from each other
      // A (0m) --- B (350m) --- C (700m)
      mockQueryFn.mockResolvedValueOnce({
        rows: [
          {
            user_id: 'user-a',
            name: 'Rider A',
            latitude: 28.2000,
            longitude: 83.9800,
            speed: 15.0,
            timestamp: 1720000000000,
          },
          {
            user_id: 'user-b',
            name: 'Rider B',
            latitude: 28.20315, // ~350m north
            longitude: 83.9800,
            speed: 15.0,
            timestamp: 1720000000000,
          },
          {
            user_id: 'user-c',
            name: 'Rider C',
            latitude: 28.20630, // ~350m north of B (~700m north of A)
            longitude: 83.9800,
            speed: 15.0,
            timestamp: 1720000000000,
          },
        ],
      });

      // Run evaluation at t=0 and t=35s
      await coherenceService.evaluateRoomCoherence(groupCode, 1000);
      mockQueryFn.mockResolvedValueOnce({
        rows: [
          {
            user_id: 'user-a',
            name: 'Rider A',
            latitude: 28.2000,
            longitude: 83.9800,
            speed: 15.0,
            timestamp: 1720000035000,
          },
          {
            user_id: 'user-b',
            name: 'Rider B',
            latitude: 28.20315,
            longitude: 83.9800,
            speed: 15.0,
            timestamp: 1720000035000,
          },
          {
            user_id: 'user-c',
            name: 'Rider C',
            latitude: 28.20630,
            longitude: 83.9800,
            speed: 15.0,
            timestamp: 1720000035000,
          },
        ],
      });

      const res = await coherenceService.evaluateRoomCoherence(groupCode, 36000);
      expect(res.alerts).toHaveLength(0);
      expect(res.reunions).toHaveLength(0);
    });

    it('should trigger separation alert when nearest rider distance > 500m for >= 30 seconds', async () => {
      const mockRidersSeparated = [
        {
          user_id: 'user-group-1',
          name: 'Bob',
          latitude: 28.2000,
          longitude: 83.9800,
          speed: 15.0,
          timestamp: 1720000000000,
        },
        {
          user_id: 'user-group-2',
          name: 'Charlie',
          latitude: 28.2005,
          longitude: 83.9800,
          speed: 15.0,
          timestamp: 1720000000000,
        },
        {
          user_id: 'user-separated',
          name: 'Dave',
          vehicle_model: 'Yamaha MT-15',
          plate_number: 'BA 12 PA 3456',
          latitude: 28.2100, // ~1.1 km away
          longitude: 83.9800,
          speed: 15.0,
          timestamp: 1720000000000,
        },
      ];

      // Initial detection at t = 1000ms
      mockQueryFn.mockResolvedValueOnce({ rows: mockRidersSeparated });
      let res = await coherenceService.evaluateRoomCoherence(groupCode, 1000);
      expect(res.alerts).toHaveLength(0); // Not yet 30 seconds

      // Second check at t = 31,500ms (30.5s later)
      mockQueryFn.mockResolvedValueOnce({ rows: mockRidersSeparated });
      res = await coherenceService.evaluateRoomCoherence(groupCode, 31500);
      expect(res.alerts).toHaveLength(1);

      const alert = res.alerts[0];
      expect(alert.separated_rider.user_id).toBe('user-separated');
      expect(alert.separated_rider.name).toBe('Dave');
      expect(alert.separated_rider.vehicle_model).toBe('Yamaha MT-15');
      expect(alert.separated_rider.plate_number).toBe('BA 12 PA 3456');
      expect(alert.separated_rider.distance_from_nearest_meters).toBeGreaterThan(1000);
      expect(alert.meeting_point.is_approximate).toBe(true);
      expect(alert.separated_rider.recommended_speed).not.toBeNull();
      expect(alert.group_recommendation.recommended_speed).not.toBeNull();
    });

    it('should respect 30-second cooldown between alerts', async () => {
      const mockRidersSeparated = [
        {
          user_id: 'user-g1',
          name: 'Bob',
          latitude: 28.2000,
          longitude: 83.9800,
          speed: 15.0,
          timestamp: 1720000000000,
        },
        {
          user_id: 'user-g2',
          name: 'Charlie',
          latitude: 28.2005,
          longitude: 83.9800,
          speed: 15.0,
          timestamp: 1720000000000,
        },
        {
          user_id: 'user-sep',
          name: 'Dave',
          latitude: 28.2100, // ~1.1 km away
          longitude: 83.9800,
          speed: 15.0,
          timestamp: 1720000000000,
        },
      ];

      // t=0 (start tracking)
      mockQueryFn.mockResolvedValueOnce({ rows: mockRidersSeparated });
      await coherenceService.evaluateRoomCoherence(groupCode, 0);

      // t=30,000ms (first alert emitted)
      mockQueryFn.mockResolvedValueOnce({ rows: mockRidersSeparated });
      let res = await coherenceService.evaluateRoomCoherence(groupCode, 30000);
      expect(res.alerts).toHaveLength(1);

      // t=40,000ms (10s later, cooldown active -> 0 alerts)
      mockQueryFn.mockResolvedValueOnce({ rows: mockRidersSeparated });
      res = await coherenceService.evaluateRoomCoherence(groupCode, 40000);
      expect(res.alerts).toHaveLength(0);

      // t=61,000ms (31s later, cooldown expired -> new alert)
      mockQueryFn.mockResolvedValueOnce({ rows: mockRidersSeparated });
      res = await coherenceService.evaluateRoomCoherence(groupCode, 61000);
      expect(res.alerts).toHaveLength(1);
    });

    it('should trigger reunion event when distance drops <= 300m for >= 15 seconds', async () => {
      const mockRidersSeparated = [
        {
          user_id: 'user-g1',
          name: 'Bob',
          latitude: 28.2000,
          longitude: 83.9800,
          speed: 15.0,
          timestamp: 1720000000000,
        },
        {
          user_id: 'user-g2',
          name: 'Charlie',
          latitude: 28.2005,
          longitude: 83.9800,
          speed: 15.0,
          timestamp: 1720000000000,
        },
        {
          user_id: 'user-sep',
          name: 'Dave',
          latitude: 28.2100,
          longitude: 83.9800,
          speed: 15.0,
          timestamp: 1720000000000,
        },
      ];

      // t=0 (start tracking)
      mockQueryFn.mockResolvedValueOnce({ rows: mockRidersSeparated });
      await coherenceService.evaluateRoomCoherence(groupCode, 0);

      // t=30,000ms (separated alert emitted)
      mockQueryFn.mockResolvedValueOnce({ rows: mockRidersSeparated });
      await coherenceService.evaluateRoomCoherence(groupCode, 30000);

      // Dave moves close to Bob (200m away)
      const mockRidersReunited = [
        {
          user_id: 'user-g1',
          name: 'Bob',
          latitude: 28.2000,
          longitude: 83.9800,
          speed: 15.0,
          timestamp: 1720000040000,
        },
        {
          user_id: 'user-g2',
          name: 'Charlie',
          latitude: 28.2005,
          longitude: 83.9800,
          speed: 15.0,
          timestamp: 1720000040000,
        },
        {
          user_id: 'user-sep',
          name: 'Dave',
          latitude: 28.2018, // ~200m away
          longitude: 83.9800,
          speed: 15.0,
          timestamp: 1720000040000,
        },
      ];

      // t=40,000ms (start tracking reunion)
      mockQueryFn.mockResolvedValueOnce({ rows: mockRidersReunited });
      let res = await coherenceService.evaluateRoomCoherence(groupCode, 40000);
      expect(res.reunions).toHaveLength(0); // Not yet 15s

      // t=56,000ms (16s later -> reunion event emitted)
      mockQueryFn.mockResolvedValueOnce({ rows: mockRidersReunited });
      res = await coherenceService.evaluateRoomCoherence(groupCode, 56000);
      expect(res.reunions).toHaveLength(1);
      expect(res.reunions[0].user_id).toBe('user-sep');
      expect(res.reunions[0].name).toBe('Dave');
    });

    it('does not create a new separation when the other rider is disconnected and stale', async () => {
      const now = Date.now();
      presenceService.markConnected(groupCode, 'user-a', 'socket-a');
      presenceService.markConnected(groupCode, 'user-b', 'socket-b');
      mockQueryFn.mockResolvedValueOnce({ rows: [
        { user_id: 'user-a', name: 'A', role: 'member', latitude: 28.2, longitude: 83.98, speed: 15, last_updated_at: now },
        { user_id: 'user-b', name: 'B', role: 'member', latitude: 28.21, longitude: 83.98, speed: 15, last_updated_at: now },
      ] });
      await coherenceService.evaluateRoomCoherence(groupCode, now);

      presenceService.markDisconnected(groupCode, 'user-b', 'socket-b');
      mockQueryFn.mockResolvedValueOnce({ rows: [
        { user_id: 'user-a', name: 'A', role: 'member', latitude: 28.205, longitude: 83.98, speed: 15, last_updated_at: now + 31_000 },
        { user_id: 'user-b', name: 'B', role: 'member', latitude: 28.21, longitude: 83.98, speed: 15, last_updated_at: now - 16_000 },
      ] });
      const result = await coherenceService.evaluateRoomCoherence(groupCode, now + 31_000);
      expect(result.alerts).toHaveLength(0);
      expect(result.reunions).toHaveLength(0);
    });

    it('keeps a separated rider in insufficient-data state when that rider becomes stale', async () => {
      const now = Date.now();
      presenceService.markConnected(groupCode, 'user-a', 'socket-a');
      presenceService.markConnected(groupCode, 'user-b', 'socket-b');
      const separated = [
        { user_id: 'user-a', name: 'A', role: 'member', latitude: 28.2, longitude: 83.98, speed: 15, last_updated_at: now },
        { user_id: 'user-b', name: 'B', role: 'member', latitude: 28.21, longitude: 83.98, speed: 15, last_updated_at: now },
      ];
      mockQueryFn.mockResolvedValueOnce({ rows: separated });
      await coherenceService.evaluateRoomCoherence(groupCode, now);
      mockQueryFn.mockResolvedValueOnce({ rows: separated.map(r => ({ ...r, last_updated_at: now + 31_000 })) });
      expect((await coherenceService.evaluateRoomCoherence(groupCode, now + 31_000)).alerts).toHaveLength(2);

      presenceService.markDisconnected(groupCode, 'user-b', 'socket-b');
      mockQueryFn.mockResolvedValueOnce({ rows: [
        { ...separated[0], last_updated_at: now + 32_000 },
        { ...separated[1], latitude: 28.201, last_updated_at: now - 16_000 },
      ] });
      const result = await coherenceService.evaluateRoomCoherence(groupCode, now + 32_000);
      expect(result.reunions).toHaveLength(0);
    });

    it('resumes coherence only after a disconnected rider reconnects with fresh telemetry', async () => {
      const now = Date.now();
      presenceService.markConnected(groupCode, 'user-a', 'socket-a');
      presenceService.markConnected(groupCode, 'user-b', 'socket-b');
      presenceService.markDisconnected(groupCode, 'user-b', 'socket-b');
      mockQueryFn.mockResolvedValueOnce({ rows: [
        { user_id: 'user-a', name: 'A', role: 'member', latitude: 28.2, longitude: 83.98, speed: 15, last_updated_at: now },
        { user_id: 'user-b', name: 'B', role: 'member', latitude: 28.21, longitude: 83.98, speed: 15, last_updated_at: now - 16_000 },
      ] });
      expect((await coherenceService.evaluateRoomCoherence(groupCode, now)).alerts).toHaveLength(0);

      presenceService.markConnected(groupCode, 'user-b', 'socket-b2');
      const fresh = [
        { user_id: 'user-a', name: 'A', role: 'member', latitude: 28.2, longitude: 83.98, speed: 15, last_updated_at: now + 1_000 },
        { user_id: 'user-b', name: 'B', role: 'member', latitude: 28.21, longitude: 83.98, speed: 15, last_updated_at: now + 1_000 },
      ];
      mockQueryFn.mockResolvedValueOnce({ rows: fresh });
      await coherenceService.evaluateRoomCoherence(groupCode, now + 1_000);
      mockQueryFn.mockResolvedValueOnce({ rows: fresh.map(r => ({ ...r, last_updated_at: now + 32_000 })) });
      expect((await coherenceService.evaluateRoomCoherence(groupCode, now + 32_000)).alerts).toHaveLength(2);
    });

  });
});
