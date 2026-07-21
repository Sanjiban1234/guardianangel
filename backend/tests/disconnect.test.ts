import { AddressInfo } from 'net';
import { io as ClientIO, Socket as ClientSocket } from 'socket.io-client';
import { server, io } from '../src/index';
import * as db from '../src/db';
import jwt from 'jsonwebtoken';

jest.mock('../src/db', () => ({
  query: jest.fn(),
  pool: {
    connect: jest.fn(),
  },
  initDb: jest.fn().mockResolvedValue(true)
}));

const mockedQuery = db.query as jest.MockedFunction<typeof db.query>;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_change_me_in_production';

describe('Disconnect Handler Room-Scoped Isolation', () => {
  let serverPort: number;
  let clientSocketA: ClientSocket;
  let clientSocketB: ClientSocket;
  let tokenA: string;
  let tokenB: string;
  const userA = { id: 'user-uuid-aaa', name: 'rider_a' };
  const userB = { id: 'user-uuid-bbb', name: 'rider_b' };
  const groupCodeA = 'GROUPA_ABCDEF1234';
  const groupCodeB = 'GROUPB_XYZXYZ5678';
  const roomIdA = 'room-uuid-aaa';
  const roomIdB = 'room-uuid-bbb';

  beforeAll((done) => {
    server.listen(0, () => {
      serverPort = (server.address() as AddressInfo).port;
      tokenA = jwt.sign(userA, JWT_SECRET);
      tokenB = jwt.sign(userB, JWT_SECRET);
      done();
    });
  });

  afterAll((done) => {
    io.close();
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach((done) => {
    if (clientSocketA && clientSocketA.connected) clientSocketA.disconnect();
    if (clientSocketB && clientSocketB.connected) clientSocketB.disconnect();
    done();
  });

  it('disconnect lookup is scoped to the room the user was in, not global', (done) => {
    const tokenHashA = require('crypto').createHash('sha256').update(groupCodeA.toUpperCase()).digest('hex');
    const tokenHashB = require('crypto').createHash('sha256').update(groupCodeB.toUpperCase()).digest('hex');

    mockedQuery.mockImplementation(async (text: string, params?: any[]): Promise<any> => {
      if (text.includes('room_members') && text.includes('users') && text.includes('name')) {
        return {
          rows: [
            { user_id: userA.id, name: userA.name },
            { user_id: userB.id, name: userB.name }
          ]
        };
      }
      if (text.includes('ride_rooms') && text.includes('room_members')) {
        if (params && params.includes(tokenHashA)) {
          return { rows: [{ id: roomIdA, status: 'active' }] };
        }
        if (params && params.includes(tokenHashB)) {
          return { rows: [{ id: roomIdB, status: 'active' }] };
        }
        return { rows: [{ id: roomIdA, status: 'active' }] };
      }
      if (text.includes('rider_current_locations') && text.includes('ride_rooms')) {
        if (params && params[1] === tokenHashA) {
          return {
            rows: [{ latitude: '10.0', longitude: '20.0', device_timestamp: '1720000000000' }]
          };
        }
        return { rows: [] };
      }
      return { rows: [] };
    });

    clientSocketA = ClientIO(`http://localhost:${serverPort}`, {
      auth: { token: tokenA }
    });

    clientSocketA.on('connect', () => {
      clientSocketA.emit('session:join', { group_code: groupCodeA });
    });

    clientSocketA.on('session:joined', () => {
      clientSocketB = ClientIO(`http://localhost:${serverPort}`, {
        auth: { token: tokenB }
      });

      clientSocketB.on('connect', () => {
        clientSocketB.emit('session:join', { group_code: groupCodeA });
      });

      clientSocketB.on('session:joined', () => {
        clientSocketB.on('peer:lastKnown', (data) => {
          expect(data.user_id).toBe(userA.id);
          expect(data.latitude).toBe(10.0);
          expect(data.longitude).toBe(20.0);

          const locationCalls = mockedQuery.mock.calls.filter(
            (call) => call[0].includes('rider_current_locations')
          );
          expect(locationCalls.length).toBeGreaterThan(0);
          locationCalls.forEach((call) => {
            expect(call[0]).toContain('ride_rooms');
            expect(call[1]).toContain(tokenHashA);
          });

          done();
        });

        clientSocketA.disconnect();
      });
    });
  });

  it('disconnecting from Room A does NOT broadcast data from Room B', (done) => {
    const tokenHashA = require('crypto').createHash('sha256').update(groupCodeA.toUpperCase()).digest('hex');
    const locationQueryParams: any[][] = [];

    mockedQuery.mockImplementation(async (text: string, params?: any[]): Promise<any> => {
      if (text.includes('room_members') && text.includes('users') && text.includes('name')) {
        return { rows: [{ user_id: userA.id, name: userA.name }] };
      }
      if (text.includes('ride_rooms') && text.includes('room_members')) {
        return { rows: [{ id: roomIdA, status: 'active' }] };
      }
      if (text.includes('rider_current_locations')) {
        locationQueryParams.push(params || []);
        return { rows: [] };
      }
      return { rows: [] };
    });

    clientSocketA = ClientIO(`http://localhost:${serverPort}`, {
      auth: { token: tokenA }
    });

    clientSocketA.on('connect', () => {
      clientSocketA.emit('session:join', { group_code: groupCodeA });
    });

    clientSocketA.on('session:joined', () => {
      clientSocketA.disconnect();

      setTimeout(() => {
        locationQueryParams.forEach((params) => {
          expect(params[1]).toBe(tokenHashA);
        });
        done();
      }, 200);
    });
  });
});
