import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { ILocationProvider, TelemetryReading } from '../telemetry/types';
import { RideTrackingController } from './RideTrackingController';

type NativeLocation = Omit<TelemetryReading, 'client_reading_id' | 'synced'>;

type RideTrackingNativeModule = {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): Promise<boolean>;
};

const nativeModule = NativeModules.RideTracking as RideTrackingNativeModule | undefined;

export const RideTrackingService = {
  async start(): Promise<void> {
    if (Platform.OS !== 'android') return;
    if (!nativeModule) throw new Error('RideTracking native module is unavailable');
    await nativeModule.start();
  },
  async stop(): Promise<void> {
    if (Platform.OS !== 'android' || !nativeModule) return;
    await nativeModule.stop();
  },
  async isRunning(): Promise<boolean> {
    if (Platform.OS !== 'android' || !nativeModule) return false;
    return nativeModule.isRunning();
  },
};

/** Android has exactly one location owner: RideTrackingService. */
export class AndroidRideLocationProvider implements ILocationProvider {
  private tracking = false;
  private subscription: { remove(): void } | null = null;
  private controller = new RideTrackingController(RideTrackingService);

  async start(onReading: (reading: NativeLocation) => void): Promise<void> {
    if (this.tracking) return;
    if (!nativeModule) throw new Error('RideTracking native module is unavailable');
    const emitter = new NativeEventEmitter(NativeModules.RideTracking);
    this.subscription = emitter.addListener('RideTrackingLocation', onReading);
    try {
      await this.controller.ensureStarted();
      this.tracking = true;
    } catch (error) {
      this.subscription.remove();
      this.subscription = null;
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.subscription?.remove();
    this.subscription = null;
    await this.controller.ensureStopped();
    this.tracking = false;
  }

  isTracking(): boolean {
    return this.tracking;
  }
}
