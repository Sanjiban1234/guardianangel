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
    console.log('[TELEMETRY START]');
    if (this.started) {
      console.warn('TelemetryModule is already running');
      return;
    }

    this.options = options;

    // Use custom adapters from options if provided
    if (options.dbAdapter) this.db = options.dbAdapter;
    if (options.locationProvider) this.locationProvider = options.locationProvider;
    // NOTE: socketClient is NOT replaced here. App.tsx provides a socketLifecycleGuard
    // that delegates emitLocationUpdate to the real SocketClient while blocking
    // connect()/disconnect() to prevent TelemetryModule from destroying the
    // App.tsx-managed socket connection. Previous code replaced the guard here,
    // which caused a race condition destroying and recreating the socket on every
    // activeRoomCode change, wiping out onEvent('location:broadcast') listeners.

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

    // Socket connection and session join are managed exclusively by App.tsx.
    // TelemetryModule must NOT call connect()/joinSession() because:
    // 1. App.tsx passes a socketLifecycleGuard with no-op connect/disconnect
    // 2. Calling connect() on the real SocketClient destroys the in-progress
    //    connection set up by App.tsx, wiping out onEvent listeners.
    // The socketLifecycleGuard delegates emitLocationUpdate() to the real socket,
    // so location emission works without TelemetryModule managing the connection.

    // Subscribe to connectivity status updates
    this.currentStatus = this.connectivityManager.getStatus();
    this.unsubscribeConnectivity = this.connectivityManager.onStatusChange((status) => {
      this.handleConnectivityChange(status);
    });
    this.connectivityManager.start();

    // Start background location provider
    console.log(`[LIVE LOCATION TRACE] [TRACE 2] Starting location provider...`);
    await this.locationProvider.start((rawSample) => {
      this.handleIncomingReading(rawSample);
    });

    this.started = true;
    console.log('[TELEMETRY STARTED]');

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
    console.warn('[TELEMETRY STOP]');
    if (!this.started) return;
    console.log(`[LIVE LOCATION TRACE] TelemetryModule stopping...`);

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
    console.log('[TELEMETRY RECEIVED]');
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

    // Try to emit live via socket. SocketClient.emitLocationUpdate() already
    // guards on this.connected internally, so no separate connectivity check needed.
    // Previous code gated on this.currentStatus === 'online' (ConnectivityManager),
    // which starts as 'offline' and debounces by 2.5s — blocking ALL live emission
    // during every stop/start cycle. The ConnectivityManager gate is redundant:
    // if the socket is connected, the backend is reachable; if not, emitLocationUpdate
    // silently no-ops and we fall back to cache.
    const socketConnected = this.socketClient.isConnected();
    console.log(`[TELEMETRY SOCKET CHECK] connected=${socketConnected}`);
    if (socketConnected) {
      try {
        console.log('[TELEMETRY SENT]');
        this.socketClient.emitLocationUpdate({
          timestamp: reading.timestamp,
          latitude: reading.latitude,
          longitude: reading.longitude,
          accuracy: reading.accuracy,
          speed: reading.speed,
        });
        console.log('[TELEMETRY SENT]');
      } catch {
        console.warn('[LIVE LOCATION TRACE] [TRACE 3x] Emit failed, caching');
        await this.db.insertReading(reading);
      }
    } else {
      // Offline Path: Write reading to local SQLite cache
      console.log(`[LIVE LOCATION AUDIT] Offline — caching reading locally (status=${this.currentStatus}, connected=${this.socketClient.isConnected()})`);
      console.log(`[LIVE LOCATION TRACE] [TRACE 3-BLOCKED] Socket not connected — caching locally`);
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
        const unsyncedBatch = await this.db.getUnsyncedReadings(300);
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
        } catch {
          console.warn('Bulk sync batch emission failed or interrupted');
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
      } catch {
        console.error('Error in telemetry reading listener');
      }
    }
  }

  private notifyConnectivityListeners(status: ConnectivityStatus): void {
    for (const listener of this.connectivityListeners) {
      try {
        listener(status);
      } catch {
        console.error('Error in connectivity status listener');
      }
    }
  }
}
