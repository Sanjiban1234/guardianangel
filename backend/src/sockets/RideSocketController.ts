import { Server } from 'socket.io';
import { AuthMiddleware, AuthenticatedSocket } from '../middleware/AuthMiddleware';
import { RoomService } from '../services/RoomService';
import { TelemetryService } from '../services/TelemetryService';
import { EmergencyAlertService } from '../services/EmergencyAlertService';
import { PresenceService } from '../services/PresenceService';
import { SessionHandler, RoomState } from '../handlers/SessionHandler';
import { LocationHandler } from '../handlers/LocationHandler';
import { BulkSyncHandler } from '../handlers/BulkSyncHandler';
import { CrashHandler } from '../handlers/CrashHandler';
import { DisconnectHandler } from '../handlers/DisconnectHandler';

/**
 * RideSocketController — orchestrates all socket handler classes.
 *
 * Each incoming WebSocket connection gets its own set of handler instances
 * sharing a single RoomState reference. This guarantees:
 *  - No shared mutable state between connections
 *  - Handler failures are isolated per-connection
 *  - Adding/removing a handler requires a one-line change here only
 */
export class RideSocketController {
  constructor(
    private readonly roomService: RoomService,
    private readonly telemetryService: TelemetryService,
    private readonly alertService: EmergencyAlertService,
    private readonly presenceService: PresenceService
  ) {}

  /** Attach the controller to a Socket.io Server instance */
  register(io: Server): void {
    // JWT handshake validation
    io.use(AuthMiddleware.authenticateSocket);

    io.on('connection', (socket: AuthenticatedSocket) => {
      const userId = socket.user?.id;
      const username = socket.user?.username;

      if (!userId || !username) {
        console.error('RideSocketController: socket connected without user details — disconnecting');
        socket.disconnect(true);
        return;
      }

      console.log(`RideSocketController: ${username} (${userId}) connected`);

      // Shared mutable room state for this connection
      const roomState: RoomState = { currentRoomId: null };

      // Instantiate and register all handlers for this connection
      new SessionHandler(io, socket, roomState, this.roomService).register();
      new LocationHandler(socket, roomState, this.telemetryService).register();
      new BulkSyncHandler(socket, roomState, this.telemetryService).register();
      new CrashHandler(io, socket, roomState, this.alertService).register();
      new DisconnectHandler(socket, roomState, this.presenceService).register();
    });
  }
}
