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
import { RefillNotificationService } from '../services/RefillNotificationService';

export class RideSocketController {
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

      console.log(`[SOCKET BACKEND] CONNECTED userId=${userId} name=${name} socketId=${socket.id} transport=${transport}`);

      const roomState: RoomState = { currentGroupCode: null };

      new SessionHandler(io, socket, roomState, this.roomService).register();
      new RideStartHandler(io, socket, roomState, this.roomService).register();
      new LocationHandler(socket, roomState, this.telemetryService, this.coherenceService).register();
      new BulkSyncHandler(socket, roomState, this.telemetryService).register();
      new CrashHandler(io, socket, roomState, this.alertService, this.crashRepo, this.medicalService).register();
      new DisconnectHandler(socket, roomState, this.presenceService).register();
      if (this.breakdownService) {
        new VehicleBreakdownHandler(io, socket, roomState, this.breakdownService, this.medicalService).register();
      }
      if (this.refillService) new RefillNotificationHandler(io, socket, this.refillService).register();

      socket.conn.on('upgrade', (transport: any) => {
        console.log(`[SOCKET BACKEND] TRANSPORT_UPGRADE socketId=${socket.id} from=polling to=${transport.name}`);
      });
    });
  }
}


