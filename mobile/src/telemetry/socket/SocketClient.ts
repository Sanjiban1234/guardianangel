/**
 * @file SocketClient.ts
 * @description WebSocket communication module for Socket.IO integration and mock socket client for unit testing.
 */

import { ISocketClient, TelemetryReading } from '../types';

/**
 * Mock Socket Client for unit and integration testing without live backend socket connection.
 */
export class MockSocketClient implements ISocketClient {
  private connected = false;
  private connectListeners: Set<() => void> = new Set();
  private disconnectListeners: Set<() => void> = new Set();
  
  public locationUpdatesEmitted: Array<Omit<TelemetryReading, 'client_reading_id' | 'synced'>> = [];
  public bulkSyncsEmitted: Array<TelemetryReading[]> = [];
  public ackHandlerOverride: ((readings: TelemetryReading[]) => Promise<{ confirmedClientReadingIds: string[]; rejectedClientReadingIds?: string[] }>) | null = null;

  async connect(socketUrl: string, token: string): Promise<void> {
    this.connected = true;
    for (const l of this.connectListeners) l();
  }

  disconnect(): void {
    if (this.connected) {
      this.connected = false;
      for (const l of this.disconnectListeners) l();
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async joinSession(groupCode: string): Promise<void> {
    if (!this.connected) {
      throw new Error('Socket not connected');
    }
  }

  emitLocationUpdate(payload: Omit<TelemetryReading, 'client_reading_id' | 'synced'> & { client_reading_id?: string }, ack?: (response: { accepted: boolean; sampleId?: string; permanent?: boolean }) => void): void {
    if (this.connected) {
      this.locationUpdatesEmitted.push({ ...payload });
      ack?.({ accepted: true, sampleId: payload.client_reading_id });
    }
  }

  async emitBulkSync(readings: TelemetryReading[]): Promise<{ confirmedClientReadingIds: string[]; rejectedClientReadingIds?: string[] }> {
    if (!this.connected) {
      throw new Error('Socket not connected during bulk sync');
    }
    this.bulkSyncsEmitted.push(readings.map(r => ({ ...r })));

    if (this.ackHandlerOverride) {
      return this.ackHandlerOverride(readings);
    }

    // Default mock behavior: confirm all readings sent in the batch
    return {
      confirmedClientReadingIds: readings.map(r => r.client_reading_id),
    };
  }

  onConnect(listener: () => void): () => void {
    this.connectListeners.add(listener);
    return () => this.connectListeners.delete(listener);
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  emitEvent(_event: string, _payload?: Record<string, unknown>): void {
    if (!this.connected) throw new Error('Socket not connected');
  }

  emitWithAck(_event: string, _callback: (response: any) => void): void {
    if (!this.connected) throw new Error('Socket not connected');
  }

  onEvent(_event: string, _listener: (payload: any) => void): () => void {
    return () => undefined;
  }

  /**
   * Helper method for testing socket disconnect event
   */
  triggerDisconnect(): void {
    this.disconnect();
  }

  /**
   * Helper method for testing socket reconnect event
   */
  triggerConnect(): void {
    this.connected = true;
    for (const l of this.connectListeners) l();
  }
}

/**
 * Production Socket.IO Client Adapter.
 * Authenticates via `auth: { token }` at connection time.
 */
export class SocketClient implements ISocketClient {
  private socket: any = null;
  private connected = false;
  private connectListeners: Set<() => void> = new Set();
  private disconnectListeners: Set<() => void> = new Set();
  private appState = 'unknown';

  // TEMP PORTAL DIAGNOSTIC: supplied by App.tsx; no user or location data.
  setAppState(state: string): void { this.appState = state; }
  private disconnectCategory(reason?: string): string {
    return ['transport close', 'ping timeout', 'server disconnect', 'client disconnect', 'transport error'].includes(reason || '') ? reason! : 'other';
  }
  private connectErrorCategory(error: any): string {
    const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
    if (message.includes('timeout')) return 'timeout';
    if (message.includes('websocket')) return 'websocket_error';
    if (message.includes('poll')) return 'polling_error';
    return 'other';
  }

  async connect(socketUrl: string, token: string): Promise<void> {
    if (this.socket && this.connected) {
      return;
    }

    if (this.socket && !this.connected) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    let io: any;
    try {
      io = require('socket.io-client').io || require('socket.io-client');
    } catch {
      console.warn('socket.io-client module missing. Real WebSocket connection disabled.');
      return;
    }

    this.socket = io(socketUrl, {
      auth: { token },
      transports: ['polling', 'websocket'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 15,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 20000,
    });

    console.log('[TEMP SOCKET DIAG] initialized');

    this.socket.on('connect', () => {
      this.connected = true;
      const transport = this.socket?.io?.engine?.transport?.name || 'unknown';
      console.log(`[TEMP SOCKET DIAG] connected transport=${transport} app_state=${this.appState}`);
      for (const listener of this.connectListeners) listener();
    });

    this.socket.on('disconnect', (reason?: string) => {
      this.connected = false;
      console.log(`[TEMP SOCKET DIAG] disconnected reason=${this.disconnectCategory(reason)} app_state=${this.appState}`);
      for (const listener of this.disconnectListeners) listener();
    });

    this.socket.on('connect_error', (error: any) => {
      const transport = this.socket?.io?.engine?.transport?.name || 'unknown';
      console.log(`[TEMP SOCKET DIAG] connect_error category=${this.connectErrorCategory(error)} transport=${transport} app_state=${this.appState}`);
    });

    this.socket.io.on('reconnect_attempt', (attempt: number) => {
      console.log(`[TEMP SOCKET DIAG] reconnect_attempt attempt=${attempt} app_state=${this.appState}`);
    });

    this.socket.io.on('reconnect', (attempt: number) => {
      const transport = this.socket?.io?.engine?.transport?.name || 'unknown';
      console.log(`[TEMP SOCKET DIAG] reconnect_success attempt=${attempt} transport=${transport} app_state=${this.appState}`);
    });

    this.socket.io.on('reconnect_error', () => {
      console.log(`[TEMP SOCKET DIAG] reconnect_error app_state=${this.appState}`);
    });

    this.socket.io.on('reconnect_failed', () => {
      console.log(`[TEMP SOCKET DIAG] reconnect_failed app_state=${this.appState}`);
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async joinSession(groupCode: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.connected) {
        return reject(new Error('Socket is not connected'));
      }

      const timeout = setTimeout(() => {
        reject(new Error('Session join timed out'));
      }, 10000);

      this.socket.emit('session:join', { group_code: groupCode }, (response: any) => {
        clearTimeout(timeout);
        if (response?.error) {
          reject(new Error(response.error));
        } else {
          resolve();
        }
      });
    });
  }

  emitLocationUpdate(payload: Omit<TelemetryReading, 'client_reading_id' | 'synced'> & { client_reading_id?: string }, ack?: (response: { accepted: boolean; sampleId?: string; permanent?: boolean }) => void): void {
    if (this.socket && this.connected) {
      console.log('[SOCKET TELEMETRY EMIT]');
      this.socket.emit('location:update', payload, ack);
    } else {
      console.log(`[LIVE LOCATION TRACE] [TRACE 4-BLOCKED] SocketClient cannot emit | socket=${!!this.socket} connected=${this.connected}`);
    }
  }

  async emitBulkSync(readings: TelemetryReading[]): Promise<{ confirmedClientReadingIds: string[]; rejectedClientReadingIds?: string[] }> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.connected) {
        return reject(new Error('Socket is not connected'));
      }

      const payload = {
        groupCode: readings[0]?.groupCode,
        readings: readings.map(r => ({
          client_reading_id: r.client_reading_id,
          timestamp: r.timestamp,
          latitude: r.latitude,
          longitude: r.longitude,
          accuracy: r.accuracy,
          speed: r.speed,
        })),
      };

      // Set timeout for acknowledgment
      const timeout = setTimeout(() => {
        reject(new Error('telemetry:bulkSync acknowledgment timed out'));
      }, 10000);

      // Emit with Socket.io acknowledgment callback
      this.socket.emit('telemetry:bulkSync', payload, (ackResponse: { confirmedClientReadingIds: string[]; rejectedClientReadingIds?: string[] }) => {
        clearTimeout(timeout);
        if (ackResponse && Array.isArray(ackResponse.confirmedClientReadingIds)) {
          resolve(ackResponse);
        } else {
          reject(new Error('Invalid bulkSync acknowledgment response shape'));
        }
      });
    });
  }

  onConnect(listener: () => void): () => void {
    this.connectListeners.add(listener);
    return () => this.connectListeners.delete(listener);
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  emitEvent(event: string, payload?: Record<string, unknown>): void {
    if (!this.socket || !this.connected) throw new Error('Socket is not connected');
    this.socket.emit(event, payload);
  }

  emitWithAck(event: string, callback: (response: any) => void): void {
    if (!this.socket || !this.connected) throw new Error('Socket is not connected');
    this.socket.emit(event, callback);
  }

  emitEventWithAck(event: string, payload: Record<string, unknown>, callback: (response: any) => void): void {
    if (!this.socket || !this.connected) throw new Error('Socket is not connected');
    this.socket.emit(event, payload, callback);
  }

  onEvent(event: string, listener: (payload: any) => void): () => void {
    // Capture the instance which received the listener.  Referring to
    // `this.socket` from the cleanup can remove a listener from a newer
    // connection after a reconnect/replacement, while leaking it on the old
    // connection.
    const socket = this.socket;
    if (!socket) return () => undefined;
    socket.on(event, listener);
    return () => socket.off(event, listener);
  }
}
