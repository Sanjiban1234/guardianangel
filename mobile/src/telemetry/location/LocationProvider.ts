/**
 * @file LocationProvider.ts
 * @description Continuous background location provider adapters and mock location provider for testing.
 */

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
 * Production Background Location Provider Adapter.
 * Integrates with react-native-background-geolocation (Transistor Software).
 */
export class BackgroundGeolocationProvider implements ILocationProvider {
  private tracking = false;
  private bgGeo: any = null;

  constructor(bgGeoModule?: any) {
    this.bgGeo = bgGeoModule;
  }

  async start(onReading: (reading: Omit<TelemetryReading, 'client_reading_id'>) => void): Promise<void> {
    if (!this.bgGeo) {
      try {
        this.bgGeo = require('react-native-background-geolocation').default;
      } catch {
        console.warn('react-native-background-geolocation library not installed. Location provider inactive.');
        this.tracking = true;
        return;
      }
    }

    if (this.bgGeo) {
      // Configure native foreground service & iOS background options
      await this.bgGeo.ready({
        desiredAccuracy: this.bgGeo.DESIRED_ACCURACY_HIGH,
        distanceFilter: 10,
        stopTimeout: 1,
        debug: false, // Set to true to hear debug sound effects during native testing
        logLevel: this.bgGeo.LOG_LEVEL_OFF,
        stopOnTerminate: false, // Continue tracking if app is terminated
        startOnBoot: true,      // Resume tracking on device reboot if ride session is active
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
    }

    this.tracking = true;
  }

  async stop(): Promise<void> {
    if (this.bgGeo) {
      await this.bgGeo.stop();
      this.bgGeo.removeListeners();
    }
    this.tracking = false;
  }

  isTracking(): boolean {
    return this.tracking;
  }
}
