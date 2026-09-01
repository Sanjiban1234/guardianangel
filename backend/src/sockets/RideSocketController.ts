import { Server } from 'socket.io';
import { AuthMiddleware, AuthenticatedSocket } from '../middleware/AuthMiddleware';
import { RoomService } from '../services/RoomService';
import { TelemetryService } from '../services/TelemetryService';
import { EmergencyAlertService } from '../services/EmergencyAlertService';
import { PresenceService } from '../services/PresenceService';
import { GroupCoherenceService } from '../services/GroupCoherenceService';
import { VehicleBreakdownService } from '../services/VehicleBreakdownService';
import { MedicalInfoService } from '../services/MedicalInfoService';
import { CrashCandidateRepository } from '../repositories/CrashCandidateRepository';
import { SessionHandler, RoomState } from '../handlers/SessionHandler';
import { LocationHandler } from '../handlers/LocationHandler';
import { BulkSyncHandler } from '../handlers/BulkSyncHandler';
import { CrashHandler } from '../handlers/CrashHandler';
import { DisconnectHandler } from '../handlers/DisconnectHandler';
import { VehicleBreakdownHandler } from '../handlers/VehicleBreakdownHandler';
import { RefillNotificationHandler } from '../handlers/RefillNotificationHandler';
import { RideStartHandler } from '../handlers/RideStartHandler';
import { RideEndHandler } from '../handlers/RideEndHandler';
import { RefillNotificationService } from '../services/RefillNotificationService';
import { EmergencyDisclosureAuditService } from '../services/EmergencyDisclosureAuditService';
import { logger } from '../utils/logger';

export class RideSocketController {
  private readonly socketsByUser = new Map<string, number>();
  constructor(
    private readonly roomService: RoomService,
    private readonly telemetryService: TelemetryService,
    private readonly alertService: EmergencyAlertService,
    private readonly presenceService: PresenceService,
    private readonly crashRepo: CrashCandidateRepository,
    private readonly coherenceService?: GroupCoherenceService,
    private readonly breakdownService?: VehicleBreakdownService,
    private readonly medicalService?: MedicalInfoService,
    private readonly refillService?: RefillNotificationService
    , private readonly disclosureAudit?: EmergencyDisclosureAuditService
  ) {}

  register(io: Server): void {
    io.use(AuthMiddleware.authenticateSocket);

    io.on('connection', (socket: AuthenticatedSocket) => {
      const userId = socket.user?.id;
      const name = socket.user?.name;
      const transport = socket.conn.transport.name;

      if (!userId || !name) {
        console.error('RideSocketController: socket connected without user details — disconnecting');
        socket.disconnect(true);
        return;
      }

      const count = this.socketsByUser.get(userId) || 0;
      if (count >= 3) {
        socket.emit('error', { message: 'Too many active connections for this account' });
        socket.disconnect(true);
        return;
      }
      this.socketsByUser.set(userId, count + 1);
      // A socket is assigned only to the room derived from its verified JWT.
      // Clients never send a user id to select this room.
      socket.join(`user:${userId}`);

      // Boundary limiter: normal GPS cadence is ~5 seconds. A short burst is
      // tolerated; sustained floods are dropped before handlers reach storage.
      const events = new Map<string, number[]>();
      socket.use(([event], next) => {
        const limits: Record<string, [number, number]> = {
          'location:update': [20, 60_000], 'telemetry:bulkSync': [6, 60_000],
          'crash:candidate': [3, 60_000], 'crash:countdownExpired': [3, 60_000],
          'session:join': [10, 60_000], 'refill:requested': [3, 60_000],
        };
        const limit = limits[event];
        if (!limit) return next();
        const now = Date.now();
        const recent = (events.get(event) || []).filter((ts) => now - ts < limit[1]);
        if (recent.length >= limit[0]) return next(new Error('RATE_LIMITED'));
        recent.push(now); events.set(event, recent); next();
      });

      logger.info('socket connected');

      const roomState: RoomState = { currentGroupCode: null };

      new SessionHandler(io, socket, roomState, this.roomService, this.presenceService).register();
      new RideStartHandler(io, socket, roomState, this.roomService).register();
      new RideEndHandler(io, socket, roomState, this.roomService).register();
      new LocationHandler(socket, roomState, this.telemetryService, this.coherenceService).register();
      new BulkSyncHandler(socket, roomState, this.telemetryService).register();
      new CrashHandler(io, socket, roomState, this.alertService, this.crashRepo, this.medicalService, this.presenceService, this.disclosureAudit).register();
      new DisconnectHandler(socket, roomState, this.presenceService).register();
      if (this.breakdownService) {
        new VehicleBreakdownHandler(io, socket, roomState, this.breakdownService, this.medicalService, this.presenceService).register();
      }
      if (this.refillService) new RefillNotificationHandler(io, socket, this.refillService).register();

      socket.conn.on('upgrade', (transport: any) => {
        logger.info('socket transport upgraded');
      });
      socket.on('disconnect', () => {
        const current = this.socketsByUser.get(userId) || 1;
        if (current <= 1) this.socketsByUser.delete(userId);
        else this.socketsByUser.set(userId, current - 1);
      });
    });
  }
}


