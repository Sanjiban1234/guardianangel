import { SessionHandler } from '../src/handlers/SessionHandler';

describe('session bike identity payloads', () => {
  it('returns persisted bike identity only through an authorized room join', async () => {
    const handlers: Record<string, Function> = {};
    const roomBroadcast = { emit: jest.fn() };
    const socket: any = {
      id: 'socket-1',
      user: { id: 'rider-1', name: 'Pratyush' },
      on: jest.fn((event, handler) => { handlers[event] = handler; }),
      join: jest.fn(),
      emit: jest.fn(),
      to: jest.fn(() => roomBroadcast),
      nsp: { adapter: { rooms: new Map() } },
    };
    const presenceService: any = {
      markConnected: jest.fn(),
      getRiderPresence: jest.fn().mockResolvedValue([{
        user_id: 'rider-1', name: 'Pratyush', role: 'owner',
        vehicle_model: 'Royal Enfield Classic 350', plate_number: 'BA 12 PA 3456',
        connection_state: 'CONNECTED', location_freshness: 'FRESH',
      }]),
    };
    const roomService: any = {
      verifyMembership: jest.fn().mockResolvedValue({ status: 'active' }),
      getRoomRideStatus: jest.fn().mockResolvedValue({ rideStartedAt: null }),
    };

    new SessionHandler({} as any, socket, { currentGroupCode: null }, roomService, presenceService).register();
    await handlers['session:join']({ group_code: 'RIDE123' });

    expect(socket.emit).toHaveBeenCalledWith('session:joined', expect.objectContaining({
      members: [expect.objectContaining({ vehicle_model: 'Royal Enfield Classic 350', plate_number: 'BA 12 PA 3456' })],
    }));
    expect(roomBroadcast.emit).toHaveBeenCalledWith('session:member_joined', expect.objectContaining({
      user_id: 'rider-1', vehicle_model: 'Royal Enfield Classic 350', plate_number: 'BA 12 PA 3456',
    }));
  });
});
