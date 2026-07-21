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

describe('WebSocket Telemetry & Bulk Sync Integration Tests', () => {
  let serverPort: number;
  let clientSocket1: ClientSocket;
  let clientSocket2: ClientSocket;
  let userToken1: string;
  let userToken2: string;
  const user1 = { id: 'user-uuid-111', name: 'rider_1' };
  const user2 = { id: 'user-uuid-222', name: 'rider_2' };
  const groupCode = 'RIDE11ABCDEF1234';
  const roomId = 'room-uuid-111';

  beforeAll((done) => {
    server.listen(0, () => {
      serverPort = (server.address() as AddressInfo).port;
      userToken1 = jwt.sign(user1, JWT_SECRET);
      userToken2 = jwt.sign(user2, JWT_SECRET);
      done();
    });
  });

  afterAll((done) => {
    io.close();
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();

    mockedQuery.mockImplementation(async (text: string, params?: any[]): Promise<any> => {
      if (text.includes('room_members') && text.includes('users') && text.includes('name')) {
        return {
          rows: [
            { user_id: user1.id, name: user1.name },
            { user_id: user2.id, name: user2.name }
          ]
        };
      }
      if (text.includes('ride_rooms') && text.includes('room_members')) {
        return { rows: [{ id: roomId, status: 'active' }] };
      }
      return { rows: [] };
    });
  });

  afterEach((done) => {
    if (clientSocket1 && clientSocket1.connected) clientSocket1.disconnect();
    if (clientSocket2 && clientSocket2.connected) clientSocket2.disconnect();
    done();
  });

  it('should authenticate client and join room session', (done) => {
    clientSocket1 = ClientIO(`http://localhost:${serverPort}`, {
      auth: { token: userToken1 }
    });

    clientSocket1.on('connect', () => {
      clientSocket1.emit('session:join', { group_code: groupCode });
    });

    clientSocket1.on('session:joined', (data) => {
      expect(data).toHaveProperty('group_code', groupCode);
      expect(data.members).toHaveLength(2);
      done();
    });

    clientSocket1.on('connect_error', (err) => {
      done(err);
    });
  });

  it('should broadcast location updates to other riders in the room', (done) => {
    clientSocket1 = ClientIO(`http://localhost:${serverPort}`, {
      auth: { token: userToken1 }
    });

    clientSocket2 = ClientIO(`http://localhost:${serverPort}`, {
      auth: { token: userToken2 }
    });

    let connectedCount = 0;
    const onConnect = () => {
      connectedCount++;
      if (connectedCount === 2) {
        clientSocket1.emit('session:join', { group_code: groupCode });
        clientSocket2.emit('session:join', { group_code: groupCode });
      }
    };

    clientSocket1.on('connect', onConnect);
    clientSocket2.on('connect', onConnect);

    clientSocket2.on('session:joined', () => {
      clientSocket1.emit('location:update', {
        timestamp: 1720958400000,
        latitude: 28.2096,
        longitude: 83.9856,
        accuracy: 5.0,
        speed: 15.0
      });
    });

    clientSocket2.on('location:broadcast', (data) => {
      expect(data).toEqual({
        user_id: user1.id,
        name: user1.name,
        timestamp: 1720958400000,
        latitude: 28.2096,
        longitude: 83.9856,
        accuracy: 5.0,
        speed: 15.0
      });
      expect(mockedQuery).toHaveBeenCalled();
      done();
    });
  });

  it('should support bulk sync catch-up with conflict-resolution and callbacks', (done) => {
    clientSocket1 = ClientIO(`http://localhost:${serverPort}`, {
      auth: { token: userToken1 }
    });

    clientSocket1.on('connect', () => {
      clientSocket1.emit('session:join', { group_code: groupCode });
    });

    clientSocket1.on('session:joined', () => {
      const readings = [
        { client_reading_id: 'client-id-1', timestamp: 1720958401000, latitude: 28.2096, longitude: 83.9856, accuracy: 5.0, speed: 10 },
        { client_reading_id: 'client-id-2', timestamp: 1720958402000, latitude: 28.2097, longitude: 83.9857, accuracy: 5.0, speed: 11 },
        { client_reading_id: 'client-id-3', timestamp: 1720958403000, latitude: 28.2098, longitude: 83.9858, accuracy: 4.0, speed: 12 }
      ];

      mockedQuery.mockResolvedValueOnce({
        rows: readings.map(r => ({ client_reading_id: r.client_reading_id }))
      } as any);

      clientSocket1.emit('telemetry:bulkSync', { readings }, (ack: { confirmedClientReadingIds: string[] }) => {
        expect(ack.confirmedClientReadingIds).toContain('client-id-1');
        expect(ack.confirmedClientReadingIds).toContain('client-id-2');
        expect(ack.confirmedClientReadingIds).toContain('client-id-3');
        expect(mockedQuery).toHaveBeenCalled();
        done();
      });
    });
  });
});
