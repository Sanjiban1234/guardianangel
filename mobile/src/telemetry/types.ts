/**
 * @file types.ts
 * @description Type definitions and abstraction interfaces for Guardian Angel's
 * Telemetry Ingestion and Local Cache Module.
 */

/**
 * Raw GPS telemetry reading captured on device.
 */
export interface TelemetryReading {
  client_reading_id: string; // Client-generated unique identifier (UUID/timestamp-random)
  timestamp: number;         // Device capture Unix epoch milliseconds
  latitude: number;
  longitude: number;
  accuracy: number;          // GPS accuracy in meters
  speed: number;             // Speed in meters/second
  synced?: boolean;          // True once server acknowledgment (confirmedClientReadingIds) is received
}

/**
 * Network connectivity status for the telemetry module.
 */
export type ConnectivityStatus = 'online' | 'offline';

/**
 * Configuration options for starting the TelemetryModule.
 */
export interface TelemetryModuleOptions {
  socketUrl: string;
  authToken: string;
  groupCode: string;
  healthEndpointUrl: string;
  healthCheckIntervalMs?: number;  // Default: 10,000ms
  reachabilityTimeoutMs?: number;  // Default: 3,000ms
  debounceMs?: number;             // Default: 2,500ms
  dbAdapter?: ITelemetryDatabase;
  locationProvider?: ILocationProvider;
  socketClient?: ISocketClient;
  connectivityManager?: IConnectivityManager;
}

/**
 * Abstraction interface for the local SQLite cache repository.
 */
export interface ITelemetryDatabase {
  init(): Promise<void>;
  insertReading(reading: TelemetryReading): Promise<void>;
  getUnsyncedReadings(limit?: number): Promise<TelemetryReading[]>;
  markReadingsSynced(clientReadingIds: string[]): Promise<void>;
  getUnsyncedCount(): Promise<number>;
  clear(): Promise<void>;
}

/**
 * Abstraction interface for background location updates.
 */
export interface ILocationProvider {
  start(onReading: (reading: Omit<TelemetryReading, 'client_reading_id'>) => void): Promise<void>;
  stop(): Promise<void>;
  isTracking(): boolean;
}

/**
 * Abstraction interface for real-time WebSocket communication.
 */
export interface ISocketClient {
  connect(socketUrl: string, token: string): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
  joinSession(groupCode: string): Promise<void>;
  emitLocationUpdate(payload: Omit<TelemetryReading, 'client_reading_id' | 'synced'>): void;
  emitBulkSync(readings: TelemetryReading[]): Promise<{ confirmedClientReadingIds: string[] }>;
  onConnect(listener: () => void): () => void;
  onDisconnect(listener: () => void): () => void;
  emitEvent(event: string, payload?: Record<string, unknown>): void;
  onEvent(event: string, listener: (payload: any) => void): () => void;
}

/**
 * Abstraction interface for online/offline reachability detection.
 */
export interface IConnectivityManager {
  start(): void;
  stop(): void;
  getStatus(): ConnectivityStatus;
  checkReachability(): Promise<boolean>;
  onStatusChange(listener: (status: ConnectivityStatus) => void): () => void;
}
