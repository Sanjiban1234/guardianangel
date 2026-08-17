/**
 * @file TelemetryModule.ts
 * @description Main composition engine for continuous telemetry ingestion,
 * offline SQLite caching, reachability monitoring, and bulk re-synchronization.
 */

import { InMemoryTelemetryDatabase } from './database/TelemetryDatabase';
import { MockLocationProvider } from './location/LocationProvider';
import { ConnectivityManager } from './connectivity/ConnectivityManager';
import { MockSocketClient } from './socket/SocketClient';
import {
  ConnectivityStatus,
  IConnectivityManager,
  ILocationProvider,
  ISocketClient,
  ITelemetryDatabase,
  TelemetryModuleOptions,
  TelemetryReading,
} from './types';

export class TelemetryModule {
  private options: TelemetryModuleOptions | null = null;
  private started = false;
  private isSyncing = false;
  private pendingResync: Promise<void> | null = null;

  private db: ITelemetryDatabase;
  private locationProvider: ILocationProvider;
  private socketClient: ISocketClient;
  private connectivityManager: IConnectivityManager | null = null;

  private readingListeners: Set<(reading: TelemetryReading) => void> = new Set();
  private connectivityListeners: Set<(status: ConnectivityStatus) => void> = new Set();

  private unsubscribeConnectivity: (() => void) | null = null;
  private currentStatus: ConnectivityStatus = 'offline';
  private readingCounter = 0;

  constructor(customAdapters?: {
    db?: ITelemetryDatabase;
    locationProvider?: ILocationProvider;
    socketClient?: ISocketClient;
    connectivityManager?: IConnectivityManager;
  }) {
    this.db = customAdapters?.db ?? new InMemoryTelemetryDatabase();
    this.locationProvider = customAdapters?.locationProvider ?? new MockLocationProvider();
    this.socketClient = customAdapters?.socketClient ?? new MockSocketClient();
    this.connectivityManager = customAdapters?.connectivityManager ?? null;
  }

  /**
   * Starts continuous telemetry ingestion for a ride session.
   */
  async start(options: TelemetryModuleOptions): Promise<void> {
    if (this.started) {
      console.warn('TelemetryModule is already running');
      return;
    }

    this.options = options;

    // Use custom adapters from options if provided
    if (options.dbAdapter) this.db = options.dbAdapter;
    if (options.locationProvider) this.locationProvider = options.locationProvider;
    if (options.socketClient) this.socketClient = options.socketClient;

    // Initialize database schema
    await this.db.init();

    // Set up connectivity manager if not supplied via custom adapters
    if (options.connectivityManager) {
      this.connectivityManager = options.connectivityManager;
    } else if (!this.connectivityManager) {
      this.connectivityManager = new ConnectivityManager(options.healthEndpointUrl, {
        healthCheckIntervalMs: options.healthCheckIntervalMs,
        reachabilityTimeoutMs: options.reachabilityTimeoutMs,
        debounceMs: options.debounceMs,
      });
    }

    // Connect socket if options provided — skip if already connected
    // (App.tsx may have already connected the shared SocketClient)
    if (options.socketUrl && options.authToken && !this.socketClient.isConnected()) {
      try {
        await this.socketClient.connect(options.socketUrl, options.authToken);
      } catch (err) {
        console.warn('Initial socket connection attempt failed:', err);
      }
    }

    // Join room session on socket if needed — skip if already connected
    // (App.tsx onConnect handler already calls joinSession for activeRoomCode)
    if (options.groupCode && !this.socketClient.isConnected()) {
      try {
        await this.socketClient.joinSession(options.groupCode);
      } catch (err) {
        console.warn('Socket session join failed:', err);
      }
    }

    // Subscribe to connectivity status updates
    this.currentStatus = this.connectivityManager.getStatus();
    this.unsubscribeConnectivity = this.connectivityManager.onStatusChange((status) => {
      this.handleConnectivityChange(status);
    });
    this.connectivityManager.start();

    // Start background location provider
    await this.locationProvider.start((rawSample) => {
      this.handleIncomingReading(rawSample);
    });

    this.started = true;

    // App Restart Recovery: Check for unsynced readings from previous abruptly-ended sessions
    const unsyncedCount = await this.db.getUnsyncedCount();
    if (unsyncedCount > 0 && this.currentStatus === 'online') {
      this.triggerResync();
    }
  }

  /**
   * Stops telemetry sampling cleanly at ride session end.
   *
   * IMPORTANT: This does NOT disconnect the socket client. The socket
   * lifecycle is managed by the caller (App.tsx useEffect). Disconnecting
   * here would race with the caller's reconnect and kill the new connection.
   *
   * `this.started` is reset synchronously before any async work so that a
   * concurrent `start()` call does not short-circuit.
   */
  async stop(): Promise<void> {
    if (!this.started) return;

    // Reset state synchronously so start() can proceed immediately
    this.started = false;
    this.isSyncing = false;

    if (this.unsubscribeConnectivity) {
      this.unsubscribeConnectivity();
      this.unsubscribeConnectivity = null;
    }

    if (this.connectivityManager) {
      this.connectivityManager.stop();
    }

    await this.locationProvider.stop();
  }

