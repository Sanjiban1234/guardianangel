import { RideSocketController } from '../src/sockets/RideSocketController';

describe('GA-05 Socket.IO abuse boundaries', () => {
  const makeSocket = (id = 'user-1') => ({
    id: `socket-${Math.random()}`, user: { id, name: 'Rider' }, conn: { transport: { name: 'websocket' }, on: jest.fn() },
    on: jest.fn(), use: jest.fn(), emit: jest.fn(), disconnect: jest.fn(), nsp: { to: jest.fn() }, to: jest.fn(),
  });
  const setup = () => {
    let connection: any;
    const io: any = { use: jest.fn(), on: jest.fn((_event: string, fn: any) => { connection = fn; }) };
    new RideSocketController({} as any, {} as any, {} as any, {} as any, {} as any, undefined, undefined, undefined, {} as any).register(io);
    return { connection, io };
  };
  const middleware = (socket: any) => socket.use.mock.calls[0][0] as (packet: [string], next: (error?: Error) => void) => void;

  it('allows normal telemetry and a small burst, then throttles a location flood', () => {
    const { connection } = setup(); const socket: any = makeSocket(); connection(socket);
    const guard = middleware(socket);
    for (let i = 0; i < 20; i++) { const next = jest.fn(); guard(['location:update'], next); expect(next).toHaveBeenCalledWith(); }
    const next = jest.fn(); guard(['location:update'], next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'RATE_LIMITED' }));
  });

  it.each([['telemetry:bulkSync', 6], ['crash:candidate', 3], ['refill:requested', 3]])('throttles %s after its configured limit', (event, max) => {
    const { connection } = setup(); const socket: any = makeSocket(); connection(socket); const guard = middleware(socket);
    for (let i = 0; i < max; i++) guard([event], jest.fn());
    const next = jest.fn(); guard([event], next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'RATE_LIMITED' }));
  });

  it('accepts three concurrent sockets and rejects a fourth for one account', () => {
    const { connection } = setup();
    const sockets = [makeSocket(), makeSocket(), makeSocket(), makeSocket()]; sockets.forEach(connection);
    expect(sockets.slice(0, 3).every((socket) => socket.disconnect.mock.calls.length === 0)).toBe(true);
    expect(sockets[3].emit).toHaveBeenCalledWith('error', expect.objectContaining({ message: expect.stringContaining('Too many') }));
    expect(sockets[3].disconnect).toHaveBeenCalledWith(true);
  });
});
