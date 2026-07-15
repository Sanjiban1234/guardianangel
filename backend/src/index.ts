import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

// ─── DB Layer ──────────────────────────────────────────────────────────────
import { initDb } from './db';
import { QueryRunner } from './db/QueryRunner';

// ─── Services ─────────────────────────────────────────────────────────────
import { UserService } from './services/UserService';
import { RoomService } from './services/RoomService';
import { TelemetryService } from './services/TelemetryService';
import { EmergencyAlertService } from './services/EmergencyAlertService';
import { PresenceService } from './services/PresenceService';

// ─── Routes ───────────────────────────────────────────────────────────────
import { createAuthRouter } from './routes/AuthRouter';
import { createRoomRouter } from './routes/RoomRouter';

// ─── Socket Controller ────────────────────────────────────────────────────
import { RideSocketController } from './sockets/RideSocketController';

// ─── Config ───────────────────────────────────────────────────────────────
import { ALLOWED_ORIGINS, MAX_BODY_SIZE, PORT } from './config';

// ─── Compose the dependency graph ─────────────────────────────────────────
// QueryRunner defaults to db.query — same function intercepted by jest.mock

const queryRunner = new QueryRunner();

const userService      = new UserService(queryRunner);
const roomService      = new RoomService(queryRunner);
const telemetryService = new TelemetryService(queryRunner);
const alertService     = new EmergencyAlertService(queryRunner);
const presenceService  = new PresenceService(queryRunner);

const socketController = new RideSocketController(
  roomService,
  telemetryService,
  alertService,
  presenceService
);

// ─── Express + Socket.io setup ─────────────────────────────────────────────

const app    = express();
const server = createServer(app);
const io     = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
  },
});

app.use(express.json({ limit: MAX_BODY_SIZE }));

// Mount REST routes
app.use('/api/auth', createAuthRouter(userService));
app.use('/api',      createRoomRouter(roomService));

// Register WebSocket controller
socketController.register(io);

// ─── Startup ───────────────────────────────────────────────────────────────

const startServer = async () => {
  try {
    await initDb();

    if (process.env.NODE_ENV !== 'test') {
      server.listen(PORT, () => {
        console.log(
          `Guardian Angel Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`
        );
      });
    }
  } catch (error) {
    console.error('Failed to initialize server/database:', error);
    process.exit(1);
  }
};

startServer();

export { app, server, io };
