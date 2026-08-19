import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';

// ─── DB Layer ──────────────────────────────────────────────────────────────
import { initDb, pool } from './db';
import { QueryRunner } from './db/QueryRunner';

// ─── Services ─────────────────────────────────────────────────────────────
import { UserService } from './services/UserService';
import { RoomService } from './services/RoomService';
import { TelemetryService } from './services/TelemetryService';
import { EmergencyAlertService } from './services/EmergencyAlertService';
import { PresenceService } from './services/PresenceService';
import { WeatherService } from './services/WeatherService';
import { GroupCoherenceService } from './services/GroupCoherenceService';
import { FcmPushService } from './services/FcmPushService';
import { VehicleBreakdownService } from './services/VehicleBreakdownService';
import { MedicalInfoService } from './services/MedicalInfoService';
import { RefillNotificationService } from './services/RefillNotificationService';
import { PostgisTelemetryRepository } from './repositories/PostgisTelemetryRepository';
import { CrashCandidateRepository } from './repositories/CrashCandidateRepository';

// ─── Routes ───────────────────────────────────────────────────────────────
import { createAuthRouter } from './routes/AuthRouter';
import { createRoomRouter } from './routes/RoomRouter';
import { createGeofenceRouter } from './routes/GeofenceRouter';
import { createWeatherRouter } from './routes/WeatherRouter';
import { createSafetyRouter } from './routes/SafetyRouter';
import { DeviceRouter } from './routes/DeviceRouter';
import { MedicalInfoRouter } from './routes/MedicalInfoRouter';

// ─── Socket Controller ────────────────────────────────────────────────────
import { RideSocketController } from './sockets/RideSocketController';

// ─── Config ───────────────────────────────────────────────────────────────
import { ALLOWED_ORIGINS, MAX_BODY_SIZE, PORT } from './config';

// ─── Compose the dependency graph ─────────────────────────────────────────
const queryRunner = new QueryRunner();

const userService        = new UserService(queryRunner);
const roomService        = new RoomService(queryRunner);
const telemetryService   = new TelemetryService(queryRunner);
const alertService       = new EmergencyAlertService(queryRunner);
const presenceService    = new PresenceService(queryRunner);
const weatherService     = new WeatherService(queryRunner);
const coherenceService   = new GroupCoherenceService(presenceService);
const fcmPushService     = new FcmPushService(queryRunner);
const breakdownService   = new VehicleBreakdownService(queryRunner, fcmPushService);
const medicalService     = new MedicalInfoService(queryRunner);
const refillService      = new RefillNotificationService(queryRunner, fcmPushService);
const telemetryRepo      = new PostgisTelemetryRepository(pool);
const crashRepo          = new CrashCandidateRepository(queryRunner);

const deviceRouter       = new DeviceRouter(fcmPushService);
const medicalRouter      = new MedicalInfoRouter(medicalService);

const socketController = new RideSocketController(
  roomService,
  telemetryService,
  alertService,
  presenceService,
  crashRepo,
  coherenceService,
  breakdownService,
  medicalService,
  refillService
);

// ─── Express + Socket.io setup ─────────────────────────────────────────────

const app    = express();
const server = createServer(app);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST'],
  },
});

app.use(express.json({ limit: MAX_BODY_SIZE }));

// Mount REST routes
app.use('/api/auth', createAuthRouter(userService));
app.use('/api',      createRoomRouter(roomService, telemetryRepo));
app.use('/api',      createGeofenceRouter(queryRunner));
app.use('/api',      createSafetyRouter(queryRunner));
app.use('/api',      createWeatherRouter(roomService, weatherService));
app.use('/api',      deviceRouter.router);
app.use('/api',      medicalRouter.router);

// Register WebSocket controller
socketController.register(io);

// ─── Graceful Shutdown ────────────────────────────────────────────────────

let isShuttingDown = false;

const gracefulShutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`Received ${signal}. Starting graceful shutdown...`);

  const forceExitTimeout = setTimeout(() => {
    console.error('Graceful shutdown timed out after 30s. Forcing exit.');
    process.exit(1);
  }, 30000);

  try {
    io.close(() => {
      console.log('Socket.IO connections closed.');
    });

    server.close(async () => {
      console.log('HTTP server closed.');
      try {
        await pool.end();
        console.log('Database pool drained.');
      } catch (dbErr) {
        console.error('Error closing database pool:', dbErr);
      }
      clearTimeout(forceExitTimeout);
      process.exit(0);
    });
  } catch (err) {
    console.error('Error during graceful shutdown:', err);
    clearTimeout(forceExitTimeout);
    process.exit(1);
  }
};

if (process.env.NODE_ENV !== 'test') {
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

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
