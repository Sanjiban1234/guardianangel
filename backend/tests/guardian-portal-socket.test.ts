import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as connect, Socket } from 'socket.io-client';
import { LocationHandler } from '../src/handlers/LocationHandler';
import { GuardianPortalSocketController } from '../src/sockets/GuardianPortalSocketController';

describe('Guardian Portal socket delivery', () => {
  let httpServer: ReturnType<typeof createServer>;
  let io: Server;
  let client: Socket;

  afterEach(async () => {
    client?.close();
    await new Promise<void>((resolve) => io?.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
  });

  it('authenticates an observer and delivers rider location:update telemetry to its share room', async () => {
    httpServer = createServer();
    io = new Server(httpServer);
    const shares = {
      validateObserverCredential: jest.fn().mockResolvedValue({ shareId: 'share-1', exp: Math.floor(Date.now() / 1000) + 60 }),
      activeSharesForRoom: jest.fn().mockResolvedValue([{ id: 'share-1', owner_user_id: 'rider-1' }]),
    };
    const portal = new GuardianPortalSocketController(shares as any);
    portal.register(io);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const address = httpServer.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    client = connect(`http://127.0.0.1:${port}/guardian-portal`, { auth: { credential: 'observer-credential' }, transports: ['websocket'] });
    await new Promise<void>((resolve, reject) => { client.once('connect', resolve); client.once('connect_error', reject); });
    const received = new Promise<{ latitude: number; longitude: number; lastUpdatedAt: number }>((resolve) => client.once('portal:location', resolve));
    const handlers = new Map<string, Function>();
    const riderSocket = {
      id: 'rider-socket', user: { id: 'rider-1', name: 'Rider' },
      on: jest.fn((event, handler) => handlers.set(event, handler)), emit: jest.fn(),
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    };
    const telemetry = { saveTelemetry: jest.fn().mockResolvedValue({ accepted: true, live: true }) };
    new LocationHandler(riderSocket as any, { currentGroupCode: 'GROUP1' }, telemetry as any, undefined, shares as any, portal).register();
    await handlers.get('location:update')!({ timestamp: Date.now(), latitude: 27.7, longitude: 85.3, accuracy: 5, speed: 12 });
    const payload = await received;
    expect(payload).toMatchObject({ latitude: 27.7, longitude: 85.3 });
    expect(typeof payload.lastUpdatedAt).toBe('number');
    expect(shares.validateObserverCredential).toHaveBeenCalledWith('observer-credential');
    expect(telemetry.saveTelemetry).toHaveBeenCalled();
    expect(shares.activeSharesForRoom).toHaveBeenCalledWith('GROUP1');
  });
});
