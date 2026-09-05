/**
 * @file TelemetryModule.ts
 * @description Main composition engine for continuous telemetry ingestion,
 * durable offline caching, reachability monitoring, and bulk re-synchronization.
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
  private lifecycle: Promise<void> = Promise.resolve();
  private readonly deferredRooms = new Map<string, number>();
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
  private deliveryUser: string | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryMs = 12_000;
  private nextBatchAt = 0;
  private readonly liveInFlight = new Set<string>();

  restoreDelivery(userId?: string): void {
    this.deliveryUser = userId;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (userId) void this.db.init().then(() => this.triggerResync()).catch(() => console.warn('[TELEMETRY] storage unavailable'));
  }

  private scheduleRetry(): void {
    if (this.retryTimer || (!this.started && !this.deliveryUser)) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.triggerResync();
    }, this.retryMs);
  }

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
  start(options: TelemetryModuleOptions): Promise<void> {
    const task = this.lifecycle.then(() => this.startSession(options));
    this.lifecycle = task.catch(() => {});
    return task;
  }

  private async startSession(options: TelemetryModuleOptions): Promise<void> {
    console.log('[TELEMETRY START]');
    if (this.started) {
      console.warn('TelemetryModule is already running');
      return;
    }

    this.options = options;
    this.deliveryUser = options.userId;

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
      void this.handleIncomingReading(rawSample, options).catch(() => console.warn('[TELEMETRY] local persistence failed'));
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
   * Starts/stops are serialized so an old native stop cannot kill a new ride's watcher.
   */
  stop(): Promise<void> {
    const task = this.lifecycle.then(() => this.stopSession());
    this.lifecycle = task.catch(() => {});
    return task;
  }

  private async stopSession(): Promise<void> {
    console.warn('[TELEMETRY STOP]');
    if (!this.started) return;
    console.log(`[LIVE LOCATION TRACE] TelemetryModule stopping...`);

    // The next start waits until this native stop completes.
    this.started = false;
    if (this.retryTimer && !this.deliveryUser) { clearTimeout(this.retryTimer); this.retryTimer = null; }

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

  async recordLocation(raw: Omit<TelemetryReading, 'client_reading_id' | 'synced'>, groupCode: string, userId: string): Promise<void> {
    await this.db.init();
    await this.handleIncomingReading(raw, { socketUrl: '', authToken: '', healthEndpointUrl: '', groupCode, userId }, false);
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
    rawSample: Omit<TelemetryReading, 'client_reading_id' | 'synced'>,
    scope = this.options,
    notifyLiveListeners = true
  ): Promise<void> {
    console.log('[TELEMETRY RECEIVED]');
    if (!scope || !Number.isFinite(rawSample.timestamp) || !Number.isFinite(rawSample.latitude) || !Number.isFinite(rawSample.longitude) || Math.abs(rawSample.latitude) > 90 || Math.abs(rawSample.longitude) > 180 || !Number.isFinite(rawSample.accuracy) || rawSample.accuracy < 0) return;
    const clientReadingId = this.generateUUIDv4();

    const reading: TelemetryReading = {
      client_reading_id: clientReadingId,
      groupCode: scope.groupCode,
      userId: scope.userId,
      timestamp: rawSample.timestamp,
      latitude: rawSample.latitude,
      longitude: rawSample.longitude,
      accuracy: rawSample.accuracy,
      speed: rawSample.speed != null && Number.isFinite(rawSample.speed) && rawSample.speed >= 0 && rawSample.speed <= 200 ? rawSample.speed : null,
      synced: false,
    };

    // Emit to reading stream subscribers (Person 2 & 4 UI components)
    if (notifyLiveListeners) this.notifyReadingListeners(reading);

    const connectedAtCapture = this.socketClient.isConnected();
    const userAtCapture = this.deliveryUser;
    // Reserve before the async write so a concurrent backlog scan cannot take a
    // just-persisted live fix and suppress its normal safety processing.
    if (connectedAtCapture) this.liveInFlight.add(clientReadingId);
    try { await this.db.insertReading(reading); }
    catch (error) { this.liveInFlight.delete(clientReadingId); throw error; }
    if (connectedAtCapture && this.socketClient.isConnected() && userAtCapture === this.deliveryUser && (!reading.userId || reading.userId === this.deliveryUser)) {
      const timeout = setTimeout(() => { this.liveInFlight.delete(clientReadingId); this.scheduleRetry(); }, 10_000);
      try {
        this.socketClient.emitLocationUpdate(reading, response => {
          clearTimeout(timeout);
          this.liveInFlight.delete(clientReadingId);
          if (response?.sampleId === clientReadingId && (response.accepted || response.permanent)) {
            if (response.permanent) console.warn('[TELEMETRY] invalid sample rejected');
            void this.db.markReadingsSynced([clientReadingId]).catch(() => this.scheduleRetry());
          } else this.scheduleRetry();
        });
      } catch { clearTimeout(timeout); this.liveInFlight.delete(clientReadingId); }
    } else this.liveInFlight.delete(clientReadingId);
    this.scheduleRetry();
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

    this.pendingResync = this.runResync().catch(() => {
      this.retryMs = Math.min(60_000, this.retryMs * 2);
      console.warn('[TELEMETRY] pending storage read failed; retry scheduled');
    }).finally(() => {
      this.pendingResync = null;
      this.scheduleRetry();
    });

    return this.pendingResync;
  }

  private async runResync(): Promise<void> {
    // Prevent duplicate/concurrent re-sync loops
    if (this.isSyncing) return;
    this.isSyncing = true;
    const deliveryUser = this.deliveryUser;

    try {
      while (this.socketClient.isConnected() && (this.started || !!this.deliveryUser)) {
        // Oldest first, with one room and at most 100 readings per upload.
        const excluded = [...this.deferredRooms].filter(([, until]) => until > Date.now()).map(([room]) => room);
        const pending = await this.db.getUnsyncedReadings(100, deliveryUser, excluded);
        if (deliveryUser !== this.deliveryUser || Date.now() < this.nextBatchAt) break;
        const available = pending.filter(r => !this.liveInFlight.has(r.client_reading_id));
        const unsyncedBatch = available.filter(r => r.groupCode === available[0]?.groupCode);
        if (unsyncedBatch.length === 0) {
          break; // All readings synced cleanly
        }

        try {
          // Emit bulkSync to server and wait for confirmation ack
          this.nextBatchAt = Date.now() + 12_000;
          const ack = await this.socketClient.emitBulkSync(unsyncedBatch);

          if (ack?.rejectedClientReadingIds?.length) {
            const rejected = ack.rejectedClientReadingIds.filter(id => unsyncedBatch.some(r => r.client_reading_id === id));
            console.warn('[TELEMETRY] permanently invalid samples rejected', rejected.length);
            await this.db.markReadingsSynced(rejected);
          }
          if (ack && Array.isArray(ack.confirmedClientReadingIds) && ack.confirmedClientReadingIds.length > 0) {
            const batchIds = new Set(unsyncedBatch.map(r => r.client_reading_id));
            const confirmedInBatch = ack.confirmedClientReadingIds.filter(id => batchIds.has(id));

            // Only mark confirmed client_reading_ids as synced
            await this.db.markReadingsSynced(confirmedInBatch);
            this.retryMs = 12_000;

            // Progress guard: if the ack confirms no reading from the current
            // batch (e.g. a stale/retried ack from a previous sync), the loop
            // would never make progress. Break instead of spinning forever.
            if (confirmedInBatch.length === 0) {
              break;
            }
          } else {
            if (unsyncedBatch[0].groupCode) this.deferredRooms.set(unsyncedBatch[0].groupCode, Date.now() + 60_000);
            // A revoked/removed membership is retained, but cannot starve other rooms.
            this.retryMs = 12_000;
            // Unconfirmed batch: break sync loop safely without losing or duplicating data
            break;
          }
          break; // One 100-point batch per tick; live delivery remains independent.
        } catch {
          this.retryMs = Math.min(60_000, this.retryMs * 2);
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
