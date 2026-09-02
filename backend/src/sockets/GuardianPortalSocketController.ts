import { Namespace, Server, Socket } from 'socket.io';
import crypto from 'crypto';
import { GuardianPortalShareService } from '../services/GuardianPortalShareService';
import { logger } from '../utils/logger';

export interface PortalBroadcaster {
  location(shareIds: string[], payload: { latitude: number; longitude: number; lastUpdatedAt: number; }): void;
  presence(shareIds: string[], payload: { updatedAt: number; connectionState: 'CONNECTED' | 'DISCONNECTED'; }): void;
  separation(shareIds: string[], state: 'separated' | 'reunited', timestamp: number): void;
  sos(shareIds: string[], payload: { timestamp: number; latitude: number; longitude: number; }): void;
  rideEnded(shareIds: string[], endedAt: number): void;
  revoked(shareIds: string[]): void;
}

export class GuardianPortalSocketController implements PortalBroadcaster {
  private namespace!: Namespace;
  private readonly locationEmissionCounts = new Map<string, number>();
  constructor(private readonly shares: GuardianPortalShareService) {}
  register(io: Server): void {
    this.namespace = io.of('/guardian-portal');
    this.namespace.use(async (socket, next) => {
      logger.info('temporary portal socket attempt', { originCategory: this.originCategory(socket.handshake.headers.origin) });
      const credential = socket.handshake.auth?.credential;
      if (typeof credential !== 'string') {
        logger.warn('temporary portal observer rejected', { category: 'missing_credential' });
        return next(new Error('Observer authorization required'));
      }
      try {
        socket.data.portal = await this.shares.validateObserverCredential(credential);
        logger.info('temporary portal observer authenticated', { shareFingerprint: this.fingerprint(socket.data.portal.shareId) });
        next();
      } catch (error) {
        logger.warn('temporary portal observer rejected', { category: this.observerFailureCategory(error) });
        next(new Error('Observer authorization rejected'));
      }
    });
    this.namespace.on('connection', (socket: Socket) => {
      const shareId = socket.data.portal?.shareId;
      if (!shareId) { socket.disconnect(true); return; }
      socket.join(this.room(shareId));
      logger.info('temporary portal observer joined share room', { shareFingerprint: this.fingerprint(shareId), observerSockets: this.roomSize(shareId) });
      const expiryMs = Math.max(0, ((socket.data.portal?.exp || 0) * 1000) - Date.now());
      const expiryTimer = setTimeout(() => socket.disconnect(true), expiryMs);
      socket.on('disconnect', () => clearTimeout(expiryTimer));
      socket.onAny((_event, ..._args) => { socket.disconnect(true); });
    });
  }
  private room(shareId: string): string { return `guardian-portal:${shareId}`; }
  private fingerprint(value: string): string { return crypto.createHash('sha256').update(value).digest('hex').slice(0, 10); }
  private roomSize(shareId: string): number { return this.namespace.adapter.rooms.get(this.room(shareId))?.size || 0; }
  private originCategory(origin: unknown): string {
    if (typeof origin !== 'string') return 'missing';
    if (origin === 'https://guardian-angel-portal.vercel.app') return 'production_alias';
    return /^https:\/\/guardian-angel-portal-[a-z0-9-]+\.vercel\.app$/.test(origin) ? 'portal_deployment' : 'other';
  }
  private observerFailureCategory(error: unknown): string {
    const value = error as { name?: unknown; code?: unknown };
    if (value?.name === 'TokenExpiredError') return 'expired_credential';
    return value?.code === 'UNAVAILABLE' ? 'inactive_or_revoked_share' : 'invalid_credential';
  }
  private emit(shareIds: string[], event: string, payload: unknown): void { for (const id of shareIds) this.namespace.to(this.room(id)).emit(event, payload); }
  location(shareIds: string[], payload: { latitude: number; longitude: number; lastUpdatedAt: number; }): void {
    this.emit(shareIds, 'portal:location', payload);
    for (const shareId of shareIds) {
      const count = (this.locationEmissionCounts.get(shareId) || 0) + 1;
      this.locationEmissionCounts.set(shareId, count);
      if (count === 1 || count % 12 === 0) logger.info('temporary portal location emitted', { shareFingerprint: this.fingerprint(shareId), emissionCount: count, observerSockets: this.roomSize(shareId) });
    }
  }
  presence(shareIds: string[], payload: { updatedAt: number; connectionState: 'CONNECTED' | 'DISCONNECTED'; }): void { this.emit(shareIds, 'portal:presence', payload); }
  separation(shareIds: string[], state: 'separated' | 'reunited', timestamp: number): void { this.emit(shareIds, state === 'separated' ? 'portal:separated' : 'portal:reunited', { timestamp }); }
  sos(shareIds: string[], payload: { timestamp: number; latitude: number; longitude: number; }): void { this.emit(shareIds, 'portal:sos', payload); }
  rideEnded(shareIds: string[], endedAt: number): void { this.emit(shareIds, 'portal:rideEnded', { endedAt }); this.disconnect(shareIds); }
  revoked(shareIds: string[]): void { this.emit(shareIds, 'portal:revoked', {}); this.disconnect(shareIds); }
  private disconnect(shareIds: string[]): void { for (const id of shareIds) this.namespace.in(this.room(id)).disconnectSockets(true); }
}
