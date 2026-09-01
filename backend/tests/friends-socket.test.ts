import { RideSocketController } from '../src/sockets/RideSocketController';

describe('Friends user socket rooms', () => {
  it('joins only the room derived from authenticated identity and never consumes client payload', () => {
    let connect: any;
    const io: any = { use: jest.fn(), on: jest.fn((_event: string, handler: any) => { connect = handler; }) };
    new RideSocketController({} as any, {} as any, {} as any, {} as any, {} as any).register(io);
    const socket: any = { user: { id: 'verified-user', name: 'Rider' }, join: jest.fn(), conn: { transport: { name: 'websocket' }, on: jest.fn() }, use: jest.fn(), on: jest.fn(), emit: jest.fn(), disconnect: jest.fn() };
    connect(socket);
    expect(socket.join).toHaveBeenCalledWith('user:verified-user');
    expect(socket.join).not.toHaveBeenCalledWith('user:attacker');
  });

  it('keeps lightweight test socket doubles compatible when they have no room API', () => {
    let connect: any; const io: any = { use: jest.fn(), on: jest.fn((_e: string, h: any) => { connect = h; }) };
    new RideSocketController({} as any, {} as any, {} as any, {} as any, {} as any).register(io);
    expect(() => connect({ user: { id: 'user-a', name: 'A' }, conn: { transport: { name: 'websocket' }, on: jest.fn() }, use: jest.fn(), on: jest.fn(), emit: jest.fn(), disconnect: jest.fn() })).not.toThrow();
  });
});
