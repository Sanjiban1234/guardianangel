import { ForegroundGeolocationProvider } from '../src/telemetry/location/LocationProvider';

describe('ForegroundGeolocationProvider', () => {
  const createGeolocation = () => ({
    setRNConfiguration: jest.fn(),
    getCurrentPosition: jest.fn(),
    watchPosition: jest.fn(() => 42),
    clearWatch: jest.fn(),
  });

  it('uses one continuous native watch and normalizes a null speed', async () => {
    const geolocation = createGeolocation();
    const provider = new ForegroundGeolocationProvider(geolocation as any);
    const received: any[] = [];

    await provider.start((reading) => received.push(reading));
    await provider.start((reading) => received.push(reading));

    expect(geolocation.setRNConfiguration).toHaveBeenCalledWith({
      skipPermissionRequests: true,
      locationProvider: 'playServices',
    });
    expect(geolocation.watchPosition).toHaveBeenCalledTimes(1);

    const onWatchPosition = (geolocation.watchPosition.mock.calls as any[][])[0][0] as (position: any) => void;
    onWatchPosition({
      timestamp: 12345,
      coords: { latitude: 28.2096, longitude: 83.9856, accuracy: 4.5, speed: null },
    });

    expect(received).toEqual([{
      timestamp: 12345,
      latitude: 28.2096,
      longitude: 83.9856,
      accuracy: 4.5,
      speed: null,
    }]);
  });

  it('clears its exact native watch on stop and ignores late callbacks', async () => {
    const geolocation = createGeolocation();
    const provider = new ForegroundGeolocationProvider(geolocation as any);
    const received: any[] = [];
    await provider.start((reading) => received.push(reading));
    const onWatchPosition = (geolocation.watchPosition.mock.calls as any[][])[0][0] as (position: any) => void;

    await provider.stop();
    expect(geolocation.clearWatch).toHaveBeenCalledWith(42);

    onWatchPosition({
      timestamp: 12345,
      coords: { latitude: 28.2096, longitude: 83.9856, accuracy: 4.5, speed: 5 },
    });
    expect(received).toEqual([]);
  });

  it('waits for fine location permission before creating a watcher, then starts once and supplies a cached sample for member-join resend', async () => {
    const geolocation = createGeolocation();
    let permissionGranted = false;
    const provider = new ForegroundGeolocationProvider(geolocation as any, async () => permissionGranted);
    const received: any[] = [];

    await provider.start((reading) => received.push(reading));
    expect(geolocation.watchPosition).not.toHaveBeenCalled();

    permissionGranted = true;
    await provider.start((reading) => received.push(reading));
    await provider.start((reading) => received.push(reading));
    expect(geolocation.watchPosition).toHaveBeenCalledTimes(1);

    const onWatchPosition = (geolocation.watchPosition.mock.calls as any[][])[0][0] as (position: any) => void;
    onWatchPosition({
      timestamp: 12345,
      coords: { latitude: 27.689915, longitude: 85.310267, accuracy: 4, speed: null },
    });
    expect(received).toEqual([{
      timestamp: 12345,
      latitude: 27.689915,
      longitude: 85.310267,
      accuracy: 4,
      speed: null,
    }]);
  });
});
