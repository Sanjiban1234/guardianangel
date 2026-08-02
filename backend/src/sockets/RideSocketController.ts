import { Server } from 'socket.io';
import { AuthMiddleware, AuthenticatedSocket } from '../middleware/AuthMiddleware';
import { RoomService } from '../services/RoomService';
import { TelemetryService } from '../services/TelemetryService';
import { EmergencyAlertService } from '../services/EmergencyAlertService';
import { PresenceService } from '../services/PresenceService';
import { CrashCandidateRepository } from '../repositories/CrashCandidateRepository';
import { SessionHandler, RoomState } from '../handlers/SessionHandler';
import { LocationHandler } from '../handlers/LocationHandler';
import { BulkSyncHandler } from '../handlers/BulkSyncHandler';
import { CrashHandler } from '../handlers/CrashHandler';
import { DisconnectHandler } from '../handlers/DisconnectHandler';

export class RideSocketController {
  constructor(
    private readonly roomService: RoomService,
    private readonly telemetryService: TelemetryService,
    private readonly alertService: EmergencyAlertService,
    private readonly presenceService: PresenceService,
    private readonly crashRepo: CrashCandidateRepository
  ) {}

  register(io: Server): void {
    io.use(AuthMiddleware.authenticateSocket);

    io.on('connection', (socket: AuthenticatedSocket) => {
      const userId = socket.user?.id;
      const name = socket.user?.name;

      if (!userId || !name) {
        console.error('RideSocketController: socket connected without user details — disconnecting');
        socket.disconnect(true);
        return;
      }

      console.log(`RideSocketController: ${name} (${userId}) connected`);

      const roomState: RoomState = { currentGroupCode: null };

      new SessionHandler(io, socket, roomState, this.roomService).register();
      new LocationHandler(socket, roomState, this.telemetryService).register();
      new BulkSyncHandler(socket, roomState, this.telemetryService).register();
      new CrashHandler(io, socket, roomState, this.alertService, this.crashRepo).register();
      new DisconnectHandler(socket, roomState, this.presenceService).register();
    });
  }
}
