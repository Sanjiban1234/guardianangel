import { TelemetryModule } from '../src/telemetry/TelemetryModule';
import { InMemoryTelemetryDatabase } from '../src/telemetry/database/TelemetryDatabase';
import { ForegroundGeolocationProvider, MockLocationProvider } from '../src/telemetry/location/LocationProvider';
import { emitLatestLocationAfterJoin, getCurrentPositionAfterJoin } from '../src/telemetry/location/postJoinLocation';
import { SocketClient } from '../src/telemetry/socket/SocketClient';
import fs from 'fs';
import path from 'path';

const sensitiveValues = [
  'access-token-SENTINEL', '27.717200', '85.324000', 'ROOM-SENTINEL',
  'socket-id-SENTINEL', 'password-SENTINEL', 'medical-notes-SENTINEL', 'emergency-contact-SENTINEL',
];

function expectNoSensitiveConsoleOutput(spies: jest.SpyInstance[]) {
  const output = spies.flatMap(spy => spy.mock.calls).flat().map(value => String(value)).join(' ');
  for (const sensitiveValue of sensitiveValues) expect(output).not.toContain(sensitiveValue);
}

describe('sensitive runtime logging', () => {
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    error = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it('does not log auth, room, or exact location values while processing telemetry and post-join updates', async () => {
    const locationProvider = new MockLocationProvider();
    const socketClient = {
      isConnected: () => true,
      emitLocationUpdate: jest.fn(),
    };
    const telemetry = new TelemetryModule({
      db: new InMemoryTelemetryDatabase(), locationProvider, socketClient: socketClient as any,
      connectivityManager: { getStatus: () => 'offline', onStatusChange: () => () => {}, start: () => {}, stop: () => {}, checkReachability: async () => false },
    });

    await telemetry.start({
      socketUrl: 'https://example.test', authToken: sensitiveValues[0], groupCode: sensitiveValues[3],
      healthEndpointUrl: 'https://example.test/health',
    });
    locationProvider.emitLocation({ timestamp: 1, latitude: 27.7172, longitude: 85.324, accuracy: 3, speed: 0 });
    emitLatestLocationAfterJoin(socketClient, sensitiveValues[3], {
      timestamp: 2, latitude: 27.7172, longitude: 85.324, accuracy: 3, speed: 0,
    });
    await telemetry.stop();

    expectNoSensitiveConsoleOutput([log, warn, error]);
  });

  it('does not include sensitive native/socket error details in failure logs', async () => {
    const sensitiveError = new Error(sensitiveValues.join(' '));
    const provider = new ForegroundGeolocationProvider({
      setRNConfiguration: jest.fn(), getCurrentPosition: jest.fn(), watchPosition: jest.fn(), clearWatch: jest.fn(),
    } as any, async () => { throw sensitiveError; });
    await provider.start(jest.fn());

    await expect(getCurrentPositionAfterJoin({
      getCurrentPosition: (_success, failure) => failure(sensitiveError),
    })).rejects.toThrow(sensitiveError);

    const handlers: Record<string, (error: Error) => void> = {};
    jest.doMock('socket.io-client', () => ({
      io: () => ({
        on: (event: string, callback: (error: Error) => void) => { handlers[event] = callback; },
        off: jest.fn(), disconnect: jest.fn(), removeAllListeners: jest.fn(),
        io: { on: (event: string, callback: (error: Error) => void) => { handlers[event] = callback; }, engine: { transport: { name: 'websocket' } } },
      }),
    }));
    // SocketClient resolves the module at connect time, so the mock above feeds its error listeners.
    const socket = new SocketClient();
    await socket.connect('https://example.test', sensitiveValues[0]);
    handlers.connect_error(sensitiveError);
    handlers.reconnect_error(sensitiveError);

    expectNoSensitiveConsoleOutput([log, warn, error]);
  });

  it.each([
    'App.tsx',
    'src/telemetry/TelemetryModule.ts',
    'src/telemetry/location/postJoinLocation.ts',
    'src/ui/MapScreen.tsx',
    'src/ui/LoginScreen.tsx',
    'src/permissions/PermissionGate.tsx',
  ])('%s does not pass sensitive runtime values to console methods', (relativePath) => {
    const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
    expect(source).not.toMatch(/console\.(?:log|warn|error|info)\([^\n]*(?:authToken|activeRoom|roomCode|groupCode|riderName|latitude|longitude|socketId|\berror\b|\berr\b)/);
  });
});