  isStarted(): boolean {
    return this.started;
  }

  getConnectivityStatus(): ConnectivityStatus {
    return this.currentStatus;
  }

  /**
   * Subscribe to live telemetry readings. Fired for all samples regardless of online/offline status.
   */
  onReading(listener: (reading: TelemetryReading) => void): () => void {
    this.readingListeners.add(listener);
    return () => {
      this.readingListeners.delete(listener);
    };
  }

  /**
   * Subscribe to online/offline state changes for UI reaction.
   */
  onConnectivityChange(listener: (status: ConnectivityStatus) => void): () => void {
    this.connectivityListeners.add(listener);
    return () => {
      this.connectivityListeners.delete(listener);
    };
  }

  private generateUUIDv4(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Process incoming raw GPS reading from location provider.
   */
  private async handleIncomingReading(
    rawSample: Omit<TelemetryReading, 'client_reading_id' | 'synced'>
  ): Promise<void> {
    const clientReadingId = this.generateUUIDv4();

    const reading: TelemetryReading = {
      client_reading_id: clientReadingId,
      timestamp: rawSample.timestamp,
      latitude: rawSample.latitude,
      longitude: rawSample.longitude,
      accuracy: rawSample.accuracy,
      speed: rawSample.speed,
      synced: false,
    };

    // Emit to reading stream subscribers (Person 2 & 4 UI components)
    this.notifyReadingListeners(reading);

    if (this.currentStatus === 'online' && this.socketClient.isConnected()) {
      // Online Path: Stream live reading via location:update
      try {
        this.socketClient.emitLocationUpdate({
          timestamp: reading.timestamp,
          latitude: reading.latitude,
          longitude: reading.longitude,
          accuracy: reading.accuracy,
          speed: reading.speed,
        });
      } catch (err) {
        console.warn('Failed to emit live location update, writing to local cache fallback:', err);
        await this.db.insertReading(reading);
      }
    } else {
      // Offline Path: Write reading to local SQLite cache
      await this.db.insertReading(reading);
    }
  }

  /**
   * Handle network status transition (online <-> offline).
   */
  private handleConnectivityChange(newStatus: ConnectivityStatus): void {
    const prevStatus = this.currentStatus;
    this.currentStatus = newStatus;

    if (prevStatus !== newStatus) {
      this.notifyConnectivityListeners(newStatus);
    }

    // Trigger re-sync when connectivity transitions to online
    if (newStatus === 'online') {
      this.triggerResync();
    }
  }

  /**
   * Perform bulk re-synchronization of cached offline readings.
   */
  async triggerResync(): Promise<void> {
    // If a re-sync is already in flight, await it instead of starting a
    // duplicate. This keeps concurrent online-transition triggers serialized
    // and lets callers wait for the active sync to actually complete.
    if (this.pendingResync) {
      return this.pendingResync;
    }

    this.pendingResync = this.runResync().finally(() => {
      this.pendingResync = null;
    });

    return this.pendingResync;
  }

  private async runResync(): Promise<void> {
    // Prevent duplicate/concurrent re-sync loops
    if (this.isSyncing) return;
    this.isSyncing = true;

    try {
      while (this.currentStatus === 'online' && this.started) {
        // Query oldest unsynced readings in batches of up to 500
        const unsyncedBatch = await this.db.getUnsyncedReadings(500);
        if (unsyncedBatch.length === 0) {
          break; // All readings synced cleanly
        }

        try {
          // Emit bulkSync to server and wait for confirmation ack
          const ack = await this.socketClient.emitBulkSync(unsyncedBatch);

          if (ack && Array.isArray(ack.confirmedClientReadingIds) && ack.confirmedClientReadingIds.length > 0) {
            const batchIds = new Set(unsyncedBatch.map(r => r.client_reading_id));
            const confirmedInBatch = ack.confirmedClientReadingIds.filter(id => batchIds.has(id));

            // Only mark confirmed client_reading_ids as synced
            await this.db.markReadingsSynced(ack.confirmedClientReadingIds);

            // Progress guard: if the ack confirms no reading from the current
            // batch (e.g. a stale/retried ack from a previous sync), the loop
            // would never make progress. Break instead of spinning forever.
            if (confirmedInBatch.length === 0) {
              break;
            }
          } else {
            // Unconfirmed batch: break sync loop safely without losing or duplicating data
            break;
          }
        } catch (syncError) {
          console.warn('Bulk sync batch emission failed or interrupted:', syncError);
          // Connection dropped mid-sync or server error: stop cleanly, retry on next reconnect
          break;
        }
      }
    } finally {
      this.isSyncing = false;
    }
  }

  private notifyReadingListeners(reading: TelemetryReading): void {
    for (const listener of this.readingListeners) {
      try {
        listener(reading);
      } catch (err) {
        console.error('Error in telemetry reading listener:', err);
      }
    }
  }

  private notifyConnectivityListeners(status: ConnectivityStatus): void {
    for (const listener of this.connectivityListeners) {
      try {
        listener(status);
      } catch (err) {
        console.error('Error in connectivity status listener:', err);
      }
    }
  }
}
