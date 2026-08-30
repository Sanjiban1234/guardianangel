import { Namespace, Server, Socket } from 'socket.io';
import { GuardianPortalShareService } from '../services/GuardianPortalShareService';

export interface PortalBroadcaster {
  location(shareIds: string[], payload: { latitude: number; longitude: number; lastUpdatedAt: number; }): void;
  presence(shareIds: string[], payload: { lastUpdatedAt: number; connectionState: 'DISCONNECTED'; freshness: 'STALE'; }): void;
  separation(shareIds: string[], state: 'separated' | 'reunited', timestamp: number): void;
  sos(shareIds: string[], payload: { timestamp: number; latitude: number; longitude: number; }): void;
  rideEnded(shareIds: string[], endedAt: number): void;
  revoked(shareIds: string[]): void;
}

export class GuardianPortalSocketController implements PortalBroadcaster {
  private namespace!: Namespace;
  constructor(private readonly shares: GuardianPortalShareService) {}
  register(io: Server): void {
    this.namespace = io.of('/guardian-portal');
    this.namespace.use(async (socket, next) => {
      const credential = socket.handshake.auth?.credential;
      if (typeof credential !== 'string') return next(new Error('Observer authorization required'));
      try { socket.data.portal = await this.shares.validateObserverCredential(credential); next(); }
      catch { next(new Error('Observer authorization rejected')); }
    });
    this.namespace.on('connection', (socket: Socket) => {
      const shareId = socket.data.portal?.shareId;
      if (!shareId) { socket.disconnect(true); return; }
      socket.join(this.room(shareId));
      const expiryMs = Math.max(0, ((socket.data.portal?.exp || 0) * 1000) - Date.now());
      const expiryTimer = setTimeout(() => socket.disconnect(true), expiryMs);
      socket.on('disconnect', () => clearTimeout(expiryTimer));
      socket.onAny((_event, ..._args) => { socket.disconnect(true); });
    });
  }
  private room(shareId: string): string { return `guardian-portal:${shareId}`; }
  private emit(shareIds: string[], event: string, payload: unknown): void { for (const id of shareIds) this.namespace.to(this.room(id)).emit(event, payload); }
  location(shareIds: string[], payload: { latitude: number; longitude: number; lastUpdatedAt: number; }): void { this.emit(shareIds, 'portal:location', payload); }
  presence(shareIds: string[], payload: { lastUpdatedAt: number; connectionState: 'DISCONNECTED'; freshness: 'STALE'; }): void { this.emit(shareIds, 'portal:presence', payload); }
  separation(shareIds: string[], state: 'separated' | 'reunited', timestamp: number): void { this.emit(shareIds, state === 'separated' ? 'portal:separated' : 'portal:reunited', { timestamp }); }
  sos(shareIds: string[], payload: { timestamp: number; latitude: number; longitude: number; }): void { this.emit(shareIds, 'portal:sos', payload); }
  rideEnded(shareIds: string[], endedAt: number): void { this.emit(shareIds, 'portal:rideEnded', { endedAt }); this.disconnect(shareIds); }
  revoked(shareIds: string[]): void { this.emit(shareIds, 'portal:revoked', {}); this.disconnect(shareIds); }
  private disconnect(shareIds: string[]): void { for (const id of shareIds) this.namespace.in(this.room(id)).disconnectSockets(true); }
}
