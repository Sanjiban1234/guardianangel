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
  const user1 = { id: 'user-uuid-111', username: 'rider_1' };
  const user2 = { id: 'user-uuid-222', username: 'rider_2' };
  const roomToken = 'RIDE11';
  const roomId = 'room-uuid-111';

  beforeAll((done) => {
    // Spin up server on a dynamic random port
    server.listen(0, () => {
      serverPort = (server.address() as AddressInfo).port;

      // Create JWTs for auth handshake
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

    // Set up standard mock queries
    mockedQuery.mockImplementation(async (text: string, params?: any[]): Promise<any> => {
      if (text.includes('ride_rooms') && text.includes('room_members')) {
        // Enforce room membership checks
        const targetToken = params?.[0];
        const targetUserId = params?.[1];
        if (targetToken === 'RIDE11' && (targetUserId === user1.id || targetUserId === user2.id)) {
          return { rows: [{ id: roomId, status: 'active' }] };
        }
        return { rows: [] }; // Reject if incorrect token or user
      }
      if (text.includes('room_members') && text.includes('users')) {
        // Return members list
        return {
          rows: [
            { user_id: user1.id, username: user1.username },
            { user_id: user2.id, username: user2.username }
          ]
        };
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
      // Connects, now emit join room
      clientSocket1.emit('session:join', { room_token: roomToken });
    });

    clientSocket1.on('session:joined', (data) => {
      expect(data).toHaveProperty('room_id', roomId);
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
        // Both connected, make both join room
        clientSocket1.emit('session:join', { room_token: roomToken });
        clientSocket2.emit('session:join', { room_token: roomToken });
      }
    };

    clientSocket1.on('connect', onConnect);
    clientSocket2.on('connect', onConnect);

    // Client 2 listens for location broadcasts
    clientSocket2.on('session:joined', () => {
      // Once client 2 is inside the room, client 1 sends a position update
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
        username: user1.username,
        timestamp: 1720958400000,
        latitude: 28.2096,
        longitude: 83.9856,
        accuracy: 5.0,
        speed: 15.0
      });
      // Verify saveTelemetry query was executed
      expect(mockedQuery).toHaveBeenCalled();
      done();
    });
  });

  it('should support bulk sync catch-up with conflict-resolution and callbacks', (done) => {
    clientSocket1 = ClientIO(`http://localhost:${serverPort}`, {
      auth: { token: userToken1 }
    });

    clientSocket1.on('connect', () => {
      clientSocket1.emit('session:join', { room_token: roomToken });
    });

    clientSocket1.on('session:joined', () => {
      // Send bulk sync array
      const readings = [
        { client_reading_id: 'client-id-1', timestamp: 1720958401000, latitude: 28.2096, longitude: 83.9856, accuracy: 5.0, speed: 10 },
        { client_reading_id: 'client-id-2', timestamp: 1720958402000, latitude: 28.2097, longitude: 83.9857, accuracy: 5.0, speed: 11 },
        { client_reading_id: 'client-id-3', timestamp: 1720958402000, latitude: 28.2098, longitude: 83.9858, accuracy: 4.0, speed: 12 } // Duplicate timestamp (conflict scenario)
      ];

      clientSocket1.emit('telemetry:bulkSync', { readings }, (ack: { confirmedClientReadingIds: string[] }) => {
        expect(ack.confirmedClientReadingIds).toContain('client-id-1');
        expect(ack.confirmedClientReadingIds).toContain('client-id-2');
        expect(ack.confirmedClientReadingIds).toContain('client-id-3');
        // Ensure queries were run to save bulk synced rows
        expect(mockedQuery).toHaveBeenCalled();
        done();
      });
    });
  });
});
