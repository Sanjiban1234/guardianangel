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
 * License-free fallback when react-native-background-geolocation is unavailable.
 */
export class ForegroundGeolocationProvider implements ILocationProvider {
  private tracking = false;
  private watchId: number | null = null;

  constructor(private readonly geolocation = Geolocation) {}

  async start(onReading: (reading: Omit<TelemetryReading, 'client_reading_id'>) => void): Promise<void> {
    if (this.tracking || this.watchId !== null) {
      console.log('[GPS FALLBACK READY] watcher already active; start ignored');
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
    console.log('[GPS FALLBACK READY] provider=@react-native-community/geolocation mode=watchPosition');

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
  }

  async stop(): Promise<void> {
    this.tracking = false;
    if (this.watchId !== null) {
      this.geolocation.clearWatch(this.watchId);
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
        console.log('[GPS PROVIDER] BackgroundGeolocation native module loaded');
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
        const state = await this.bgGeo.ready({
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
        console.log(`[GPS PROVIDER READY] enabled=${state?.enabled ?? 'unknown'} authorization=${state?.authorization ?? 'unknown'}`);

        // Register location event handler
        this.bgGeo.onLocation((location: any) => {
          const ts = location.timestamp ? new Date(location.timestamp).getTime() : Date.now();
          console.log(`[GPS SAMPLE] source=background_geolocation timestamp=${ts} lat=${location.coords.latitude?.toFixed(6)} lng=${location.coords.longitude?.toFixed(6)} accuracy=${location.coords.accuracy ?? 10.0} speed=${location.coords.speed ?? 0.0}`);
          onReading({
            timestamp: ts,
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            accuracy: location.coords.accuracy ?? 10.0,
            speed: location.coords.speed ?? 0.0,
          });
        });

        await this.bgGeo.start();
        this.tracking = true;
        console.log('[GPS PROVIDER STARTED] source=background_geolocation');
      } catch (error: any) {
        // License validation errors or other BGGeo initialization failures
        const errorMessage = error?.message || String(error);
        console.warn(
          '[GPS PROVIDER FAILED] Background Geolocation initialization failed: ' + errorMessage +
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
    console.warn('[GPS PROVIDER FALLBACK] switching to @react-native-community/geolocation');
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
