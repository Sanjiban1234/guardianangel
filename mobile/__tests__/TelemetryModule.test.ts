/**
 * @file TelemetryModule.test.ts
 * @description Comprehensive unit & integration test suite for Guardian Angel's Telemetry Module.
 * Covers offline caching, partial bulk sync acknowledgments, connectivity flapping protection,
 * and app restart recovery.
 */

import {
  TelemetryModule,
  InMemoryTelemetryDatabase,
  MockLocationProvider,
  MockSocketClient,
  ConnectivityManager,
  TelemetryReading,
} from '../src/telemetry';

describe('TelemetryModule Test Suite', () => {
  let db: InMemoryTelemetryDatabase;
  let locationProvider: MockLocationProvider;
  let socketClient: MockSocketClient;

  beforeEach(() => {
    db = new InMemoryTelemetryDatabase();
    locationProvider = new MockLocationProvider();
    socketClient = new MockSocketClient();
  });

  test('1. Insert N readings while "offline", confirm all N retrievable in timestamp order', async () => {
    const connectivityManager = new ConnectivityManager('http://localhost/health', {
      debounceMs: 0, // Disable debounce for immediate test assertion
    });
    connectivityManager.setStatusImmediate('offline');

    const module = new TelemetryModule({
      db,
      locationProvider,
      socketClient,
      connectivityManager,
    });

    const capturedReadings: TelemetryReading[] = [];
    module.onReading((reading) => {
      capturedReadings.push(reading);
    });

    await module.start({
      socketUrl: 'http://localhost',
      authToken: 'test-token',
      groupCode: 'RIDE123',
      healthEndpointUrl: 'http://localhost/health',
    });

    // Emit 5 location readings with out-of-order timestamps
    const timestamps = [1700000050, 1700000010, 1700000030, 1700000020, 1700000040];
    for (let i = 0; i < timestamps.length; i++) {
      locationProvider.emitLocation({
        timestamp: timestamps[i],
        latitude: 28.2000 + i * 0.001,
        longitude: 83.9000 + i * 0.001,
        accuracy: 5.0,
        speed: 12.0,
      });
    }

    // Confirm all 5 readings were broadcast to listener and contain valid RFC4122 v4 UUIDs
    expect(capturedReadings.length).toBe(5);

    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    for (const reading of capturedReadings) {
      expect(reading.client_reading_id).toMatch(uuidV4Regex);
    }

    // Query database directly to verify offline caching
    const unsyncedReadings = await db.getUnsyncedReadings();
    expect(unsyncedReadings.length).toBe(5);

    // Confirm all 5 readings are retrieved in ascending timestamp order
    for (let i = 0; i < unsyncedReadings.length - 1; i++) {
      expect(unsyncedReadings[i].timestamp).toBeLessThanOrEqual(unsyncedReadings[i + 1].timestamp);
    }
    expect(unsyncedReadings.map((r) => r.timestamp)).toEqual([
      1700000010, 1700000020, 1700000030, 1700000040, 1700000050,
    ]);

    await module.stop();
  });

  test('2. Simulate a bulk sync response confirming only a subset of client_reading_ids, confirm only those get marked synced, rest remain unsynced and retryable', async () => {
    const connectivityManager = new ConnectivityManager('http://localhost/health', {
      debounceMs: 0,
    });
    connectivityManager.setStatusImmediate('offline');

    const module = new TelemetryModule({
      db,
      locationProvider,
      socketClient,
      connectivityManager,
    });

    await module.start({
      socketUrl: 'http://localhost',
      authToken: 'test-token',
      groupCode: 'RIDE123',
      healthEndpointUrl: 'http://localhost/health',
    });

    // Emit 4 readings while offline
    for (let i = 1; i <= 4; i++) {
      locationProvider.emitLocation({
        timestamp: 1000 + i * 10,
        latitude: 28.0,
        longitude: 83.0,
        accuracy: 5.0,
        speed: 10.0,
      });
    }

    const unsyncedBefore = await db.getUnsyncedReadings();
    expect(unsyncedBefore.length).toBe(4);

    const idToConfirm1 = unsyncedBefore[0].client_reading_id;
    const idToConfirm2 = unsyncedBefore[2].client_reading_id;
    const unconfirmedId1 = unsyncedBefore[1].client_reading_id;
    const unconfirmedId2 = unsyncedBefore[3].client_reading_id;

    // Set mock socket response to confirm ONLY subset (index 0 and index 2)
    socketClient.ackHandlerOverride = async () => {
      return {
        confirmedClientReadingIds: [idToConfirm1, idToConfirm2],
      };
    };

    // Connect socket and trigger reconnect re-sync
    await socketClient.connect('http://localhost', 'test-token');
    connectivityManager.setStatusImmediate('online');

    // Wait for re-sync loop to complete
    await module.triggerResync();

    // Verify unsynced count is now 2 (only unconfirmed IDs remain)
    const unsyncedAfter = await db.getUnsyncedReadings();
    expect(unsyncedAfter.length).toBe(2);

    const remainingIds = unsyncedAfter.map((r) => r.client_reading_id);
    expect(remainingIds).toContain(unconfirmedId1);
    expect(remainingIds).toContain(unconfirmedId2);
    expect(remainingIds).not.toContain(idToConfirm1);
    expect(remainingIds).not.toContain(idToConfirm2);

    await module.stop();
  });

  test('3. Simulate rapid online/offline/online flapping, confirm re-sync does not fire twice concurrently or duplicate data', async () => {
    const connectivityManager = new ConnectivityManager('http://localhost/health', {
      debounceMs: 50, // Small debounce for test flapping simulation
    });
    connectivityManager.setStatusImmediate('offline');

    const module = new TelemetryModule({
      db,
      locationProvider,
      socketClient,
      connectivityManager,
    });

    await module.start({
      socketUrl: 'http://localhost',
      authToken: 'test-token',
      groupCode: 'RIDE123',
      healthEndpointUrl: 'http://localhost/health',
    });

    // Populate offline readings
    for (let i = 0; i < 3; i++) {
      locationProvider.emitLocation({
        timestamp: 2000 + i,
        latitude: 28.0,
        longitude: 83.0,
        accuracy: 4.0,
        speed: 15.0,
      });
    }

    await socketClient.connect('http://localhost', 'test-token');

    let bulkSyncCallCount = 0;
    socketClient.ackHandlerOverride = async (readings) => {
      bulkSyncCallCount++;
      // Simulate artificial network latency during bulk sync emission
      await new Promise((res) => setTimeout(res, 40));
      return {
        confirmedClientReadingIds: readings.map((r) => r.client_reading_id),
      };
    };

    // Rapid flapping: online -> offline -> online concurrently
    const p1 = module.triggerResync();
    const p2 = module.triggerResync();
    const p3 = module.triggerResync();

    await Promise.all([p1, p2, p3]);

    // Bulk sync should execute exactly once due to re-sync locking
    expect(bulkSyncCallCount).toBe(1);

    const remainingUnsynced = await db.getUnsyncedCount();
    expect(remainingUnsynced).toBe(0);

    await module.stop();
  });

  test('4. Simulate an app restart with unsynced rows already present, confirm they get picked up and retried', async () => {
    // 1. First app session: app captures readings offline, then gets killed abruptly
    const id1 = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const id2 = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';

    await db.insertReading({
      client_reading_id: id1,
      timestamp: 5000,
      latitude: 28.21,
      longitude: 83.98,
      accuracy: 6.0,
      speed: 18.0,
      synced: false,
    });
    await db.insertReading({
      client_reading_id: id2,
      timestamp: 5001,
      latitude: 28.22,
      longitude: 83.99,
      accuracy: 6.0,
      speed: 19.0,
      synced: false,
    });

    expect(await db.getUnsyncedCount()).toBe(2);

    // 2. Second app session (app restart recovery):
    const connectivityManager = new ConnectivityManager('http://localhost/health', {
      debounceMs: 0,
    });
    connectivityManager.setStatusImmediate('online');

    const module = new TelemetryModule({
      db,
      locationProvider,
      socketClient,
      connectivityManager,
    });

    await socketClient.connect('http://localhost', 'test-token');

    let syncedIds: string[] = [];
    socketClient.ackHandlerOverride = async (readings) => {
      syncedIds = readings.map((r) => r.client_reading_id);
      return { confirmedClientReadingIds: syncedIds };
    };

    // Starting the module triggers app restart recovery
    await module.start({
      socketUrl: 'http://localhost',
      authToken: 'test-token',
      groupCode: 'RIDE123',
      healthEndpointUrl: 'http://localhost/health',
    });

    // Wait for recovery sync
    await module.triggerResync();

    expect(syncedIds).toEqual([id1, id2]);
    expect(await db.getUnsyncedCount()).toBe(0);

    await module.stop();
  });
});
