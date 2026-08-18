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

  constructor(private readonly geolocation = Geolocation) {}

  async start(onReading: (reading: Omit<TelemetryReading, 'client_reading_id'>) => void): Promise<void> {
    console.log('[GPS PROVIDER START CALLED]', {
      provider: 'ForegroundGeolocationProvider',
      tracking: this.tracking,
      watchId: this.watchId,
      stack: new Error('ForegroundGeolocationProvider.start').stack,
    });
    if (this.tracking || this.watchId !== null) {
      console.log('[GPS COMMUNITY START] watcher already active; start ignored');
      return;
    }

    // Check (but do not request) Android location permission.
    // Permission requests are handled exclusively by the PermissionGate UI.
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        );
        if (!granted) {
          console.warn('[ForegroundGeo] Fine location permission not yet granted. Location updates will resume once permission is granted via PermissionGate.');
        }
      } catch (err) {
        console.warn('[ForegroundGeo] Permission check error:', err);
      }
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
      console.log(`[GPS SAMPLE] source=${source} timestamp=${timestamp} lat=${latitude.toFixed(6)} lng=${longitude.toFixed(6)} accuracy=${accuracy} speed=${speed}`);
      onReading({ timestamp, latitude, longitude, accuracy, speed });
    };
    const handleError = (source: string, error: any) => {
      console.warn(`[GPS WATCH ERROR] source=${source} code=${error?.code ?? 'unknown'} message=${error?.message ?? 'unknown'}`);
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
    console.log(`[GPS COMMUNITY WATCH ID] watchId=${this.watchId}`);
  }

  async stop(): Promise<void> {
    console.warn('[GPS PROVIDER STOP CALLED]', {
      provider: 'ForegroundGeolocationProvider',
      tracking: this.tracking,
      watchId: this.watchId,
      stack: new Error('ForegroundGeolocationProvider.stop').stack,
    });
    this.tracking = false;
    if (this.watchId !== null) {
    console.warn(`[GPS COMMUNITY STOP] watchId=${this.watchId}`);
      this.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  isTracking(): boolean {
    return this.tracking;
  }
}

/**
 * Adapter retained for TelemetryModule. It delegates directly to the
 * community foreground provider.
 */
export class CommunityGeolocationProvider implements ILocationProvider {
  private tracking = false;
  private readonly communityProvider = new ForegroundGeolocationProvider();

  async start(onReading: (reading: Omit<TelemetryReading, 'client_reading_id'>) => void): Promise<void> {
    console.log('[GPS PROVIDER START CALLED]', {
      provider: 'CommunityGeolocationProvider',
      tracking: this.tracking,
      implementation: 'community-geolocation',
      stack: new Error('CommunityGeolocationProvider.start').stack,
    });
    await this.communityProvider.start(onReading);
    this.tracking = true;
  }

  async stop(): Promise<void> {
    console.warn('[GPS PROVIDER STOP CALLED]', {
      provider: 'CommunityGeolocationProvider',
      tracking: this.tracking,
      implementation: 'community-geolocation',
      stack: new Error('CommunityGeolocationProvider.stop').stack,
    });
    await this.communityProvider.stop();
    this.tracking = false;
  }

  isTracking(): boolean {
    return this.tracking;
  }
}
