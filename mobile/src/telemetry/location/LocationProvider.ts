/**
 * @file LocationProvider.ts
 * @description Continuous background location provider adapters and mock location provider for testing.
 *
 * BackgroundGeolocationProvider: Uses react-native-background-geolocation (Transistor Software).
 *   - Requires a valid commercial license for production/release builds.
 *   - If the library is not installed or license validation fails, it logs a warning
 *     and falls back to ForegroundGeolocationProvider automatically.
 *
 * ForegroundGeolocationProvider: Uses React Native's built-in Geolocation API.
 *   - No license required, works in foreground only.
 *   - Suitable fallback when BGGeo is unavailable.
 */

import { Platform, PermissionsAndroid } from 'react-native';
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
 * Foreground Location Provider using React Native's built-in Geolocation API.
 * License-free fallback when react-native-background-geolocation is unavailable.
 */
export class ForegroundGeolocationProvider implements ILocationProvider {
  private tracking = false;
  private watchId: number | null = null;

  async start(onReading: (reading: Omit<TelemetryReading, 'client_reading_id'>) => void): Promise<void> {
    // Request permissions on Android
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          console.warn('[ForegroundGeo] Fine location permission not granted');
        }
      } catch (err) {
        console.warn('[ForegroundGeo] Permission request error:', err);
      }
    }

    const geolocation = (globalThis as any).navigator?.geolocation;
    if (!geolocation) {
      console.warn('[ForegroundGeo] Geolocation API not available on this device');
      this.tracking = true;
      return;
    }

    this.tracking = true;

    // Get initial position
    geolocation.getCurrentPosition(
      (position: any) => {
        if (this.tracking) {
          onReading({
            timestamp: position.timestamp || Date.now(),
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy ?? 10.0,
            speed: position.coords.speed ?? 0.0,
          });
        }
      },
      (error: any) => {
        console.warn('[ForegroundGeo] Initial position error:', error?.message);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 },
    );

    // Watch for continuous updates
    this.watchId = geolocation.watchPosition(
      (position: any) => {
        if (this.tracking) {
          onReading({
            timestamp: position.timestamp || Date.now(),
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy ?? 10.0,
            speed: position.coords.speed ?? 0.0,
          });
        }
      },
      (error: any) => {
        console.warn('[ForegroundGeo] Watch position error:', error?.message);
      },
      {
        enableHighAccuracy: true,
        distanceFilter: 10,
        interval: 5000,
        fastestInterval: 2000,
      },
    );
  }

  async stop(): Promise<void> {
    this.tracking = false;
    if (this.watchId !== null) {
      const geolocation = (globalThis as any).navigator?.geolocation;
      if (geolocation) {
        geolocation.clearWatch(this.watchId);
      }
      this.watchId = null;
    }
  }

  isTracking(): boolean {
    return this.tracking;
  }
}

/**
 * Production Background Location Provider Adapter.
 * Integrates with react-native-background-geolocation (Transistor Software).
 *
 * If the library is not installed or license validation fails, automatically
 * falls back to ForegroundGeolocationProvider (no license required).
 */
export class BackgroundGeolocationProvider implements ILocationProvider {
  private tracking = false;
  private bgGeo: any = null;
  private fallbackProvider: ForegroundGeolocationProvider | null = null;

  constructor(bgGeoModule?: any) {
    this.bgGeo = bgGeoModule;
  }

  async start(onReading: (reading: Omit<TelemetryReading, 'client_reading_id'>) => void): Promise<void> {
    if (!this.bgGeo) {
      try {
        this.bgGeo = require('react-native-background-geolocation').default;
      } catch {
        console.warn(
          '[BGGeoProvider] react-native-background-geolocation not installed. ' +
          'Falling back to foreground geolocation (no license required).'
        );
        return this.startFallback(onReading);
      }
    }

    if (this.bgGeo) {
      try {
        // Configure native foreground service & iOS background options
        await this.bgGeo.ready({
          desiredAccuracy: this.bgGeo.DESIRED_ACCURACY_HIGH,
          distanceFilter: 10,
          stopTimeout: 1,
          debug: false,
          logLevel: this.bgGeo.LOG_LEVEL_OFF,
          stopOnTerminate: false,
          startOnBoot: true,
          notification: {
            title: 'Guardian Angel Active Ride Safety',
            text: 'Monitoring location and crash sensors for group safety.',
            color: '#14532D',
            smallIcon: 'mipmap/ic_launcher',
          },
        });

        // Register location event handler
        this.bgGeo.onLocation((location: any) => {
          onReading({
            timestamp: location.timestamp ? new Date(location.timestamp).getTime() : Date.now(),
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            accuracy: location.coords.accuracy ?? 10.0,
            speed: location.coords.speed ?? 0.0,
          });
        });

        await this.bgGeo.start();
        this.tracking = true;
      } catch (error: any) {
        // License validation errors or other BGGeo initialization failures
        const errorMessage = error?.message || String(error);
        console.warn(
          '[BGGeoProvider] Background Geolocation initialization failed: ' + errorMessage +
          '. Falling back to foreground geolocation.'
        );
        // Clean up any partial BGGeo state
        try {
          this.bgGeo.removeListeners();
        } catch (_) { /* ignore cleanup errors */ }
        this.bgGeo = null;
        return this.startFallback(onReading);
      }
    } else {
      return this.startFallback(onReading);
    }
  }

  /**
   * Fall back to foreground-only geolocation when BGGeo is unavailable.
   */
  private async startFallback(
    onReading: (reading: Omit<TelemetryReading, 'client_reading_id'>) => void,
  ): Promise<void> {
    this.fallbackProvider = new ForegroundGeolocationProvider();
    await this.fallbackProvider.start(onReading);
    this.tracking = true;
  }

  async stop(): Promise<void> {
    if (this.fallbackProvider) {
      await this.fallbackProvider.stop();
      this.fallbackProvider = null;
    } else if (this.bgGeo) {
      await this.bgGeo.stop();
      this.bgGeo.removeListeners();
    }
    this.tracking = false;
  }

  isTracking(): boolean {
    return this.tracking;
  }
}
