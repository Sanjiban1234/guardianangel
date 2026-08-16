/**
 * @file index.ts
 * @description Public interface exports for the Telemetry Ingestion and Local Cache Module.
 * Used by Person 2 (Safety/Crash Detection) and Person 4 (Live Map & Peer Markers).
 */

export { TelemetryModule } from './TelemetryModule';
export { InMemoryTelemetryDatabase, OpSqliteTelemetryDatabase } from './database/TelemetryDatabase';
export { MockLocationProvider, BackgroundGeolocationProvider, ForegroundGeolocationProvider } from './location/LocationProvider';
export { ConnectivityManager } from './connectivity/ConnectivityManager';
export { MockSocketClient, SocketClient } from './socket/SocketClient';
export type {
  TelemetryReading,
  ConnectivityStatus,
  TelemetryModuleOptions,
  ITelemetryDatabase,
  ILocationProvider,
  ISocketClient,
  IConnectivityManager,
} from './types';
