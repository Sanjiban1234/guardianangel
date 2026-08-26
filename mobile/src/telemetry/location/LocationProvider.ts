/**
 * @file LocationProvider.ts
 * @description Community native location provider adapters and mock location provider for testing.
 *
 * CommunityGeolocationProvider and ForegroundGeolocationProvider use
 * @react-native-community/geolocation with a native watchPosition subscription.
 */

import { Platform, PermissionsAndroid } from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import { ILocationProvider, TelemetryReading } from '../types';
import { AndroidRideLocationProvider } from '../../tracking';

/**
 * Mock Location Provider for unit tests, offline testing, and dev simulation.
 * Allows manually emitting GPS readings or starting an interval emitter.
 */
export class MockLocationProvider implements ILocationProvider {
  private tracking = false;
  private onReadingCallback: ((reading: Omit<TelemetryReading, 'client_reading_id'>) => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  async start(onReading: (reading: Omit<TelemetryReading, 'client_reading_id'>) => void): Promise<void> {
    this.tracking = true;
    this.onReadingCallback = onReading;
  }

  async stop(): Promise<void> {
    this.tracking = false;
    this.onReadingCallback = null;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isTracking(): boolean {
    return this.tracking;
  }

  /**
   * Manually push a simulated location update to the active listener.
   */
  emitLocation(sample: Omit<TelemetryReading, 'client_reading_id' | 'synced'>): void {
    if (this.tracking && this.onReadingCallback) {
      this.onReadingCallback(sample);
    }
  }

  /**
   * Start periodic emission of fake GPS points for continuous integration tests.
   */
  startPeriodicSimulation(intervalMs = 1000, baseLat = 28.2096, baseLng = 83.9856): void {
    if (this.timer) clearInterval(this.timer);
    let step = 0;
    this.timer = setInterval(() => {
      if (this.tracking && this.onReadingCallback) {
        step++;
        this.emitLocation({
          timestamp: Date.now(),
          latitude: baseLat + step * 0.0001,
          longitude: baseLng + step * 0.0001,
          accuracy: 5.0,
          speed: 15.2,
        });
      }
    }, intervalMs);
  }
}

/**
 * Foreground Location Provider using the community native geolocation module.
 * Release-safe Android location provider using the community native module.
 */
export class ForegroundGeolocationProvider implements ILocationProvider {
  private tracking = false;
  private watchId: number | null = null;

  constructor(
    private readonly geolocation = Geolocation,
    private readonly hasFineLocationPermission = async (): Promise<boolean> => {
      if (Platform.OS !== 'android') return true;
      return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
    },
  ) {}

  async start(onReading: (reading: Omit<TelemetryReading, 'client_reading_id'>) => void): Promise<void> {
    console.log('[GPS PROVIDER START CALLED]');
    if (this.tracking || this.watchId !== null) {
      console.log('[GPS COMMUNITY START] watcher already active; start ignored');
      return;
    }

    // PermissionGate owns prompts. Never create a native watcher until it has
    // granted ACCESS_FINE_LOCATION.
    try {
      if (!await this.hasFineLocationPermission()) {
        console.warn('[ForegroundGeo] Fine location permission not yet granted. GPS watcher not started.');
        return;
      }
    } catch {
      console.warn('[ForegroundGeo] Permission check failed. GPS watcher not started.');
      return;
    }

    this.tracking = true;
    this.geolocation.setRNConfiguration({
      // PermissionGate owns all user prompts, avoiding duplicate native prompts.
      skipPermissionRequests: true,
      locationProvider: 'playServices',
    });
    console.log('[GPS COMMUNITY START] provider=@react-native-community/geolocation mode=watchPosition');

    const handlePosition = (source: 'foreground_initial' | 'foreground_watch', position: any) => {
      if (!this.tracking) return;
      const timestamp = typeof position.timestamp === 'number' ? position.timestamp : Date.now();
      const latitude = Number(position.coords?.latitude);
      const longitude = Number(position.coords?.longitude);
      const accuracy = Number.isFinite(position.coords?.accuracy) ? position.coords.accuracy : 10.0;
      const speed = Number.isFinite(position.coords?.speed) ? position.coords.speed : 0.0;
      console.log('[GPS SAMPLE RECEIVED]');
      onReading({ timestamp, latitude, longitude, accuracy, speed });
    };
    const handleError = (_source: string, _error: any) => {
      console.warn('[GPS WATCH ERROR]');
    };

    // Produce an initial fix while the continuous watcher is establishing.
    this.geolocation.getCurrentPosition(
      (position: any) => {
        handlePosition('foreground_initial', position);
      },
      (error: any) => handleError('foreground_initial', error),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 },
    );

    // Watch for continuous updates
    this.watchId = this.geolocation.watchPosition(
      (position: any) => {
        handlePosition('foreground_watch', position);
      },
      (error: any) => handleError('foreground_watch', error),
      {
        enableHighAccuracy: true,
        distanceFilter: 10,
        interval: 5000,
        fastestInterval: 2000,
      },
    );
    console.log('[GPS COMMUNITY WATCH STARTED]');
  }

  async stop(): Promise<void> {
    console.warn('[GPS PROVIDER STOP CALLED]');
    this.tracking = false;
    if (this.watchId !== null) {
      console.warn('[GPS COMMUNITY STOP]');
      this.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  isTracking(): boolean {
    return this.tracking;
  }
}

/**
 * Chooses the Android foreground ride service for active rides, retaining the
 * community provider on the remaining platforms.
 */
export class CommunityGeolocationProvider implements ILocationProvider {
  private tracking = false;
  private readonly provider: ILocationProvider = Platform.OS === 'android'
    ? new AndroidRideLocationProvider()
    : new ForegroundGeolocationProvider();

  async start(onReading: (reading: Omit<TelemetryReading, 'client_reading_id'>) => void): Promise<void> {
    console.log('[GPS PROVIDER START CALLED]');
    await this.provider.start(onReading);
    this.tracking = this.provider.isTracking();
  }

  async stop(): Promise<void> {
    console.warn('[GPS PROVIDER STOP CALLED]');
    await this.provider.stop();
    this.tracking = false;
  }

  isTracking(): boolean {
    return this.tracking;
  }
}
