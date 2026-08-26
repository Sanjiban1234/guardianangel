/**
 * @file ConnectivityManager.ts
 * @description Real reachability inspector hitting the backend health endpoint with a 2.5-second debounce.
 */

import { ConnectivityStatus, IConnectivityManager } from '../types';

export class ConnectivityManager implements IConnectivityManager {
  private healthEndpointUrl: string;
  private checkIntervalMs: number;
  private timeoutMs: number;
  private debounceMs: number;

  private currentStatus: ConnectivityStatus = 'offline';
  private rawStatus: ConnectivityStatus = 'offline';
  private listeners: Set<(status: ConnectivityStatus) => void> = new Set();
  
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private fetchImpl: typeof fetch;

  constructor(
    healthEndpointUrl: string,
    options?: {
      healthCheckIntervalMs?: number;
      reachabilityTimeoutMs?: number;
      debounceMs?: number;
      fetchImpl?: typeof fetch;
    }
  ) {
    this.healthEndpointUrl = healthEndpointUrl;
    this.checkIntervalMs = options?.healthCheckIntervalMs ?? 10000;
    this.timeoutMs = options?.reachabilityTimeoutMs ?? 3000;
    this.debounceMs = options?.debounceMs ?? 2500;
    this.fetchImpl = options?.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : async () => { throw new Error('No fetch'); });
  }

  start(): void {
    if (this.checkTimer) return;
    // Initial immediate reachability test
    this.checkReachability();
    this.checkTimer = setInterval(() => {
      this.checkReachability();
    }, this.checkIntervalMs);
  }

  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  getStatus(): ConnectivityStatus {
    return this.currentStatus;
  }

  /**
   * Performs an explicit HTTP health ping to test backend reachability.
   */
  async checkReachability(): Promise<boolean> {
    let isReachable = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.healthEndpointUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'Cache-Control': 'no-cache' },
      });
      isReachable = response.ok;
    } catch {
      isReachable = false;
    } finally {
      clearTimeout(timeoutId);
    }

    const newRawStatus: ConnectivityStatus = isReachable ? 'online' : 'offline';
    this.processStatusUpdate(newRawStatus);
    return isReachable;
  }

  /**
   * Debounces status changes to prevent connection thrashing during network blips.
   */
  private processStatusUpdate(newRawStatus: ConnectivityStatus): void {
    if (newRawStatus === this.rawStatus && newRawStatus === this.currentStatus) {
      return;
    }

    this.rawStatus = newRawStatus;

    // If debouncer is already active, reset timer to require stable status for full duration
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      if (this.currentStatus !== this.rawStatus) {
        this.currentStatus = this.rawStatus;
        this.notifyListeners(this.currentStatus);
      }
      this.debounceTimer = null;
    }, this.debounceMs);
  }

  /**
   * For testing: force immediate status change bypassing debounce timer.
   */
  setStatusImmediate(status: ConnectivityStatus): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.rawStatus = status;
    if (this.currentStatus !== status) {
      this.currentStatus = status;
      this.notifyListeners(this.currentStatus);
    }
  }

  onStatusChange(listener: (status: ConnectivityStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(status: ConnectivityStatus): void {
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch {
        console.error('Error in connectivity listener');
      }
    }
  }
}
