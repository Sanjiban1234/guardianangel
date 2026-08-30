import {
  emitLatestLocationAfterJoin,
  getCurrentPositionAfterJoin,
  resendLatestLocationForJoinedMember,
} from '../src/telemetry/location/postJoinLocation';

describe('post-join location emission', () => {
  test('resends the cached GPS sample only after room membership succeeds', async () => {
    const emitted: Array<{ joined: boolean; payload: Record<string, number | null> }> = [];
    let joined = false;
    const socketClient = {
      emitLocationUpdate: (payload: Record<string, number | null>) => emitted.push({ joined, payload }),
    };
    const latestLocation = {
      timestamp: 1_700_000_000_000,
      latitude: 27.689915,
      longitude: 85.310267,
      accuracy: 6,
      speed: null,
    };

    // This represents the original watchPosition emission before session:join;
    // the backend cannot associate it with a room yet.
    socketClient.emitLocationUpdate({ ...latestLocation, speed: 0 });
    expect(emitted[0].joined).toBe(false);

    // session:join acknowledgement establishes the backend room state.
    joined = true;
    const didEmit = emitLatestLocationAfterJoin(socketClient, '9DE6F2D11220', latestLocation);

    expect(didEmit).toBe(true);
    expect(emitted).toHaveLength(2);
    expect(emitted[1]).toEqual({
      joined: true,
      payload: {
        timestamp: 1_700_000_000_000,
        latitude: 27.689915,
        longitude: 85.310267,
        accuracy: 6,
        speed: 0,
      },
    });
  });

  test('an existing host resends its cached location when a rider joins later', () => {
    const emitted: Array<Record<string, number | null>> = [];
    const socketClient = {
      isConnected: () => true,
      emitLocationUpdate: (payload: Record<string, number | null>) => emitted.push(payload),
    };
    const hostLocation = {
      timestamp: 1_700_000_001_000,
      latitude: 27.689915,
      longitude: 85.310267,
      accuracy: 4,
      speed: undefined,
    };

    const didEmit = resendLatestLocationForJoinedMember(
      socketClient,
      '880E0910F878',
      'Sonu',
      { user_id: 'rider-id', name: 'Sanjiban' },
      hostLocation,
    );

    expect(didEmit).toBe(true);
    expect(emitted).toEqual([{
      timestamp: 1_700_000_001_000,
      latitude: 27.689915,
      longitude: 85.310267,
      accuracy: 4,
      speed: 0,
    }]);
  });

  test('does not resend for a self member event', () => {
    const socketClient = {
      isConnected: () => true,
      emitLocationUpdate: jest.fn(),
    };

    expect(resendLatestLocationForJoinedMember(
      socketClient,
      '880E0910F878',
      'Sonu',
      { user_id: 'host-id', name: 'Sonu' },
      { timestamp: 1, latitude: 27, longitude: 85, accuracy: 4, speed: 0 },
    )).toBe(false);
    expect(socketClient.emitLocationUpdate).not.toHaveBeenCalled();
  });

  test('gets a current position after join when no cached location exists, then emits it', async () => {
    const geolocation = {
      getCurrentPosition: jest.fn((success) => success({
        timestamp: 12345,
        coords: { latitude: 27.689915, longitude: 85.310267, accuracy: 5, speed: null },
      })),
    };
    const emitted: Array<Record<string, number | null>> = [];
    const location = await getCurrentPositionAfterJoin(geolocation);

    expect(emitLatestLocationAfterJoin({ emitLocationUpdate: (payload) => emitted.push(payload) }, 'RIDE123', location)).toBe(true);
    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(emitted[0]).toMatchObject({ latitude: 27.689915, longitude: 85.310267, speed: 0 });
  });

  test('an existing member can obtain a current position and resend it when a peer joins without a cache', async () => {
    const geolocation = {
      getCurrentPosition: jest.fn((success) => success({
        timestamp: 67890,
        coords: { latitude: 28.2096, longitude: 83.9856, accuracy: 7, speed: undefined },
      })),
    };
    const emitted: Array<Record<string, number | null>> = [];
    const socketClient = {
      isConnected: () => true,
      emitLocationUpdate: (payload: Record<string, number | null>) => emitted.push(payload),
    };

    const location = await getCurrentPositionAfterJoin(geolocation);
    expect(resendLatestLocationForJoinedMember(
      socketClient,
      'RIDE123',
      'Host',
      { user_id: 'rider-id', name: 'Rider' },
      location,
    )).toBe(true);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ latitude: 28.2096, longitude: 83.9856, speed: 0 });
  });

  test('handles a current-position failure without emitting', async () => {
    const geolocation = {
      getCurrentPosition: jest.fn((_success, failure) => failure({ code: 2, message: 'Location not available' })),
    };
    await expect(getCurrentPositionAfterJoin(geolocation)).rejects.toThrow('Location not available');
  });
});
